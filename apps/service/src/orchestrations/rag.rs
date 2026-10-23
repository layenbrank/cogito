//! RAG 索引长任务（`rag.index-asset`）：抽取分块 → 分批嵌入 → 落检索索引。
//!
//! 这条工作流是 P4 的验收对象，也是「长任务该长什么样」的样板：
//!
//! - **每一步都是一个活动**，所以进程崩了只重跑当前这一步，前面的结果在历史里；
//! - **嵌入按批切分**（批大小来自配置）：块多的文档不会被当成一次超长调用，
//!   也不会因为第 3 批失败而从第 1 批重来；
//! - **幂等键 = 实例 id + 步骤**，活动重跑时下游认得出这是同一步，不重复落数据；
//! - **进度写进 custom status**（`chunked:<n>` / `embedded:<to>` / `indexed`），
//!   运维和测试都能从这里看出一条长任务走到哪了。
//!
//! 确定性约束（见 `mod.rs` 的铁律）：编排里不碰系统时间、不碰网络、不遍历 HashMap；
//! 所有网络调用都在活动里，所有分支只看输入与历史里的步骤结果。

use std::sync::Arc;

use durable::{Activities, OrchestrationContext, Orchestrations};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::clients::compute::{
    ComputeClient, ComputeError, CallMeta, ChunkRequest, ChunkResponse, EmbedRequest,
    EmbedResponse, INTERNAL_SCHEMA_VERSION, IndexRequest, IndexResponse,
};
use crate::orchestrations::retry;

/// 编排名。名字是持久化契约：改名等于换了工作流，正在跑的实例会找不到实现。
pub const INDEX_ASSET: &str = "rag.index-asset";
/// 活动：抽取文本并分块。
pub const CHUNK_OBJECT: &str = "rag.chunk-object";
/// 活动：为一批块算嵌入。
pub const EMBED_BATCH: &str = "rag.embed-batch";
/// 活动：把块集落进检索索引。
pub const UPSERT_INDEX: &str = "rag.upsert-index";

/// 编排输入（也是分块那一步的输入）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexAssetInput {
    #[serde(rename = "tenantID")]
    pub tenant_id: String,
    #[serde(rename = "assetID")]
    pub asset_id: String,
    pub mime: String,
    /// 原始文件名，用于抽取器选择策略。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// 上游链路（事件信封里的 `traceparent`）。缺失时按下游调用自身的幂等键派生。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traceparent: Option<String>,
}

/// 编排输出：一条长任务跑完之后，运维真正关心的那几个数。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexAssetOutput {
    #[serde(rename = "assetID")]
    pub asset_id: String,
    #[serde(rename = "chunkSetID")]
    pub chunk_set_id: String,
    pub chunk_count: i32,
    pub batches: i32,
    pub dimensions: i32,
    pub indexed: i32,
    pub collection: String,
}

/// 嵌入活动的输入：只带块集与区间，不带文本（契约约定不回传块正文）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EmbedStepInput {
    #[serde(rename = "tenantID")]
    tenant_id: String,
    #[serde(rename = "assetID")]
    asset_id: String,
    #[serde(rename = "chunkSetID")]
    chunk_set_id: String,
    model: String,
    from: i32,
    to: i32,
    traceparent: Option<String>,
}

/// 落索引活动的输入。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexStepInput {
    #[serde(rename = "tenantID")]
    tenant_id: String,
    #[serde(rename = "assetID")]
    asset_id: String,
    #[serde(rename = "chunkSetID")]
    chunk_set_id: String,
    chunk_count: i32,
    model: String,
    dimensions: i32,
    traceparent: Option<String>,
}

