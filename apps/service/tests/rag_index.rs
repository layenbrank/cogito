//! RAG 索引长任务端到端（P4d）：编排 → 活动 → compute（桩），带观察窗口。
//!
//! 需要独立测试库（库名必须含 `test`）：
//!
//! ```text
//! TEST_DATABASE_URL=******127.0.0.1:5432/cogito_service_test \
//!   cargo test --test rag_index -- --test-threads=1
//! ```
//!
//! 未设置 `TEST_DATABASE_URL` 时整体跳过。
//!
//! 这条用例断言的是「长任务该长什么样」：
//! 1. **分块的只分块一次**：后续步骤靠块集 id，不重传正文；
//! 2. **嵌入按批切分**：48 块 / 批 16 = 3 批，区间连续且是半开区间；
//! 3. **每步都带幂等键与链路**：幂等键 = `<实例 id>:<步骤>`，三个头齐全，同一个实例
//!    的每一步共享同一条 trace-id；
//! 4. **进度可见**：`chunked:48` → `embedded:16` → `embedded:32` → `embedded:48`。
//!    栅栏的做法是：桩把「第 n 个嵌入/落索引请求」**按住不放**，编排因此停在上一步刚提交的
//!    状态上（下一步的请求还在飞），此时读到的进度是稳定值，不存在窗口错过的竞争。
//!
//! 最后一步的 `indexed` 不在这里断言：它和实例完成是同一次写入（见 crates/durable/README.md
//! 的「状态只在 turn 边界持久化」），轮询几乎必然错过它。

mod support;

use std::sync::{Arc, LazyLock};
use std::time::Duration;

use durable::{Runtime, RuntimeTuning, Store};
use serde_json::{Value, json};
use cogito::clients::compute::ComputeClient;
use cogito::orchestrations;
use tokio::sync::Mutex;

use support::{
    Script, StubCompute, settings, test_database_url, test_schema, wait_for_custom_status,
};

/// 每个用例都要建/删 schema，且共用同一个测试库，因此必须串行。
static DB_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

const TENANT: &str = "11111111-1111-1111-1111-111111111111";
const ASSET: &str = "asset-1";
const INSTANCE: &str = "rag-index-1";
const CHUNK_SET: &str = "chunk-set-0001";
const BATCH: usize = 16;
const CHUNKS: i32 = 48;
const DIMENSIONS: i32 = 1536;
const EMBED_MODEL: &str = "test-embedding-model";
/// 上游带进来的链路（trace-id 必须原样透传到每一步）。
const TRACE_ID: &str = "4bf92f3577b34da6a3ce929d0e0e4736";
const TRACEPARENT: &str = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

