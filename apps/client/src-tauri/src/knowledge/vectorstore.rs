//! LanceDB 向量持久（v1：一页一行）。对齐 llm_wiki vectorstore 精简面。
//!
//! ## 为什么写这么重
//!
//! 旧实现每次调用都 `connect()` 新建连接，然后 `delete` + `add` 同一个数据集。
//! 前端 `upsertPageEmbeddings` 是并发 worker，两个 worker 会在同一张 Lance 表上
//! 交错 delete/add，Lance 内部 clone manifest 时会撞版本；更致命的是**没有维度校验**——
//! 用户换了 embedding 模型后查询向量长度与 `FixedSizeList(dim)` 不一致，
//! arrow 侧直接 panic。release 又是 `panic = "abort"`，一次 panic 整个 App 消失，
//! 而 sidecar 回收挂在 `RunEvent::Exit` 上，于是 `corex-daemon` / `goose` 成了孤儿。
//!
//! 所以这里做四件事：
//! 1. **连接单例**（`OnceLock` 缓存每个库目录的 `Connection`，不再每次 connect）；
//! 2. **写串行**（全局写锁，delete + add 作为一个整体，不再交错）；
//! 3. **先校验维度**（不改库 schema，直接返回结构化错误，绝不进 arrow）；
//! 4. **每个 await 都有超时**（10s）＋ **`catch_unwind` 兜底**（第三方 panic 转 `Err`），
//!    配合 `[profile.release] panic = "unwind"`，任何一次异常都只是「这次写入失败」。
//!    被兜住的 panic 经 `caught_scope` 标记后落盘为 `caught: true`，补报按 `error`
//!    而不是 `fatal`，不会混进「应用崩溃」的统计里。

use std::any::Any;
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use arrow_array::{
    Array, ArrayRef, FixedSizeListArray, Float32Array, RecordBatch, StringArray,
};
use arrow_schema::{DataType, Field, Schema};
use futures::FutureExt;
use futures_util::TryStreamExt;
use lancedb::connect;
use lancedb::query::{ExecutableQuery, QueryBase};
use serde::{Deserialize, Serialize};

use crate::utils::diagnostics::caught_scope;

const TABLE_V1: &str = "wiki_vectors";
const MAX_PAGE_ID_CHARS: usize = 256;
/// 单次 Lance 操作上限：超时就返回错误，绝不让 IPC 永久挂住。
const OP_TIMEOUT: Duration = Duration::from_secs(10);

/// 每个库目录一个连接（`Connection` 是 Clone 的句柄，内部有连接池）。
static CONN_CACHE: OnceLock<tokio::sync::Mutex<HashMap<String, lancedb::Connection>>> =
    OnceLock::new();
/// 全局写锁：`delete + add` 必须是一个整体，否则并发写同一张表会互踩。
static WRITE_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VectorSearchResult {
    pub page_id: String,
    pub score: f32,
}

/// 库目录路径（分隔符统一成 `/`）。
///
/// `lancedb::connect` 对本地目录要的是普通路径；传协议前缀时 Windows 会把它
/// 整个当目录名去建，报 `os error 123`，于是所有写入都失败。这里只做归一化：
/// 反斜杠换 `/`、去尾斜杠、空路径回落相对目录。
fn db_uri(project_path: &str) -> String {
    let normalized = project_path.trim().replace('\\', "/");
    let normalized = normalized.trim_end_matches('/');
    if normalized.is_empty() {
        return ".cogito/lancedb".to_string();
    }
    format!("{normalized}/.cogito/lancedb")
}

fn validate_page_id(page_id: &str) -> Result<(), String> {
    if page_id.is_empty() || page_id.chars().count() > MAX_PAGE_ID_CHARS {
        return Err("Invalid page_id: empty or too long".to_string());
    }
    if page_id.contains('\\') || page_id.contains('\'') || page_id.contains('"') {
        return Err(format!("Invalid page_id: {page_id}"));
    }
    if page_id.contains("..") {
        return Err(format!("Invalid page_id: {page_id}"));
    }
    Ok(())
}

fn make_schema(dim: i32) -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("page_id", DataType::Utf8, false),
        Field::new(
            "vector",
            DataType::FixedSizeList(Arc::new(Field::new("item", DataType::Float32, true)), dim),
            false,
        ),
    ]))
}