/// 注册三个活动。`client` 是唯一出站口，活动只负责「调用 + 分类错误」。
pub fn register_activities(activities: Activities, client: Arc<ComputeClient>) -> Activities {
    let chunk = Arc::clone(&client);
    let activities = activities.register(CHUNK_OBJECT, move |ctx, input: String| {
        let client = Arc::clone(&chunk);
        async move {
            let step: IndexAssetInput = decode(&input)?;
            let request = ChunkRequest {
                schema_version: INTERNAL_SCHEMA_VERSION,
                tenant_id: step.tenant_id,
                mime: step.mime,
                name: step.name,
                chunk_size: None,
                chunk_overlap: None,
            };
            let meta = CallMeta::new(
                idempotency_key(ctx.instance_id(), "chunk"),
                step.traceparent,
            );

            let response = client
                .chunk_object(&step.asset_id, &request, &meta)
                .await
                .map_err(classify)?;

            encode(&response)
        }
    });

    let embed = Arc::clone(&client);
    let activities = activities.register(EMBED_BATCH, move |ctx, input: String| {
        let client = Arc::clone(&embed);
        async move {
            let step: EmbedStepInput = decode(&input)?;
            let request = EmbedRequest {
                schema_version: INTERNAL_SCHEMA_VERSION,
                tenant_id: step.tenant_id,
                chunk_set_id: step.chunk_set_id,
                model: step.model,
                from: step.from,
                to: step.to,
            };
            let meta = CallMeta::new(
                idempotency_key(
                    ctx.instance_id(),
                    &format!("embed:{}", range_label(step.from, step.to)),
                ),
                step.traceparent,
            );

            let response = client
                .embed_range(&step.asset_id, &request, &meta)
                .await
                .map_err(classify)?;

            encode(&response)
        }
    });

    activities.register(UPSERT_INDEX, move |ctx, input: String| {
        let client = Arc::clone(&client);
        async move {
            let step: IndexStepInput = decode(&input)?;
            let request = IndexRequest {
                schema_version: INTERNAL_SCHEMA_VERSION,
                tenant_id: step.tenant_id,
                chunk_set_id: step.chunk_set_id.clone(),
                chunk_count: step.chunk_count,
                model: step.model,
                dimensions: step.dimensions,
            };
            let meta = CallMeta::new(
                idempotency_key(ctx.instance_id(), "index"),
                step.traceparent,
            );

            let response = client
                .upsert_index(&step.asset_id, &request, &meta)
                .await
                .map_err(classify)?;

            encode(&response)
        }
    })
}

/// 注册编排。嵌入批大小与模型在装配时注入：它们会随实例一起进历史，
/// 一次编排里的每一步用的是同一套参数。
pub fn register_orchestration(
    orchestrations: Orchestrations,
    embed_batch_size: usize,
    embed_model: String,
) -> Orchestrations {
    orchestrations.register(INDEX_ASSET, move |ctx, input: String| {
        let embed_model = embed_model.clone();
        async move { index_asset(ctx, input, embed_batch_size, embed_model).await }
    })
}

/// 一条长任务的全部逻辑：三步 + 分批循环。
async fn index_asset(
    ctx: OrchestrationContext,
    input: String,
    embed_batch_size: usize,
    embed_model: String,
) -> Result<String, String> {
    let step: IndexAssetInput = decode(&input)?;
    let traceparent = step.traceparent.clone();

    // ① 抽取 + 分块：这一步会把纯文本落进 compute 侧，之后只传块集 id。
    let chunk: ChunkResponse =
        decode(&retry::run_activity(&ctx, CHUNK_OBJECT, &encode(&step)?).await?)?;
    ctx.set_custom_status(format!("chunked:{}", chunk.chunk_count));
    ctx.trace_info(format!(
        "分块完成：chunkSetID={} chunkCount={}",
        chunk.chunk_set_id, chunk.chunk_count
    ));

    // ② 分批嵌入：批大小来自配置，一批 = 历史里的一步，崩了只重跑当前批。
    let batch_size = embed_batch_size.max(1) as i32;
    let mut from = 0;
    let mut dimensions = 0;
    let mut batches = 0;
    while from < chunk.chunk_count {
        let to = from.saturating_add(batch_size).min(chunk.chunk_count);
        let embed_step = EmbedStepInput {
            tenant_id: step.tenant_id.clone(),
            asset_id: step.asset_id.clone(),
            chunk_set_id: chunk.chunk_set_id.clone(),
            model: embed_model.clone(),
            from,
            to,
            traceparent: traceparent.clone(),
        };
        let embedded: EmbedResponse =
            decode(&retry::run_activity(&ctx, EMBED_BATCH, &encode(&embed_step)?).await?)?;

        if embedded.from != from || embedded.to != to {
            return Err(retry::permanent(format!(
                "嵌入活动返回的区间与请求不一致：请求 [{from},{to})，返回 [{},{}）",
                embedded.from, embedded.to
            )));
        }
        // 同一个块集的向量维度必须一致，否则索引里会混进两种维度。
        if batches > 0 && dimensions != embedded.dimensions {
            return Err(retry::permanent(format!(
                "同一块集的向量维度不一致：先 {} 后 {}",
                dimensions, embedded.dimensions
            )));
        }
        dimensions = embedded.dimensions;
        batches += 1;
        ctx.set_custom_status(format!("embedded:{to}"));
        from = to;
    }

    // ③ 落索引：块数为 0 也要走这一步（旧版本要在索引里被替换掉，而不是留在那儿）。
    let index_step = IndexStepInput {
        tenant_id: step.tenant_id.clone(),
        asset_id: step.asset_id.clone(),
        chunk_set_id: chunk.chunk_set_id.clone(),
        chunk_count: chunk.chunk_count,
        model: embed_model,
        dimensions,
        traceparent,
    };
    let indexed: IndexResponse =
        decode(&retry::run_activity(&ctx, UPSERT_INDEX, &encode(&index_step)?).await?)?;
    ctx.set_custom_status("indexed");
    ctx.trace_info(format!(
        "索引完成：collection={} indexed={}",
        indexed.collection, indexed.indexed
    ));

    encode(&IndexAssetOutput {
        asset_id: step.asset_id,
        chunk_set_id: chunk.chunk_set_id,
        chunk_count: chunk.chunk_count,
        batches,
        dimensions,
        indexed: indexed.indexed,
        collection: indexed.collection,
    })
}

