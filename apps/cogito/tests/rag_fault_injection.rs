//! P4d 验收门禁：真实杀进程后，长任务自动续跑，且**已完成的步骤不重跑**。
//!
//! 需要独立测试库（库名必须含 `test`）：
//!
//! ```text
//! TEST_DATABASE_URL=******127.0.0.1:5432/cogito_service_test \
//!   cargo test --test rag_fault_injection -- --test-threads=1
//! ```
//!
//! 未设置 `TEST_DATABASE_URL` 时整体跳过。
//!
//! 与 `rag_index.rs` 的差别：这里跑的是**真的子进程**（`orchestrator` 二进制），然后用
//! `kill()` 硬杀它 —— 不做优雅停机，等价于断电/被 OOM 干掉。测试进程只留两件事：
//! 起实例、看状态。
//!
//! 时序（桩的回包延迟就是测试的观察窗）：
//! 1. 子进程跑完分块、跑完第一批嵌入 → 进度到 `embedded:16`；
//! 2. 第二批嵌入的请求到达桩后被**挂起**（下游一直不回），此刻硬杀子进程；
//! 3. 实例仍在跑（崩溃不该让实例进终态），历史里已经有第一批的结果；
//! 4. 重起子进程：等租约过期（`worker_lock_timeout_ms`）后，框架把在飞的那一步**重新投递**；
//! 5. 断言：分块/落索引各只调了一次；第二批嵌入了两次（被杀的那次 + 重跑的那次），
//!    两次带的是**同一个幂等键**；实例最终完成，输出完整。

mod support;

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use durable::{InstanceStatus, Store};
use serde_json::{Value, json};
use cogito::orchestrations;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

use support::{
    Script, StubAiWorker, settings, test_database_url, test_schema, wait_for_custom_status,
};

/// 每个用例都要建/删 schema，且共用同一个测试库，因此必须串行。
static DB_LOCK: LazyLock<AsyncMutex<()>> = LazyLock::new(|| AsyncMutex::new(()));

const TENANT: &str = "22222222-2222-2222-2222-222222222222";
const ASSET: &str = "asset-fault";
const INSTANCE: &str = "rag-fault-1";
const CHUNK_SET: &str = "chunk-set-fault";
const BATCH: usize = 16;
const CHUNKS: i32 = 48;
const DIMENSIONS: i32 = 1024;
const EMBED_MODEL: &str = "test-embedding-model";
/// 子进程的租约时长（毫秒）：崩溃恢复最慢就是这么久，调小让门禁跑得快。
const LOCK_TIMEOUT_MS: u64 = 3_000;

#[tokio::test]
async fn killed_orchestrator_resumes_in_flight_step_without_replaying_finished_ones() {
    let Some(uri) = test_database_url() else {
        eprintln!("跳过：未设置 TEST_DATABASE_URL");
        return;
    };
    let _guard = DB_LOCK.lock().await;

    let schema = test_schema();
    // 先连一次库把编排表建好：子进程跟着跑迁移，但测试进程必须是第一个。
    let store = Store::connect(&settings(&uri, &schema))
        .await
        .expect("连接编排库");
    let client = store.client();

    let stub = StubAiWorker::start(
        Script::new(CHUNKS, DIMENSIONS)
            .chunk_set_id(CHUNK_SET)
            // 第二批嵌入永远不回包：进程就死在这一步上。
            .hang("/embeddings", 2),
    )
    .await;

    let dir = work_dir();
    write_config(&dir, &uri, &schema, &stub.base_url());

    let first = start_orchestrator(&dir);
    client
        .start(
            INSTANCE,
            orchestrations::rag::INDEX_ASSET,
            &json!({
                "tenantID": TENANT,
                "assetID": ASSET,
                "mime": "application/pdf",
            }),
        )
        .await
        .expect("起实例");

    // 走到「第二批正在飞」：分块与第一批的结果都已经进历史，进度应当是 embedded:16。
    stub.wait_for("/chunks", 1, Duration::from_secs(60)).await;
    stub.wait_for("/embeddings", 2, Duration::from_secs(60))
        .await;
    wait_for_custom_status(&client, INSTANCE, "embedded:16").await;

    // 硬杀：没有停机窗口，也没有机会把在飞的活动标记成失败。
    first.kill().await;

    let status = client.status(INSTANCE).await.expect("查状态");
    assert!(!status.is_terminal(), "崩溃不该让实例进终态：{status:?}");
    assert_eq!(
        status,
        InstanceStatus::Running {
            custom_status: Some("embedded:16".to_owned())
        },
        "崩溃后进度应当还停在第一批之后"
    );

    // 重起：租约过期后，框架会把在飞的那一步重新投出去。
    let second = start_orchestrator(&dir);
    let status = client
        .wait(INSTANCE, Duration::from_secs(120))
        .await
        .expect("等结果");
    assert!(
        status.is_terminal(),
        "重起后实例没跑完：{status:?}\n--- orchestrator 日志 ---\n{}",
        second.logs()
    );

    let output: Value =
        serde_json::from_str(status.output().expect("完成态必须有输出")).expect("输出是 JSON");
    assert_eq!(output["assetID"], json!(ASSET));
    assert_eq!(output["chunkSetID"], json!(CHUNK_SET));
    assert_eq!(output["chunkCount"], json!(CHUNKS));
    assert_eq!(output["batches"], json!(3));
    assert_eq!(output["dimensions"], json!(DIMENSIONS));
    assert_eq!(output["indexed"], json!(CHUNKS));

    // 已完成的步骤不重跑：分块与落索引各只有一次调用。
    assert_eq!(stub.count("/chunks"), 1, "分块不应当重跑");
    assert_eq!(stub.count("/index"), 1, "落索引不应当重跑");

    // 在飞的那一步被重新投递：两次请求带同一个幂等键（下游据此认得出这是同一步）。
    assert_eq!(
        stub.idempotency_keys("/embeddings"),
        vec![
            format!("{INSTANCE}:embed:0-16"),
            format!("{INSTANCE}:embed:16-32"),
            format!("{INSTANCE}:embed:16-32"),
            format!("{INSTANCE}:embed:32-48"),
        ],
        "被杀的那一批应当按同一个幂等键重跑一次；收到的请求：{:#?}",
        stub.requests()
    );

    second.kill().await;
    let _ = std::fs::remove_dir_all(&dir);
    store.cleanup_schema().await.expect("清理测试 schema");
}