fn make_batch(
    schema: Arc<Schema>,
    page_id: &str,
    embedding: Vec<f32>,
    dim: i32,
) -> Result<RecordBatch, String> {
    let ids: ArrayRef = Arc::new(StringArray::from(vec![page_id]));
    let values = Float32Array::from(embedding);
    let vector: ArrayRef = Arc::new(FixedSizeListArray::new(
        Arc::new(Field::new("item", DataType::Float32, true)),
        dim,
        Arc::new(values),
        None,
    ));
    RecordBatch::try_new(schema, vec![ids, vector]).map_err(|e| format!("Batch error: {e}"))
}

/// 表里 `vector` 列的维度；不是 FixedSizeList 就返回 `None`（旧版本 / 人工改过的库）。
fn vector_dim(schema: &Schema) -> Option<i32> {
    match schema.field_with_name("vector").ok()?.data_type() {
        DataType::FixedSizeList(_, size) => Some(*size),
        _ => None,
    }
}

/// 维度不一致时的统一错误文案（前端直接展示 + 上报）。
fn dim_mismatch_error(expected: usize, actual: usize) -> String {
    format!(
        "维度不匹配：索引是 {expected} 维，本次是 {actual} 维。\
         换过 embedding 模型需要先「清空索引」再重建（设置 → 知识库 → 向量索引）。"
    )
}

fn ensure_dim(expected: usize, actual: usize) -> Result<(), String> {
    if expected == actual {
        Ok(())
    } else {
        Err(dim_mismatch_error(expected, actual))
    }
}

/// 取（或建立）某个库目录的连接，带超时。
async fn connect_cached(uri: &str) -> Result<lancedb::Connection, String> {
    let cache = CONN_CACHE.get_or_init(|| tokio::sync::Mutex::new(HashMap::new()));
    let mut guard = tokio::time::timeout(OP_TIMEOUT, cache.lock())
        .await
        .map_err(|_| "等待数据库连接池超时".to_string())?;
    if let Some(conn) = guard.get(uri) {
        return Ok(conn.clone());
    }
    let conn = tokio::time::timeout(OP_TIMEOUT, connect(uri).execute())
        .await
        .map_err(|_| format!("连接向量库超时（{OP_TIMEOUT:?}）：{uri}"))?
        .map_err(|e| format!("DB connect error: {e}"))?;
    guard.insert(uri.to_string(), conn.clone());
    Ok(conn)
}

async fn has_table(db: &lancedb::Connection) -> Result<bool, String> {
    let tables = tokio::time::timeout(OP_TIMEOUT, db.table_names().execute())
        .await
        .map_err(|_| "列出表超时".to_string())?
        .map_err(|e| format!("List tables error: {e}"))?;
    Ok(tables.iter().any(|name| name == TABLE_V1))
}

/// 把 panic payload 压成一行文本。
fn panic_message(payload: Box<dyn Any + Send>) -> String {
    if let Some(text) = payload.downcast_ref::<&str>() {
        (*text).to_string()
    } else if let Some(text) = payload.downcast_ref::<String>() {
        text.clone()
    } else {
        "非字符串 panic payload".to_string()
    }
}

