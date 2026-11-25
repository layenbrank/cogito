//! 全盘文件名索引（Everything 式）：状态、查询与 IPC 门面。
//!
//! 扫描与落盘在 [`scan`]：单独的 SQLite 库 + `ignore` 遍历，避免把百万级行塞进主库。
//! 这里只管「对外可见的部分」：状态快照、查询、重建入口。

mod scan;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

use cogito_core::{CommandResult, Exception};
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement, Value};
use serde::{Deserialize, Serialize};
use tauri::State;

/// 一条索引行的内存形状（扫描侧产出、查询侧复用）
#[derive(Debug, Clone)]
pub struct FileRow {
    pub path: String,
    pub name: String,
    /// 小写文件名，供 FTS / LIKE 匹配
    pub name_fold: String,
    pub dir: String,
    pub ext: String,
    pub size: i64,
    pub mtime: i64,
    pub is_dir: bool,
}

/// 状态机的取值：`idle` 未建 / `scanning` 扫描中 / `ready` 可查 / `error` 上次失败
pub struct FileIndexStatus;

impl FileIndexStatus {
    pub const IDLE: &'static str = "idle";
    pub const SCANNING: &'static str = "scanning";
    pub const READY: &'static str = "ready";
    pub const ERROR: &'static str = "error";
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHitR {
    pub path: String,
    pub name: String,
    pub dir: String,
    pub ext: String,
    pub is_dir: bool,
    pub size: i64,
    pub modified_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIndexStatusR {
    pub state: String,
    pub indexed: i64,
    pub scanned: i64,
    pub started_at: Option<i64>,
    pub message: Option<String>,
}

#[derive(Debug, Clone)]
struct StatusState {
    state: String,
    scanned: i64,
    started_at: Option<i64>,
    message: Option<String>,
}

pub struct Inner {
    db_path: PathBuf,
    db: tokio::sync::Mutex<Option<DatabaseConnection>>,
    status: Mutex<StatusState>,
    is_scanning: AtomicBool,
    indexed: AtomicI64,
    cancel: AtomicBool,
}

impl Inner {
    async fn connection(&self) -> CommandResult<DatabaseConnection> {
        let mut guard = self.db.lock().await;
        if let Some(db) = guard.as_ref() {
            return Ok(db.clone());
        }
        let db = scan::open(&self.db_path).await?;
        *guard = Some(db.clone());
        Ok(db)
    }

    fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    fn reset_cancel(&self) {
        self.cancel.store(false, Ordering::Relaxed);
    }

    fn set_progress(&self, scanned: i64) {
        let mut status = self.status.lock().expect("index status poisoned");
        status.scanned = scanned;
    }

    fn set_indexed(&self, indexed: i64) {
        self.indexed.store(indexed, Ordering::Relaxed);
    }
}

/// 托管给 Tauri 的句柄：轻量 `Clone`，内部共享连接与状态
#[derive(Clone)]
pub struct FileIndex {
    inner: Arc<Inner>,
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

impl FileIndex {
    pub fn new(db_path: PathBuf) -> Self {
        Self {
            inner: Arc::new(Inner {
                db_path,
                db: tokio::sync::Mutex::new(None),
                status: Mutex::new(StatusState {
                    state: FileIndexStatus::IDLE.to_string(),
                    scanned: 0,
                    started_at: None,
                    message: None,
                }),
                is_scanning: AtomicBool::new(false),
                indexed: AtomicI64::new(0),
                cancel: AtomicBool::new(false),
            }),
        }
    }

    /// 启动时调一次：库里还是空的就在空闲后补一轮扫描
    pub fn spawn_initial(&self) {
        scan::spawn_initial_scan(self.clone());
    }

    /// 请求停止当前扫描。
    ///
    /// 遍历线程每处理一个条目检查一次，通常一秒内退出；已写入的批次保留（下一轮增量
    /// 刷新会补齐），所以取消不会把索引清空。
    pub fn cancel(&self) {
        self.inner.cancel.store(true, Ordering::SeqCst);
    }

    pub fn is_scanning(&self) -> bool {
        self.inner.is_scanning.load(Ordering::Relaxed)
    }

    pub fn status(&self) -> FileIndexStatusR {
        let status = self.inner.status.lock().expect("index status poisoned");
        let indexed = self.inner.indexed.load(Ordering::Relaxed);
        FileIndexStatusR {
            state: status.state.clone(),
            indexed,
            scanned: status.scanned,
            started_at: status.started_at,
            message: status.message.clone(),
        }
    }

    /// 是否在索引里：打开 / 定位命令的准入校验
    pub async fn is_indexed(&self, path: &str) -> CommandResult<bool> {
        let db = self.inner.connection().await?;
        let row = db
            .query_one(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "SELECT 1 AS hit FROM file_entry WHERE path = ? LIMIT 1",
                vec![Value::from(path.to_string())],
            ))
            .await
            .map_err(|error| Exception::Internal(format!("查询文件索引失败：{error}")))?;
        Ok(row.is_some())
    }

    pub async fn count(&self) -> CommandResult<i64> {
        let db = self.inner.connection().await?;
        let row = db
            .query_one(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT COUNT(*) AS n FROM file_entry".to_string(),
            ))
            .await
            .map_err(|error| Exception::Internal(format!("读取索引条目数失败：{error}")))?;
        Ok(row
            .and_then(|item| item.try_get::<i64>("", "n").ok())
            .unwrap_or(0))
    }

    pub async fn rebuild(&self) -> CommandResult<()> {
        scan::rebuild(self.inner.clone()).await
    }

    /// 增量刷新：只写变化的行，扫完再删本轮没见到的路径
    pub async fn refresh(&self) -> CommandResult<()> {
        scan::refresh(self.inner.clone()).await
    }

    /// 上次成功同步的毫秒时间戳；老库没记录过时返回 `None`
    pub async fn last_refresh_ms(&self) -> CommandResult<Option<i64>> {
        let db = self.inner.connection().await?;
        scan::read_meta(&db, scan::META_LAST_REFRESH).await
    }

    /// 文件名搜索
    ///
    /// 语法对齐 Everything：空格分隔的片段按 **AND** 处理，`!片段` / `-片段` 排除，
    /// `ext:rs,ts` 限扩展名，`path:deps` 限目录，`*` `?` 是通配符，双引号包住的算一个片段。
    /// 片段均 ≥3 字符走 FTS5 trigram（子串 + bm25），含更短片段或通配符时退回 LIKE。
    pub async fn search(&self, query: &str, limit: usize) -> CommandResult<Vec<FileHitR>> {
        let parsed = parse_query(query);
        if parsed.is_empty() {
            return Ok(Vec::new());
        }
        let db = self.inner.connection().await?;
        let limit = limit.clamp(1, 50) as i64;
        // 排序用：完整片段串（精确名命中）与首个片段的前缀（前缀命中）
        let exact = parsed.terms.join(" ");
        let prefix = format!("{}%", parsed.terms.first().cloned().unwrap_or_default());

        let rows = if parsed.fts_ready() {
            search_fts(&db, &parsed, &exact, &prefix, limit).await?
        } else {
            search_like(&db, &parsed, &exact, &prefix, limit).await?
        };
        Ok(rows.into_iter().map(to_hit).collect())
    }
}

/// 片段数上限：防止一长串词拼出病态 SQL
const MAX_TERMS: usize = 8;
/// trigram 分词器至少吃 3 个字符
const MIN_FTS_CHARS: usize = 3;

/// 解析后的查询：AND 语义 + 排除 + 过滤器
#[derive(Debug, Default)]
struct ParsedQuery {
    /// 必须出现的片段
    terms: Vec<String>,
    /// 必须不出现的片段
    excludes: Vec<String>,
    /// 扩展名白名单（小写、不带点）
    exts: Vec<String>,
    /// 目录必须包含的片段
    dirs: Vec<String>,
}

impl ParsedQuery {
    fn is_empty(&self) -> bool {
        self.terms.is_empty()
            && self.excludes.is_empty()
            && self.exts.is_empty()
            && self.dirs.is_empty()
    }

