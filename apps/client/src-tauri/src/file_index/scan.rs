//! 全盘文件名索引的落盘与扫描。
//!
//! 单独的 SQLite 库（`<appLocalData>/index/files.db`）：百万级行 + FTS5 放进主库会把
//! 备份/迁移一起拖慢，而这份数据随时可以重建。
//!
//! 新鲜度策略（参考 FSearch 的 scan/monitor 分层）：
//! - **全量重建** `rebuild`：清空重灌，用户手动触发或首次建索引；
//! - **增量刷新** `refresh`：只写 mtime/size/名字变化的行（未变化的行不触发 FTS 触发器），
//!   扫完再把本轮没见到的路径删掉；启动时超过 [`REFRESH_INTERVAL_MS`] 自动做一次。
//!
//! USN journal（Everything 的路子）需要管理员权限，留作后续分层；扫描期间用 `is_scanning`
//! 防重入、`cancel` 供「停止/重建」打断。

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::Ordering;

use cogito_core::CommandResult;
use sea_orm::{
    ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement, TransactionTrait, Value,
};

use super::{FileIndex, FileIndexStatus, FileRow, Inner};

/// 一次批提交的条目数（遍历侧攒批）
const BATCH_SIZE: usize = 800;
/// 单条多行 INSERT 的条目上限（8 列 × 300 行 = 2400 个绑定参数）
const UPSERT_CHUNK: usize = 300;
/// 遍历线程数：目录遍历是 IO 等待密集，多线程能把机械盘 / 网盘 / 杀软扫描的延迟叠起来
const WALK_THREADS: usize = 4;
/// 索引随时可重建，因此关掉持久性换来写入吞吐（WAL + synchronous=OFF）
const PRAGMAS: [(&str, &str); 6] = [
    ("journal_mode", "WAL"),
    ("synchronous", "OFF"),
    ("temp_store", "MEMORY"),
    ("cache_size", "-65536"),
    ("mmap_size", "536870912"),
    ("busy_timeout", "5000"),
];
/// `index_meta` 里记录上次增量刷新的毫秒时间戳
pub const META_LAST_REFRESH: &str = "lastRefresh";
/// `index_meta` 里记录当前条目总数：`COUNT(*)` 在百万行上是 2–3 秒的全表扫描，
/// 不该出现在每次启动 / 每轮刷新里
const META_TOTAL: &str = "total";
/// 启动时距上次刷新超过这个间隔就增量刷一轮（全量重建只由用户手动触发）
const REFRESH_INTERVAL_MS: i64 = 6 * 60 * 60 * 1000;
/// 建表 / 触发器 / 索引（幂等）
const SCHEMA: [&str; 8] = [
    "CREATE TABLE IF NOT EXISTS file_entry (
        path TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        name_fold TEXT NOT NULL,
        dir TEXT NOT NULL,
        ext TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        is_dir INTEGER NOT NULL
     )",
    "CREATE INDEX IF NOT EXISTS file_entry_name_fold ON file_entry(name_fold)",
    "CREATE VIRTUAL TABLE IF NOT EXISTS file_entry_fts USING fts5(
        name_fold, content='file_entry', tokenize='trigram'
     )",
    "CREATE TRIGGER IF NOT EXISTS file_entry_ai AFTER INSERT ON file_entry BEGIN
        INSERT INTO file_entry_fts(rowid, name_fold) VALUES (new.rowid, new.name_fold);
     END",
    "CREATE TRIGGER IF NOT EXISTS file_entry_ad AFTER DELETE ON file_entry BEGIN
        INSERT INTO file_entry_fts(file_entry_fts, rowid, name_fold)
        VALUES ('delete', old.rowid, old.name_fold);
     END",
    "CREATE TRIGGER IF NOT EXISTS file_entry_au AFTER UPDATE ON file_entry BEGIN
        INSERT INTO file_entry_fts(file_entry_fts, rowid, name_fold)
        VALUES ('delete', old.rowid, old.name_fold);
        INSERT INTO file_entry_fts(rowid, name_fold) VALUES (new.rowid, new.name_fold);
     END",
    // 增量刷新用：本轮走过的路径，扫完靠它删失效行；无触发器，纯 insert 很便宜
    "CREATE TABLE IF NOT EXISTS seen_path (path TEXT PRIMARY KEY) WITHOUT ROWID",
    "CREATE TABLE IF NOT EXISTS index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
];