/// 统一的「隔离 + 计时 + 日志」外壳。
///
/// `catch_unwind` 只有在 `panic = "unwind"`（见 `Cargo.toml` 的 release profile）时
/// 才拦得住；设成 abort 时这里会直接 abort 进程 —— 这就是为什么 profile 必须改。
async fn guard<F>(label: &'static str, future: F) -> Result<(), String>
where
    F: std::future::Future<Output = Result<(), String>>,
{
    let started = Instant::now();
    // `caught_scope` 让 panic hook 知道这次 panic 有人兜：落盘标 caught=true，
    // 下次启动补报时按 `error` 而不是 `fatal` 上报，避免把「一次写入失败」算成应用崩溃。
    let outcome = std::panic::AssertUnwindSafe(caught_scope(future))
        .catch_unwind()
        .await;
    let elapsed_ms = started.elapsed().as_millis();
    match outcome {
        Ok(Ok(())) => {
            tracing::debug!(target: "vectorstore", "{label} 完成 {elapsed_ms}ms");
            Ok(())
        }
        Ok(Err(error)) => {
            tracing::warn!(target: "vectorstore", "{label} 失败 {elapsed_ms}ms: {error}");
            Err(error)
        }
        Err(payload) => {
            let message = panic_message(payload);
            tracing::error!(
                target: "vectorstore",
                "{label} 内部 panic 已隔离 {elapsed_ms}ms: {message}"
            );
            Err(format!("向量库内部 panic（已隔离，应用继续运行）：{message}"))
        }
    }
}

#[tauri::command]
pub async fn vector_upsert(
    project_path: String,
    page_id: String,
    embedding: Vec<f32>,
) -> Result<(), String> {
    guard("vector_upsert", async move {
        upsert_inner(project_path, page_id, embedding).await
    })
    .await
}

async fn upsert_inner(project_path: String, page_id: String, embedding: Vec<f32>) -> Result<(), String> {
    validate_page_id(&page_id)?;
    if embedding.is_empty() {
        return Err("empty embedding".to_string());
    }

    let uri = db_uri(&project_path);
    let db = connect_cached(&uri).await?;

    // 写锁：把 delete + add 收成一个整体；等锁本身也有超时，避免卡死队列
    let write_lock = WRITE_LOCK.get_or_init(|| tokio::sync::Mutex::new(()));
    let _write_guard = tokio::time::timeout(OP_TIMEOUT, write_lock.lock())
        .await
        .map_err(|_| "等待向量写入队列超时（上一次写入可能仍未结束）".to_string())?;

    if has_table(&db).await? {
        let table = tokio::time::timeout(OP_TIMEOUT, db.open_table(TABLE_V1).execute())
            .await
            .map_err(|_| "打开向量表超时".to_string())?
            .map_err(|e| format!("Open table error: {e}"))?;

        let schema = tokio::time::timeout(OP_TIMEOUT, table.schema())
            .await
            .map_err(|_| "读取表结构超时".to_string())?
            .map_err(|e| format!("Read schema error: {e}"))?;
        let dim = match vector_dim(&schema) {
            Some(dim) => dim,
            None => {
                return Err(
                    "向量表结构异常：vector 列不是 FixedSizeList，请「清空索引」后重建".to_string(),
                )
            }
        };
        ensure_dim(dim as usize, embedding.len())?;

        let batch = make_batch(make_schema(dim), &page_id, embedding, dim)?;
        // 先删后插（同一 page_id 只留一行）；两步都在写锁内
        tokio::time::timeout(
            OP_TIMEOUT,
            table.delete(&format!("page_id = '{page_id}'")),
        )
        .await
        .map_err(|_| "删除旧向量超时".to_string())?
        .map_err(|e| format!("Delete error: {e}"))?;

        tokio::time::timeout(OP_TIMEOUT, table.add(vec![batch]).execute())
            .await
            .map_err(|_| "写入向量超时".to_string())?
            .map_err(|e| format!("Add error: {e}"))?;
        return Ok(());
    }

    let dim = embedding.len() as i32;
    let batch = make_batch(make_schema(dim), &page_id, embedding, dim)?;
    tokio::time::timeout(OP_TIMEOUT, db.create_table(TABLE_V1, vec![batch]).execute())
        .await
        .map_err(|_| "创建向量表超时".to_string())?
        .map_err(|e| format!("Create table error: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn vector_search(
    project_path: String,
    query_embedding: Vec<f32>,
    top_k: usize,
) -> Result<Vec<VectorSearchResult>, String> {
    let started = Instant::now();
    let outcome = std::panic::AssertUnwindSafe(caught_scope(search_inner(
        project_path,
        query_embedding,
        top_k,
    )))
    .catch_unwind()
    .await;
    let elapsed_ms = started.elapsed().as_millis();
    match outcome {
        Ok(Ok(hits)) => {
            tracing::debug!(
                target: "vectorstore",
                "vector_search 命中 {} 条 {elapsed_ms}ms",
                hits.len()
            );
            Ok(hits)
        }
        Ok(Err(error)) => {
            tracing::warn!(target: "vectorstore", "vector_search 失败 {elapsed_ms}ms: {error}");
            Err(error)
        }
        Err(payload) => {
            let message = panic_message(payload);
            tracing::error!(
                target: "vectorstore",
                "vector_search 内部 panic 已隔离 {elapsed_ms}ms: {message}"
            );
            Err(format!("向量库内部 panic（已隔离）：{message}"))
        }
    }
}

async fn search_inner(
    project_path: String,
    query_embedding: Vec<f32>,
    top_k: usize,
) -> Result<Vec<VectorSearchResult>, String> {
    if query_embedding.is_empty() {
        return Err("empty query embedding".to_string());
    }
    let uri = db_uri(&project_path);
    let db = connect_cached(&uri).await?;
    if !has_table(&db).await? {
        return Ok(vec![]);
    }

    let table = tokio::time::timeout(OP_TIMEOUT, db.open_table(TABLE_V1).execute())
        .await
        .map_err(|_| "打开向量表超时".to_string())?
        .map_err(|e| format!("Open table error: {e}"))?;

    // 先校验维度，别让 arrow 抛 panic
    let schema = tokio::time::timeout(OP_TIMEOUT, table.schema())
        .await
        .map_err(|_| "读取表结构超时".to_string())?
        .map_err(|e| format!("Read schema error: {e}"))?;
    if let Some(dim) = vector_dim(&schema) {
        ensure_dim(dim as usize, query_embedding.len())?;
    }

    let query = table
        .vector_search(query_embedding)
        .map_err(|e| format!("Search error: {e}"))?
        .limit(top_k.clamp(1, 100));

    let batches: Vec<RecordBatch> = tokio::time::timeout(OP_TIMEOUT, query.execute())
        .await
        .map_err(|_| "向量检索超时".to_string())?
        .map_err(|e| format!("Execute search error: {e}"))?
        .try_collect()
        .await
        .map_err(|e| format!("Collect error: {e}"))?;

    let mut search_results = Vec::new();
    for batch in &batches {
        let ids = batch
            .column_by_name("page_id")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>())
            .ok_or("Missing page_id column")?;
        let distances = batch
            .column_by_name("_distance")
            .and_then(|c| c.as_any().downcast_ref::<Float32Array>())
            .ok_or("Missing _distance column")?;
        for i in 0..batch.num_rows() {
            let page_id = ids.value(i).to_string();
            let distance = distances.value(i);
            let score = 1.0 / (1.0 + distance);
            search_results.push(VectorSearchResult { page_id, score });
        }
    }
    Ok(search_results)
}

#[tauri::command]
pub async fn vector_delete(project_path: String, page_id: String) -> Result<(), String> {
    guard("vector_delete", async move {
        validate_page_id(&page_id)?;
        let uri = db_uri(&project_path);
        let db = connect_cached(&uri).await?;
        if !has_table(&db).await? {
            return Ok(());
        }
        let write_lock = WRITE_LOCK.get_or_init(|| tokio::sync::Mutex::new(()));
        let _write_guard = tokio::time::timeout(OP_TIMEOUT, write_lock.lock())
            .await
            .map_err(|_| "等待向量写入队列超时".to_string())?;
        let table = tokio::time::timeout(OP_TIMEOUT, db.open_table(TABLE_V1).execute())
            .await
            .map_err(|_| "打开向量表超时".to_string())?
            .map_err(|e| format!("Open table error: {e}"))?;
        tokio::time::timeout(
            OP_TIMEOUT,
            table.delete(&format!("page_id = '{page_id}'")),
        )
        .await
        .map_err(|_| "删除向量超时".to_string())?
        .map_err(|e| format!("Delete error: {e}"))?;
        Ok(())
    })
    .await
}

/// 清空当前库的全部向量（删表）：换过 embedding 模型后必须走这里重建。
#[tauri::command]
pub async fn vector_clear(project_path: String) -> Result<(), String> {
    guard("vector_clear", async move {
        let uri = db_uri(&project_path);
        let db = connect_cached(&uri).await?;
        if !has_table(&db).await? {
            return Ok(());
        }
        let write_lock = WRITE_LOCK.get_or_init(|| tokio::sync::Mutex::new(()));
        let _write_guard = tokio::time::timeout(OP_TIMEOUT, write_lock.lock())
            .await
            .map_err(|_| "等待向量写入队列超时".to_string())?;
        // 删表而不是删行：换模型后 schema 维度会变，留着表反而会一直「维度不匹配」
        tokio::time::timeout(OP_TIMEOUT, db.drop_table(TABLE_V1, &[]))
            .await
            .map_err(|_| "清空向量索引超时".to_string())?
            .map_err(|e| format!("Drop table error: {e}"))?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn vector_count(project_path: String) -> Result<usize, String> {
    let started = Instant::now();
    let result = count_inner(project_path).await;
    tracing::debug!(
        target: "vectorstore",
        "vector_count {}ms: {:?}",
        started.elapsed().as_millis(),
        result
    );
    result
}

async fn count_inner(project_path: String) -> Result<usize, String> {
    let uri = db_uri(&project_path);
    let db = connect_cached(&uri).await?;
    if !has_table(&db).await? {
        return Ok(0);
    }
    let table = tokio::time::timeout(OP_TIMEOUT, db.open_table(TABLE_V1).execute())
        .await
        .map_err(|_| "打开向量表超时".to_string())?
        .map_err(|e| format!("Open table error: {e}"))?;
    let count = tokio::time::timeout(OP_TIMEOUT, table.count_rows(None))
        .await
        .map_err(|_| "统计行数超时".to_string())?
        .map_err(|e| format!("Count error: {e}"))?;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn db_path_is_normalized() {
        assert_eq!(
            db_uri("C:\\Users\\me\\wiki"),
            "C:/Users/me/wiki/.cogito/lancedb"
        );
        assert_eq!(
            db_uri("C:/Users/me/wiki/"),
            "C:/Users/me/wiki/.cogito/lancedb"
        );
        assert_eq!(db_uri("/home/me/wiki"), "/home/me/wiki/.cogito/lancedb");
    }

    #[test]
    fn dim_mismatch_is_rejected() {
        let error = ensure_dim(1536, 3).expect_err("维度不一致必须报错");
        assert!(error.contains("维度不匹配"), "错误文案要可读: {error}");
        assert!(error.contains("1536") && error.contains('3'));
        assert!(ensure_dim(1536, 1536).is_ok(), "维度一致要放行");
    }

    #[test]
    fn vector_dim_reads_fixed_size_list() {
        let schema = make_schema(8);
        assert_eq!(vector_dim(&schema), Some(8));
    }

    #[test]
    fn page_id_guard_rejects_traversal() {
        assert!(validate_page_id("../etc/passwd").is_err());
        assert!(validate_page_id("a\\b").is_err());
        assert!(validate_page_id("").is_err());
        assert!(validate_page_id("wiki/页面.md").is_ok());
    }

    #[test]
    fn panic_message_handles_both_payloads() {
        let boxed: Box<dyn Any + Send> = Box::new("boom");
        assert_eq!(panic_message(boxed), "boom");
        let owned: Box<dyn Any + Send> = Box::new(String::from("炸了"));
        assert_eq!(panic_message(owned), "炸了");
    }

    /// 真实落盘的并发用例：8 个 worker 同时写同一张表不能 panic， 换 embedding 模型（维度变化）必须在进 arrow 之前被结构化拒绝。
    ///
    /// 用临时目录当库根，跑完**不删目录** —— 连接缓存在 `CONN_CACHE` 里，
    /// Windows 上删不掉还被占用的 lancedb 目录（删失败会让用例红得莫名其妙）。
    #[tokio::test]
    async fn concurrent_upserts_survive_and_dim_mismatch_is_rejected() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("系统时间不应早于 1970")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "cogito-vectorstore-{}-{stamp}",
            std::process::id()
        ));
        let project_path = root.display().to_string();

        // lance 不会替我们建父目录（Windows 上缺目录会报 os error 123）
        std::fs::create_dir_all(&root).expect("创建临时库目录");

        // 1) 8 次并发 upsert（前端 embedding worker 就是这个并发度）
        let mut tasks = Vec::new();
        for index in 0..8 {
            let project_path = project_path.clone();
            let page_id = format!("page-{index}.md");
            tasks.push(tokio::spawn(async move {
                vector_upsert(project_path, page_id, vec![0.1_f32; 4]).await
            }));
        }
        for task in tasks {
            let outcome = task.await.expect("写入任务本身不应 panic");
            assert!(outcome.is_ok(), "并发写入应该成功，实际 {outcome:?}");
        }
        assert_eq!(
            count_inner(project_path.clone()).await.expect("统计行数"),
            8,
            "8 个 page_id 应该落成 8 行"
        );

        // 2) 同一 page_id 覆盖写不应该变成两行
        vector_upsert(project_path.clone(), "page-0.md".to_string(), vec![0.2_f32; 4])
            .await
            .expect("覆盖写应该成功");
        assert_eq!(
            count_inner(project_path.clone()).await.expect("统计行数"),
            8,
            "delete + add 必须只留一行"
        );

        // 3) 维度不一致：写入侧直接返回可读错误，进程继续
        let mismatch = vector_upsert(project_path.clone(), "bad.md".to_string(), vec![0.1_f32; 3])
            .await
            .expect_err("3 维写入必须被拒绝");
        assert!(mismatch.contains("维度不匹配"), "错误文案要可读: {mismatch}");

        // 4) 检索侧同样先校验维度（不让 arrow panic）
        assert!(
            vector_search(project_path.clone(), vec![0.1_f32; 3], 5)
                .await
                .is_err(),
            "3 维检索也要被拒绝"
        );

        // 5) 正常检索：top_k 生效，score 为正
        let hits = vector_search(project_path, vec![0.1_f32; 4], 2)
            .await
            .expect("4 维检索应该成功");
        assert_eq!(hits.len(), 2, "top_k=2 应该只返回 2 条");
        assert!(hits.iter().all(|hit| hit.score > 0.0), "score 应为正数");
    }
}