    /// 片段都够长且没有通配符时才能交给 FTS5
    fn fts_ready(&self) -> bool {
        !self.terms.is_empty()
            && self
                .terms
                .iter()
                .chain(self.excludes.iter())
                .all(|term| term.chars().count() >= MIN_FTS_CHARS && !term.contains(['*', '?']))
    }
}

/// 按空白切分；双引号内的空白不切（`"foo bar"` 算一个片段）
fn tokenize(raw: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    for ch in raw.chars() {
        match ch {
            '"' => quoted = !quoted,
            value if value.is_whitespace() && !quoted => {
                if !current.is_empty() {
                    out.push(std::mem::take(&mut current));
                }
            }
            value => current.push(value),
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

fn parse_query(raw: &str) -> ParsedQuery {
    let mut parsed = ParsedQuery::default();
    for token in tokenize(raw) {
        let (negated, body) = match token.strip_prefix('!').or_else(|| token.strip_prefix('-')) {
            Some(rest) => (true, rest.to_string()),
            None => (false, token),
        };
        if body.is_empty() {
            continue;
        }
        let lower = body.to_lowercase();
        if let Some(value) = lower.strip_prefix("ext:") {
            if !negated {
                parsed.exts.extend(
                    value
                        .split(',')
                        .map(|item| item.trim().trim_start_matches('.').to_string())
                        .filter(|item| !item.is_empty()),
                );
            }
            continue;
        }
        if let Some(value) = lower.strip_prefix("path:") {
            if !negated && !value.is_empty() {
                parsed.dirs.push(value.to_string());
            }
            continue;
        }
        if negated {
            parsed.excludes.push(lower);
        } else {
            parsed.terms.push(lower);
        }
    }
    parsed.terms.truncate(MAX_TERMS);
    parsed.excludes.truncate(MAX_TERMS);
    parsed
}

/// 把片段变成 LIKE 模式：`*` → `%`、`?` → `_`，其余 `%` `_` `\` 转义；
/// `prefix_only` 时是 `term%`（短片段用，能吃到 `name_fold` 索引），否则是 `%term%`
fn like_pattern(term: &str, prefix_only: bool) -> String {
    let mut out = String::with_capacity(term.len() + 2);
    if !prefix_only {
        out.push('%');
    }
    for ch in term.chars() {
        match ch {
            '*' => out.push('%'),
            '?' => out.push('_'),
            '\\' | '%' | '_' => {
                out.push('\\');
                out.push(ch);
            }
            value => out.push(value),
        }
    }
    out.push('%');
    out
}

fn to_hit(row: FileRow) -> FileHitR {
    FileHitR {
        path: row.path,
        name: row.name,
        dir: row.dir,
        ext: row.ext,
        is_dir: row.is_dir,
        size: row.size,
        modified_at: row.mtime,
    }
}

/// 拼「`ext` / `dir` 过滤」的片段（两种搜索路径共用；`table` 是列前缀，FTS 路径要 `e.`）
fn push_filters(sql: &mut String, values: &mut Vec<Value>, parsed: &ParsedQuery, table: &str) {
    if !parsed.exts.is_empty() {
        let holes = vec!["?"; parsed.exts.len()].join(",");
        sql.push_str(&format!(" AND {table}ext IN ({holes})"));
        values.extend(parsed.exts.iter().map(|item| Value::from(item.clone())));
    }
    for dir in &parsed.dirs {
        sql.push_str(&format!(" AND {table}dir LIKE ? ESCAPE '\\'"));
        values.push(Value::from(like_pattern(dir, false)));
    }
}

/// FTS5 路径：片段用双引号包成短语（trigram 即子串），多片段 AND，排他片段用 `NOT`
async fn search_fts(
    db: &DatabaseConnection,
    parsed: &ParsedQuery,
    exact: &str,
    prefix: &str,
    limit: i64,
) -> CommandResult<std::collections::VecDeque<FileRow>> {
    let quote = |term: &str| format!("\"{}\"", term.replace('"', "\"\""));
    let mut expression = parsed
        .terms
        .iter()
        .map(|term| quote(term))
        .collect::<Vec<_>>()
        .join(" AND ");
    if !parsed.excludes.is_empty() {
        let negatives = parsed
            .excludes
            .iter()
            .map(|term| quote(term))
            .collect::<Vec<_>>()
            .join(" OR ");
        expression = format!("({expression}) NOT ({negatives})");
    }

    let mut sql = String::from(
        "SELECT e.path AS path, e.name AS name, e.dir AS dir, e.ext AS ext, \
         e.is_dir AS is_dir, e.size AS size, e.mtime AS mtime \
         FROM file_entry_fts f JOIN file_entry e ON e.rowid = f.rowid \
         WHERE file_entry_fts MATCH ?",
    );
    let mut values = vec![Value::from(expression)];
    push_filters(&mut sql, &mut values, parsed, "e.");
    // 排序：完全同名 > 名字前缀 > 其它，然后 bm25，最后名字短的优先
    sql.push_str(
        " ORDER BY CASE WHEN e.name_fold = ? THEN 0 WHEN e.name_fold LIKE ? THEN 1 ELSE 2 END, \
         bm25(file_entry_fts), length(e.name) LIMIT ?",
    );
    values.push(Value::from(exact.to_lowercase()));
    values.push(Value::from(prefix.to_string()));
    values.push(Value::from(limit));
    scan::read_rows(db, sql, values).await
}

/// LIKE 路径：含 1–2 字符片段或通配符时用（短片段按前缀匹配，长片段按子串）
async fn search_like(
    db: &DatabaseConnection,
    parsed: &ParsedQuery,
    exact: &str,
    prefix: &str,
    limit: i64,
) -> CommandResult<std::collections::VecDeque<FileRow>> {
    let mut sql = String::from(
        "SELECT path AS path, name AS name, dir AS dir, ext AS ext, \
         is_dir AS is_dir, size AS size, mtime AS mtime FROM file_entry WHERE 1 = 1",
    );
    let mut values: Vec<Value> = Vec::new();
    for term in &parsed.terms {
        let short = term.chars().count() < MIN_FTS_CHARS;
        sql.push_str(" AND name_fold LIKE ? ESCAPE '\\'");
        values.push(Value::from(like_pattern(term, short)));
    }
    for term in &parsed.excludes {
        sql.push_str(" AND name_fold NOT LIKE ? ESCAPE '\\'");
        values.push(Value::from(like_pattern(term, false)));
    }
    push_filters(&mut sql, &mut values, parsed, "");
    sql.push_str(
        " ORDER BY CASE WHEN name_fold = ? THEN 0 WHEN name_fold LIKE ? THEN 1 ELSE 2 END, \
         length(name), name LIMIT ?",
    );
    values.push(Value::from(exact.to_lowercase()));
    values.push(Value::from(prefix.to_string()));
    values.push(Value::from(limit));
    scan::read_rows(db, sql, values).await
}

// ─── IPC ───

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFilesP {
    pub query: String,
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFileP {
    pub path: String,
}

/// 打开 / 定位只放行「索引里出现过的路径」——命令面不能退化成任意路径打开器。
async fn ensure_indexed(index: &FileIndex, path: &str) -> CommandResult<()> {
    if index.is_indexed(path).await? {
        return Ok(());
    }
    Err(Exception::Validation(
        "该路径不在文件索引里，拒绝打开".into(),
    ))
}

#[tauri::command(rename = "search:openFile")]
pub async fn search_open_file(state: State<'_, FileIndex>, params: OpenFileP) -> CommandResult<()> {
    ensure_indexed(state.inner(), &params.path).await?;
    tauri_plugin_opener::open_path(params.path, None::<String>)
        .map_err(|error| Exception::Internal(format!("打开文件失败：{error}")))
}

#[tauri::command(rename = "search:revealFile")]
pub async fn search_reveal_file(
    state: State<'_, FileIndex>,
    params: OpenFileP,
) -> CommandResult<()> {
    ensure_indexed(state.inner(), &params.path).await?;
    tauri_plugin_opener::reveal_item_in_dir(&params.path)
        .map_err(|error| Exception::Internal(format!("打开所在文件夹失败：{error}")))
}

#[tauri::command(rename = "search:files")]
pub async fn search_files(
    state: State<'_, FileIndex>,
    params: SearchFilesP,
) -> CommandResult<Vec<FileHitR>> {
    state.search(&params.query, params.limit.unwrap_or(6)).await
}

#[tauri::command(rename = "search:fileIndexStatus")]
pub fn search_file_index_status(state: State<'_, FileIndex>) -> CommandResult<FileIndexStatusR> {
    Ok(state.status())
}

/// 重建是后台任务：立即返回，进度看 `search:fileIndexStatus`
#[tauri::command(rename = "search:fileIndexRebuild")]
pub fn search_file_index_rebuild(state: State<'_, FileIndex>) -> CommandResult<()> {
    let index = state.inner().clone();
    if index.is_scanning() {
        return Ok(());
    }
    tauri::async_runtime::spawn(async move {
        if let Err(error) = index.rebuild().await {
            eprintln!("[file-index] 重建失败：{error}");
        }
    });
    Ok(())
}

/// 停止正在进行的扫描（全盘扫描对低配机是很重的 IO，必须能中途收手）。
#[tauri::command(rename = "search:fileIndexCancel")]
pub fn search_file_index_cancel(state: State<'_, FileIndex>) -> CommandResult<()> {
    state.cancel();
    Ok(())
}

/// 索引库放在应用数据目录下的独立文件里
pub fn database_path(app_local: &Path) -> PathBuf {
    app_local.join("index").join("files.db")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_terms_with_and_semantics() {
        let parsed = parse_query("foo bar");
        assert_eq!(parsed.terms, vec!["foo", "bar"]);
        assert!(parsed.fts_ready());
    }

    #[test]
    fn parses_filters_excludes_and_case() {
        let parsed = parse_query("!cache ext:.rs,ts path:src Cargo");
        assert_eq!(parsed.excludes, vec!["cache"]);
        assert_eq!(parsed.exts, vec!["rs", "ts"]);
        assert_eq!(parsed.dirs, vec!["src"]);
        assert_eq!(parsed.terms, vec!["cargo"]);
    }

    #[test]
    fn keeps_quoted_phrase_together() {
        let parsed = parse_query("\"foo bar\" baz");
        assert_eq!(parsed.terms, vec!["foo bar", "baz"]);
    }

    #[test]
    fn short_or_wildcard_queries_fall_back_to_like() {
        assert!(!parse_query("ab").fts_ready());
        assert!(!parse_query("abc*").fts_ready());
        assert!(!parse_query("ext:rs").fts_ready());
        assert!(parse_query("Cargo.toml").fts_ready());
    }

    #[test]
    fn translates_wildcards_and_escapes_like_metacharacters() {
        assert_eq!(like_pattern("a*b", false), "%a%b%");
        assert_eq!(like_pattern("a?b", true), "a_b%");
        assert_eq!(like_pattern("50%", false), "%50\\%%");
        assert_eq!(like_pattern("a_b", true), "a\\_b%");
    }

    fn row(path: &str, name: &str, ext: &str) -> FileRow {
        let path = std::path::Path::new(path);
        FileRow {
            path: path.to_string_lossy().into_owned(),
            name: name.to_string(),
            name_fold: name.to_lowercase(),
            dir: path
                .parent()
                .map(|item| item.to_string_lossy().into_owned())
                .unwrap_or_default(),
            ext: ext.to_string(),
            size: 1,
            mtime: 1,
            is_dir: false,
        }
    }

    /// 端到端：真的建库、真的走 FTS5 与 LIKE 两条 SQL
    #[tokio::test]
    async fn queries_hit_a_real_index() {
        let root = std::env::temp_dir().join(format!("cogito-index-{}", uuid::Uuid::new_v4()));
        let index = FileIndex::new(root.join("files.db"));
        let db = index.inner.connection().await.expect("打开索引");

        let rows = vec![
            row(r"D:\work\Cargo.toml", "Cargo.toml", "toml"),
            row(r"D:\work\src\main.rs", "main.rs", "rs"),
            row(r"D:\work\src\main_helper.rs", "main_helper.rs", "rs"),
        ];
        scan::commit_batch(&db, &rows, false).await.expect("写入");

        // ≥3 字符走 FTS5 子串
        let hits = index.search("argo", 5).await.expect("FTS 查询");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "Cargo.toml");

        // AND 语义 + ext 过滤
        let hits = index.search("main ext:rs", 5).await.expect("AND 查询");
        assert_eq!(hits.len(), 2);

        // 排除：`!helper` 只剩 main.rs
        let hits = index.search("main !helper", 5).await.expect("排除查询");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "main.rs");

        // 1–2 字符退回 LIKE 前缀
        let hits = index.search("ma", 5).await.expect("LIKE 查询");
        assert_eq!(hits.len(), 2);

        // 增量写：改名后 FTS 跟着变（验证 ON CONFLICT 的改名分支与触发器）
        let renamed = vec![row(r"D:\work\src\main.rs", "renamed_main.rs", "rs")];
        scan::commit_batch(&db, &renamed, true)
            .await
            .expect("增量写入");
        let hits = index.search("main ext:rs", 5).await.expect("改名后查询");
        assert!(hits.iter().all(|hit| hit.name != "main.rs"));
        assert!(hits.iter().any(|hit| hit.name == "renamed_main.rs"));

        let _ = std::fs::remove_dir_all(&root);
    }
}