/// 不索引的目录名（按最后一段比较，忽略大小写）：系统重灾区 + 可随时重建的构建/包目录
const SKIP_DIRS: [&str; 24] = [
    "Windows",
    "WinSxS",
    "System32",
    "SysWOW64",
    "DriverStore",
    "Recovery",
    "$Recycle.Bin",
    "System Volume Information",
    "$WinREAgent",
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    "__pycache__",
    "target",
    "obj",
    ".pnpm-store",
    ".cargo",
    ".rustup",
    ".nuget",
    ".gradle",
    ".m2",
    ".next",
    ".turbo",
];

/// 路径包含即跳过（按小写比对）：系统目录与临时目录里没有值得搜的东西
const SKIP_PATH_PARTS: [&str; 4] = [
    "\\windows\\",
    "\\appdata\\local\\temp",
    "\\appdata\\local\\packages",
    "\\$recycle.bin",
];

pub async fn open(path: &Path) -> CommandResult<DatabaseConnection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            cogito_core::Exception::Internal(format!("创建索引目录失败：{error}"))
        })?;
    }
    let url = format!(
        "sqlite://{}?mode=rwc",
        path.to_string_lossy().replace('\\', "/")
    );
    let db = Database::connect(&url)
        .await
        .map_err(|error| cogito_core::Exception::Internal(format!("打开文件索引失败：{error}")))?;
    // 百万行批量写入的关键：WAL + 关 fsync（这份库随时可重建，不怕掉电丢尾巴）
    for (key, value) in PRAGMAS {
        let _ = db
            .execute(Statement::from_string(
                DbBackend::Sqlite,
                format!("PRAGMA {key} = {value}"),
            ))
            .await;
    }
    for sql in SCHEMA {
        db.execute(Statement::from_string(DbBackend::Sqlite, sql))
            .await
            .map_err(|error| {
                cogito_core::Exception::Internal(format!("初始化文件索引失败：{error}"))
            })?;
    }
    Ok(db)
}

fn find_roots() -> Vec<PathBuf> {
    // 只认「存在即可读」的盘符：无介质的光驱 `exists()` 返回 false，不会拖住启动
    let mut roots = Vec::new();
    for letter in b'A'..=b'Z' {
        let root = PathBuf::from(format!("{}:\\", letter as char));
        if root.exists() {
            roots.push(root);
        }
    }
    roots
}

fn is_skipped(path: &Path) -> bool {
    if let Some(name) = path.file_name().and_then(|value| value.to_str()) {
        if SKIP_DIRS.iter().any(|item| item.eq_ignore_ascii_case(name)) {
            return true;
        }
    }
    let text = path.to_string_lossy().to_ascii_lowercase();
    SKIP_PATH_PARTS.iter().any(|part| text.contains(part))
}

fn to_row(path: &Path, meta: &std::fs::Metadata) -> Option<FileRow> {
    let name = path.file_name()?.to_string_lossy().into_owned();
    let dir = path
        .parent()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ext = path
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let mtime = meta
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0);
    Some(FileRow {
        path: path.to_string_lossy().into_owned(),
        // 用 Unicode 折叠：`to_ascii_lowercase` 对西里尔 / 希腊字母不生效，会搜不到
        name_fold: name.to_lowercase(),
        name,
        dir,
        ext,
        size: meta.len() as i64,
        mtime,
        is_dir: meta.is_dir(),
    })
}

fn db_error(error: sea_orm::DbErr) -> cogito_core::Exception {
    cogito_core::Exception::Internal(format!("写入文件索引失败：{error}"))
}