#[tokio::test]
async fn rag_index_batches_every_step_and_reports_progress() {
    let Some(uri) = test_database_url() else {
        eprintln!("跳过：未设置 TEST_DATABASE_URL");
        return;
    };
    let _guard = DB_LOCK.lock().await;

    let schema = test_schema();
    let store = Store::connect(&settings(&uri, &schema))
        .await
        .expect("连接编排库");
    let client = store.client();

    let stub = StubCompute::start(
        Script::new(CHUNKS, DIMENSIONS)
            .chunk_set_id(CHUNK_SET)
            .collection("test_chunks")
            // 每一步的出站请求都按住：编排会停在这一步，测试从容读进度，读完再放行。
            .hang("/embeddings", 1)
            .hang("/embeddings", 2)
            .hang("/embeddings", 3)
            .hang("/index", 1),
    )
    .await;

    let compute = Arc::new(
        ComputeClient::from_parts(&stub.base_url(), "test-internal-token", 10_000, false)
            .expect("装配 compute 客户端"),
    );
    let registrations = orchestrations::registrations(compute, BATCH, EMBED_MODEL.to_owned());
    let runtime = Runtime::start(
        &store,
        registrations.activities,
        registrations.orchestrations,
        RuntimeTuning::default(),
    )
    .await
    .expect("起运行时");

    client
        .start(
            INSTANCE,
            orchestrations::rag::INDEX_ASSET,
            &json!({
                "tenantID": TENANT,
                "assetID": ASSET,
                "mime": "text/plain",
                "name": "readme.md",
                "traceparent": TRACEPARENT,
            }),
        )
        .await
        .expect("起实例");

    // 栅栏：桩按住第 n 个请求 = 前一批已经嵌完、下一步正在飞，此刻的进度必然是上一档。
    stub.wait_for("/embeddings", 1, Duration::from_secs(60))
        .await;
    wait_for_custom_status(&client, INSTANCE, "chunked:48").await;
    stub.release("/embeddings", 1);

    stub.wait_for("/embeddings", 2, Duration::from_secs(60))
        .await;
    wait_for_custom_status(&client, INSTANCE, "embedded:16").await;
    stub.release("/embeddings", 2);

    stub.wait_for("/embeddings", 3, Duration::from_secs(60))
        .await;
    wait_for_custom_status(&client, INSTANCE, "embedded:32").await;
    stub.release("/embeddings", 3);

    stub.wait_for("/index", 1, Duration::from_secs(60)).await;
    wait_for_custom_status(&client, INSTANCE, "embedded:48").await;
    stub.release("/index", 1);

    let status = client
        .wait(INSTANCE, Duration::from_secs(60))
        .await
        .expect("等结果");
    assert!(status.is_terminal(), "实例应当跑完，实际：{status:?}");

    let chunks = stub.matching("/chunks");
    assert_eq!(chunks.len(), 1, "分块只应当发生一次");
    assert_eq!(chunks[0].method, "POST");
    assert_eq!(chunks[0].internal_token(), "test-internal-token");
    assert_eq!(chunks[0].idempotency_key(), format!("{INSTANCE}:chunk"));
    // 对象存储布局是 cogito 的实现细节：出站请求里不带对象键，正文由 compute 回打内容端点取。
    assert!(
        chunks[0].json().get("objectKey").is_none(),
        "分块请求不该带对象存储键：{}",
        chunks[0].json()
    );
    assert_eq!(chunks[0].json()["mime"], json!("text/plain"));
    assert_eq!(chunks[0].json()["name"], json!("readme.md"));
    assert_eq!(chunks[0].json()["schemaVersion"], json!(1));

    let embeds = stub.matching("/embeddings");
    assert_eq!(embeds.len(), 3, "48 块 / 批 16 应当是 3 次嵌入调用");
    let ranges = embeds
        .iter()
        .map(|request| {
            let payload = request.json();
            (payload["from"].as_i64(), payload["to"].as_i64())
        })
        .collect::<Vec<_>>();
    assert_eq!(
        ranges,
        vec![
            (Some(0), Some(16)),
            (Some(16), Some(32)),
            (Some(32), Some(48)),
        ],
        "嵌入区间必须连续且是半开区间"
    );
    assert_eq!(
        stub.idempotency_keys("/embeddings"),
        vec![
            format!("{INSTANCE}:embed:0-16"),
            format!("{INSTANCE}:embed:16-32"),
            format!("{INSTANCE}:embed:32-48"),
        ],
        "幂等键 = 实例 id + 步骤"
    );
    assert_eq!(embeds[0].json()["model"], json!(EMBED_MODEL));
    assert_eq!(embeds[0].json()["chunkSetID"], json!(CHUNK_SET));
    assert_eq!(embeds[0].json()["tenantID"], json!(TENANT));

    let index = stub.matching("/index");
    assert_eq!(index.len(), 1, "落索引只应当发生一次");
    assert_eq!(index[0].method, "PUT");
    assert_eq!(index[0].idempotency_key(), format!("{INSTANCE}:index"));
    assert_eq!(index[0].json()["chunkCount"], json!(CHUNKS));
    assert_eq!(index[0].json()["dimensions"], json!(DIMENSIONS));
    assert_eq!(index[0].json()["chunkSetID"], json!(CHUNK_SET));

    // 每一步都是同一个实例的同一条链路：trace-id 透传，span-id 各不相同。
    let mut spans = Vec::new();
    for request in &stub.requests() {
        let traceparent = request.traceparent();
        assert!(
            traceparent.starts_with(&format!("00-{TRACE_ID}-")) && traceparent.ends_with("-01"),
            "traceparent 应当沿用上游 trace-id：{traceparent}"
        );
        spans.push(traceparent[36..52].to_owned());
    }
    spans.sort();
    spans.dedup();
    assert_eq!(spans.len(), 5, "5 次出站调用应当各有一个 span-id");

    let output: Value = serde_json::from_str(status.output().expect("完成态必须有输出"))
        .expect("编排输出必须是 JSON");
    assert_eq!(output["assetID"], json!(ASSET));
    assert_eq!(output["chunkSetID"], json!(CHUNK_SET));
    assert_eq!(output["chunkCount"], json!(CHUNKS));
    assert_eq!(output["batches"], json!(3));
    assert_eq!(output["dimensions"], json!(DIMENSIONS));
    assert_eq!(output["indexed"], json!(CHUNKS));
    assert_eq!(output["collection"], json!("test_chunks"));

    runtime.shutdown(5_000).await;
    store.cleanup_schema().await.expect("清理测试 schema");
}