/// 幂等键：`<实例 id>:<步骤>`。实例 id 由框架生成，同一实例重放拿到同一个键。
fn idempotency_key(instance: &str, step: &str) -> String {
    format!("{instance}:{step}")
}

/// 区间标签（`0-16`）用于幂等键与日志，两侧都是半开区间。
fn range_label(from: i32, to: i32) -> String {
    format!("{from}-{to}")
}

/// 活动失败 → 编排能读懂的语义。分类只在活动里做，因为只有它知道下游回了什么。
fn classify(error: ComputeError) -> String {
    if error.is_retryable() {
        retry::transient(error.to_string())
    } else {
        retry::permanent(error.to_string())
    }
}

fn encode<T: Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(|e| retry::permanent(format!("步骤输出无法编码: {e}")))
}

fn decode<T: DeserializeOwned>(raw: &str) -> Result<T, String> {
    serde_json::from_str(raw).map_err(|e| retry::permanent(format!("步骤输入无法解析: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> IndexAssetInput {
        IndexAssetInput {
            tenant_id: "t-1".into(),
            asset_id: "a-1".into(),
            mime: "text/markdown".into(),
            name: Some("readme.md".into()),
            traceparent: None,
        }
    }

    #[test]
    fn names_are_stable() {
        // 名字进的是数据库（编排历史），改字面量等于换工作流。
        assert_eq!(INDEX_ASSET, "rag.index-asset");
        assert_eq!(CHUNK_OBJECT, "rag.chunk-object");
        assert_eq!(EMBED_BATCH, "rag.embed-batch");
        assert_eq!(UPSERT_INDEX, "rag.upsert-index");
    }

    #[test]
    fn input_round_trips_with_camel_case() {
        let json = encode(&input()).expect("encode");
        assert!(json.contains(r#""tenantID":"t-1""#), "{json}");
        assert!(json.contains(r#""mime":"text/markdown""#), "{json}");
        assert!(
            !json.contains("objectKey"),
            "编排输入不该带对象存储键：正文由 compute 回打 cogito 内容端点取 —— {json}"
        );
        assert!(!json.contains("traceparent"), "缺省链路不该出现在输入里");

        let parsed: IndexAssetInput = decode(&json).expect("decode");
        assert_eq!(parsed.asset_id, "a-1");
        assert!(parsed.traceparent.is_none());
    }

    #[test]
    fn idempotency_keys_are_step_scoped() {
        assert_eq!(idempotency_key("inst-1", "chunk"), "inst-1:chunk");
        assert_eq!(
            idempotency_key("inst-1", &format!("embed:{}", range_label(16, 32))),
            "inst-1:embed:16-32"
        );
        assert_ne!(
            idempotency_key("inst-1", &format!("embed:{}", range_label(0, 16))),
            idempotency_key("inst-1", &format!("embed:{}", range_label(16, 32))),
            "不同批次必须是不同的键，否则第二批会被当成第一批的重放"
        );
    }

    #[test]
    fn classifies_retryability() {
        assert!(classify(ComputeError::RateLimited).starts_with(retry::TRANSIENT));
        assert!(classify(ComputeError::Timeout).starts_with(retry::TRANSIENT));
        assert!(
            classify(ComputeError::Rejected {
                status: 400,
                body: "bad".into()
            })
            .starts_with(retry::PERMANENT)
        );
    }

    #[test]
    fn bad_input_is_permanent_so_it_never_retries() {
        let error = decode::<IndexAssetInput>("{ not json").expect_err("应当失败");
        assert!(retry::is_permanent(&error), "{error}");
    }

    #[test]
    fn output_round_trips() {
        let output = IndexAssetOutput {
            asset_id: "a-1".into(),
            chunk_set_id: "cs-1".into(),
            chunk_count: 48,
            batches: 3,
            dimensions: 1536,
            indexed: 48,
            collection: "rag_v1".into(),
        };
        let json = encode(&output).expect("encode");
        let parsed: IndexAssetOutput = decode(&json).expect("decode");
        assert_eq!(parsed.chunk_count, 48);
        assert_eq!(parsed.batches, 3);
    }
}