/// 写入一批（多行 VALUES + 单事务；`incremental` 时跳过未变化的行）
///
/// 「跳过未变化」写在 `ON CONFLICT ... WHERE` 里：条件不成立时 SQLite 不做更新，
/// FTS 的 UPDATE 触发器也就不会触发 —— 这是增量刷新不重写倒排的关键。
async fn write_rows<C: ConnectionTrait>(
    conn: &C,
    rows: &[FileRow],
    incremental: bool,
) -> CommandResult<u64> {
    let mut affected = 0u64;
    const COLUMNS: &str = "(path, name, name_fold, dir, ext, size, mtime, is_dir)";
    const UPDATES: &str = "ON CONFLICT(path) DO UPDATE SET
          name = excluded.name,
          name_fold = excluded.name_fold,
          dir = excluded.dir,
          ext = excluded.ext,
          size = excluded.size,
          mtime = excluded.mtime,
          is_dir = excluded.is_dir";
    // mtime 不变但文件改名时也要更新（Windows 上 rename 不改 mtime）
    const SKIP_UNCHANGED: &str = " WHERE excluded.name_fold <> file_entry.name_fold
          OR excluded.dir <> file_entry.dir
          OR excluded.size <> file_entry.size
          OR excluded.mtime <> file_entry.mtime
          OR excluded.is_dir <> file_entry.is_dir";

    for chunk in rows.chunks(UPSERT_CHUNK) {
        let mut sql = format!("INSERT INTO file_entry {COLUMNS} VALUES ");
        let mut values: Vec<Value> = Vec::with_capacity(chunk.len() * 8);
        for (index, row) in chunk.iter().enumerate() {
            if index > 0 {
                sql.push(',');
            }
            sql.push_str("(?,?,?,?,?,?,?,?)");
            values.push(Value::from(row.path.clone()));
            values.push(Value::from(row.name.clone()));
            values.push(Value::from(row.name_fold.clone()));
            values.push(Value::from(row.dir.clone()));
            values.push(Value::from(row.ext.clone()));
            values.push(Value::from(row.size));
            values.push(Value::from(row.mtime));
            values.push(Value::from(if row.is_dir { 1i64 } else { 0i64 }));
        }
        sql.push_str(UPDATES);
        if incremental {
            sql.push_str(SKIP_UNCHANGED);
        }
        let result = conn
            .execute(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                sql,
                values,
            ))
            .await
            .map_err(db_error)?;
        affected += result.rows_affected();
    }
    Ok(affected)
}

/// 标记「本轮见过这些路径」（`seen_path` 无触发器，纯 insert 很快）
async fn mark_seen<C: ConnectionTrait>(conn: &C, rows: &[FileRow]) -> CommandResult<()> {
    for chunk in rows.chunks(UPSERT_CHUNK) {
        let mut sql = String::from("INSERT OR IGNORE INTO seen_path (path) VALUES ");
        let mut values: Vec<Value> = Vec::with_capacity(chunk.len());
        for (index, row) in chunk.iter().enumerate() {
            if index > 0 {
                sql.push(',');
            }
            sql.push_str("(?)");
            values.push(Value::from(row.path.clone()));
        }
        conn.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            sql,
            values,
        ))
        .await
        .map_err(db_error)?;
    }
    Ok(())
}

/// 一批数据一个事务：批量写法下事务边界比语句本身更重要
pub(super) async fn commit_batch(
    db: &DatabaseConnection,
    rows: &[FileRow],
    incremental: bool,
) -> CommandResult<u64> {
    let txn = db.begin().await.map_err(db_error)?;
    let affected = write_rows(&txn, rows, incremental).await?;
    if incremental {
        mark_seen(&txn, rows).await?;
    }
    txn.commit().await.map_err(db_error)?;
    Ok(affected)
}

/// 删掉本轮没见到的路径（只在本轮完整跑完时调），返回删除行数。
///
/// `NOT EXISTS` 能逐行走 `seen_path` 的主键索引；`NOT IN (子查询)` 会被优化器
/// 物化成数百万行的临时索引，实测 3–7 秒。
async fn prune(db: &DatabaseConnection) -> CommandResult<i64> {
    let result = db
        .execute(Statement::from_string(
            DbBackend::Sqlite,
            "DELETE FROM file_entry WHERE NOT EXISTS (\n                SELECT 1 FROM seen_path WHERE seen_path.path = file_entry.path\n             )"
                .to_string(),
        ))
        .await
        .map_err(db_error)?;
    let deleted = result.rows_affected() as i64;
    db.execute(Statement::from_string(
        DbBackend::Sqlite,
        "DELETE FROM seen_path".to_string(),
    ))
    .await
    .map_err(db_error)?;
    Ok(deleted)
}

/// 读取 `index_meta` 里的时间戳类字段
pub async fn read_meta(db: &DatabaseConnection, key: &str) -> CommandResult<Option<i64>> {
    let row = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT value FROM index_meta WHERE key = ?",
            vec![Value::from(key.to_string())],
        ))
        .await
        .map_err(|error| {
            cogito_core::Exception::Internal(format!("读取索引元数据失败：{error}"))
        })?;
    Ok(row
        .and_then(|item| item.try_get::<String>("", "value").ok())
        .and_then(|text| text.parse::<i64>().ok()))
}

async fn write_meta(db: &DatabaseConnection, key: &str, value: &str) {
    let _ = db
        .execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO index_meta (key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            vec![Value::from(key.to_string()), Value::from(value.to_string())],
        ))
        .await;
}