/// 子进程的工作目录：配置、日志都落在这里，测试结束后整目录删掉。
fn work_dir() -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("orchestrator-{}", Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).expect("建临时目录");

    dir
}

/// 给子进程写一份自洽的配置：只写校验认的字段，其余走默认值。
///
/// 目录注入走 `CARGO_MANIFEST_DIR`（见 `configures/src/loader.rs` 的 `config_dir()`）：
/// 子进程的 exe 旁边没有 `config.yaml`，所以它会用我们给的这一份。
fn write_config(dir: &Path, uri: &str, schema: &str, base_url: &str) {
    let config = format!(
        r#"app:
  env: development

security:
  jwt_secret: test-jwt-secret-0123456789abcdefghijklmnop
  encryption: argon2

durable:
  database_url: '{uri}'
  schema: {schema}
  auto_migrate: true
  orchestration_concurrency: 1
  worker_concurrency: 1
  shutdown_grace_ms: 2000
  worker_lock_timeout_ms: {LOCK_TIMEOUT_MS}
  worker_lock_renewal_buffer_ms: 500

ai_worker:
  base_url: '{base_url}'
  token: test-internal-token
  timeout_ms: 10000
  embed_batch_size: {BATCH}
  embed_model: {EMBED_MODEL}

logging:
  filter: warn
"#
    );

    std::fs::write(dir.join("config.yaml"), config).expect("写子进程配置");
}

/// 起一个 orchestrator 子进程；stdout/stderr 收进内存，断言失败时能打出来。
fn start_orchestrator(dir: &Path) -> ChildHandle {
    let mut child = Command::new(env!("CARGO_BIN_EXE_orchestrator"))
        .env("CARGO_MANIFEST_DIR", dir)
        .current_dir(dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // 用例 panic 时别留孤儿进程。
        .kill_on_drop(true)
        .spawn()
        .expect("起 orchestrator 子进程");

    let logs = Arc::new(Mutex::new(String::new()));
    if let Some(stdout) = child.stdout.take() {
        drain(stdout, Arc::clone(&logs));
    }
    if let Some(stderr) = child.stderr.take() {
        drain(stderr, Arc::clone(&logs));
    }

    ChildHandle { child, logs }
}

fn drain<R>(stream: R, logs: Arc<Mutex<String>>)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(stream).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let mut logs = logs.lock().expect("日志锁");
            logs.push_str(&line);
            logs.push('\n');
        }
    });
}

struct ChildHandle {
    child: Child,
    logs: Arc<Mutex<String>>,
}

impl ChildHandle {
    /// 硬杀 + 回收：不给停机窗口，等价于进程崩溃。
    async fn kill(mut self) {
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
    }

    fn logs(&self) -> String {
        self.logs.lock().expect("日志锁").clone()
    }
}