async fn count_rows(db: &DatabaseConnection) -> CommandResult<i64> {
    let row = db
        .query_one(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS n FROM file_entry".to_string(),
        ))
        .await
        .map_err(|error| {
            cogito_core::Exception::Internal(format!("读取索引条目数失败：{error}"))
        })?;
    Ok(row
        .and_then(|item| item.try_get::<i64>("", "n").ok())
        .unwrap_or(0))
}

/// 同步遍历（在 `spawn_blocking` 里跑）：批量塞进 channel 交给异步侧落库。
///
/// 返回 `true` 表示跑完了所有盘（没被取消）——只有这个前提下才能做失效行清理。
fn walk(inner: &Inner, sender: tokio::sync::mpsc::Sender<Vec<FileRow>>) -> bool {
    let mut batch: Vec<FileRow> = Vec::with_capacity(BATCH_SIZE);
    let mut scanned: i64 = 0;

    for root in find_roots() {
        let mut builder = ignore::WalkBuilder::new(&root);
        builder
            .hidden(false)
            .git_ignore(false)
            .git_global(false)
            .git_exclude(false)
            .follow_links(false)
            .threads(WALK_THREADS)
            .filter_entry(|entry| !is_skipped(entry.path()));

        for entry in builder.build().flatten() {
            if inner.is_cancelled() {
                return false;
            }
            let Some(meta) = entry.metadata().ok() else {
                continue;
            };
            if !meta.is_file() && !meta.is_dir() {
                continue;
            }
            if let Some(row) = to_row(entry.path(), &meta) {
                batch.push(row);
            }
            scanned += 1;
            if scanned % 256 == 0 {
                inner.set_progress(scanned);
            }
            if batch.len() >= BATCH_SIZE {
                if sender.blocking_send(std::mem::take(&mut batch)).is_err() {
                    return false;
                }
            }
        }
        if inner.is_cancelled() {
            return false;
        }
    }

    if !batch.is_empty() {
        let _ = sender.blocking_send(batch);
    }
    inner.set_progress(scanned);
    true
}

/// 两种同步模式
#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    /// 清空重灌（首次建索引 / 用户手动重建）
    Full,
    /// 增量：未变化的行不写，FTS 不重写，扫完删失效行
    Refresh,
}

/// 全量重建：清空 → 扫描 → 落库。
pub async fn rebuild(inner: Arc<Inner>) -> CommandResult<()> {
    sync(inner, Mode::Full).await
}

/// 增量刷新：只写变化的行；文件改名 / 新建 / 删除都能反映到索引里。
pub async fn refresh(inner: Arc<Inner>) -> CommandResult<()> {
    sync(inner, Mode::Refresh).await
}

async fn sync(inner: Arc<Inner>, mode: Mode) -> CommandResult<()> {
    if inner.is_scanning.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let result = sync_inner(inner.clone(), mode).await;
    inner.is_scanning.store(false, Ordering::SeqCst);
    match &result {
        Ok(()) => {
            let mut status = inner.status.lock().expect("index status poisoned");
            status.state = FileIndexStatus::READY.to_string();
            status.started_at = None;
            // 被用户停掉的扫描：索引能查，但可能不完整，别让它看起来「已就绪」
            if inner.is_cancelled() {
                status.message = Some("扫描已停止，索引可能不完整".to_string());
            }
        }
        Err(error) => {
            let mut status = inner.status.lock().expect("index status poisoned");
            status.state = FileIndexStatus::ERROR.to_string();
            status.message = Some(error.to_string());
            status.started_at = None;
        }
    }
    result
}

async fn sync_inner(inner: Arc<Inner>, mode: Mode) -> CommandResult<()> {
    {
        let mut status = inner.status.lock().expect("index status poisoned");
        status.state = FileIndexStatus::SCANNING.to_string();
        status.scanned = 0;
        status.started_at = Some(crate::file_index::now_ms());
        status.message = None;
    }
    inner.reset_cancel();

    let db = inner.connection().await?;
    // 条目总数在扫描**之前**读：增量刷新只需要「旧总数 + 新增 - 删除」。
    // 老库没有这份元数据时退回一次全表 COUNT（只发生一次，之后就有记录了）。
    let previous_total = match read_meta(&db, META_TOTAL).await? {
        Some(value) => value,
        None => count_rows(&db).await.unwrap_or(0),
    };
    // 上轮被打断时 seen_path 会留半份路径，先清干净
    let _ = db
        .execute(Statement::from_string(
            DbBackend::Sqlite,
            "DELETE FROM seen_path".to_string(),
        ))
        .await;
    if mode == Mode::Full {
        // FTS 是外部内容表，先按 rowid 逐行删再清主表，避免残留幽灵条目
        let _ = db
            .execute(Statement::from_string(
                DbBackend::Sqlite,
                "DELETE FROM file_entry".to_string(),
            ))
            .await;
    }

    let (sender, mut receiver) = tokio::sync::mpsc::channel::<Vec<FileRow>>(6);
    let incremental = mode == Mode::Refresh;
    let writer_inner = inner.clone();
    let writer_db = db.clone();
    let writer = tauri::async_runtime::spawn(async move {
        let mut written = 0i64;
        let mut affected = 0u64;
        while let Some(batch) = receiver.recv().await {
            let rows = batch.len() as i64;
            match commit_batch(&writer_db, &batch, incremental).await {
                Ok(count) => affected += count,
                Err(error) => {
                    eprintln!("[file-index] 写入失败：{error}");
                    break;
                }
            }
            written += rows;
            writer_inner.set_indexed(written);
        }
        (written, affected)
    });

    let walk_inner = inner.clone();
    let completed = tauri::async_runtime::spawn_blocking(move || walk(&walk_inner, sender))
        .await
        .map_err(|error| cogito_core::Exception::Internal(format!("扫描线程异常：{error}")))?;
    let (written, affected) = writer
        .await
        .map_err(|error| cogito_core::Exception::Internal(format!("索引写入线程异常：{error}")))?;

    let deleted = if incremental && completed {
        prune(&db).await?
    } else {
        let _ = db
            .execute(Statement::from_string(
                DbBackend::Sqlite,
                "DELETE FROM seen_path".to_string(),
            ))
            .await;
        0
    };

    // 全量重建刚清过表，写入行数就是总数；增量刷新按「旧总数 + 实际写入 - 删除」推算
    let total = if mode == Mode::Full {
        written
    } else {
        (previous_total + affected as i64 - deleted).max(0)
    };
    inner.set_indexed(total);
    inner.set_progress(total);
    write_meta(&db, META_TOTAL, &total.to_string()).await;
    write_meta(
        &db,
        META_LAST_REFRESH,
        &crate::file_index::now_ms().to_string(),
    )
    .await;
    Ok(())
}

/// 启动时的新鲜度决策：空库 → 全量建；老库太久没刷 → 增量刷新。
pub fn spawn_initial_scan(index: FileIndex) {
    tauri::async_runtime::spawn(async move {
        // 避开启动 IO 高峰
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        if index.is_scanning() {
            return;
        }
        // 优先读元数据里的总数：老库没这份记录时才退回一次 COUNT(*)
        let cached_total = match index.inner.connection().await {
            Ok(db) => read_meta(&db, META_TOTAL).await.ok().flatten(),
            Err(_) => None,
        };
        let count = match cached_total {
            Some(value) => value,
            None => index.count().await.unwrap_or(0),
        };
        if count > 0 {
            let stale = match index.last_refresh_ms().await {
                Ok(Some(value)) => crate::file_index::now_ms() - value > REFRESH_INTERVAL_MS,
                // 没记录过（老版本建的库）也算过期
                _ => true,
            };
            if stale {
                if let Err(error) = index.refresh().await {
                    eprintln!("[file-index] 增量刷新失败：{error}");
                }
            }
        } else {
            // 空库：先亮状态再扫，UI 轮询就能看到「正在建立索引」
            if let Err(error) = index.rebuild().await {
                eprintln!("[file-index] 首次扫描失败：{error}");
            }
        }
    });
}

/// 扫完一轮后 FTS 里可能留下去重前的空行，顺手整理一次。
pub async fn read_rows(
    db: &DatabaseConnection,
    sql: String,
    values: Vec<Value>,
) -> CommandResult<VecDeque<FileRow>> {
    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            sql,
            values,
        ))
        .await
        .map_err(|error| cogito_core::Exception::Internal(format!("查询文件索引失败：{error}")))?;
    let mut out = VecDeque::with_capacity(rows.len());
    for row in rows {
        out.push_back(FileRow {
            path: row.try_get("", "path").unwrap_or_default(),
            name: row.try_get("", "name").unwrap_or_default(),
            name_fold: String::new(),
            dir: row.try_get("", "dir").unwrap_or_default(),
            ext: row.try_get("", "ext").unwrap_or_default(),
            size: row.try_get("", "size").unwrap_or(0),
            mtime: row.try_get("", "mtime").unwrap_or(0),
            is_dir: row.try_get::<i64>("", "is_dir").unwrap_or(0) != 0,
        });
    }
    Ok(out)
}
