//! P9e 验收门禁：agent 长任务中途被硬杀后自动续跑，且**已完成的轮次不重跑**。
//!
//! 需要独立测试库（库名必须含 `test`）：
//!
//! ```text
//! TEST_DATABASE_URL=******127.0.0.1:5432/cogito_service_test \
//!   cargo test --test agent_fault_injection -- --test-threads=1
//! ```
//!
//! 未设置 `TEST_DATABASE_URL` 时整体跳过。
//!
//! 与 `agent_scope.rs` 的差别：那边在**进程内**跑 durable，验的是「链路与台账」；这里跑的是
//! **真的子进程**（`orchestrator` 二进制），然后 `kill()` 硬杀 —— 不做优雅停机，等价于断电 /
//! 被 OOM 干掉。崩溃恢复的全部依据只有 Postgres 里的编排历史，所以只有真杀进程才验得到。
//!
//! 时序（桩的回包延迟就是测试的观察窗）：
//! 1. 子进程跑完第 1 轮（模型要了 `knowledge_search`）→ 进度到 `step:2/4`；
//! 2. 第 2 轮的请求到达桩后被**挂起**（下游一直不回），此刻硬杀子进程；
//! 3. 实例仍在跑（崩溃不该让实例进终态），历史里已经有第 1 轮的结果；
//! 4. 重起子进程：等租约过期（`worker_lock_timeout_ms`）后，框架把在飞的那一轮**重新投递**；
//! 5. 断言：第 1 轮只调了一次；第 2 轮调了两次，两次带**同一个幂等键**与**同一份请求体**；
//!    第 3 轮拿到终答，结论只往长期记忆写一次，实例最终完成、输出完整。

mod support;

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use durable::{InstanceStatus, Store};
use serde_json::{Value, json};
use cogito::clients::compute::INTERNAL_SCHEMA_VERSION;
use cogito::orchestrations;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

use support::{
    MEMORY_ID, Script, StubCompute, settings, test_database_url, test_schema,
    wait_for_custom_status,
};

/// 每个用例都要建/删 schema，且共用同一个测试库，因此必须串行。
static DB_LOCK: LazyLock<AsyncMutex<()>> = LazyLock::new(|| AsyncMutex::new(()));

const TENANT: &str = "22222222-2222-2222-2222-222222222222";
const TASK: &str = "task-agent-fault-1";
const INSTANCE: &str = "agent-fault-1";
const OBJECTIVE: &str = "把本租户的退款政策总结成一段话";
const ANSWER: &str = "退款政策：七天内可无理由退，超期只在质量问题时受理。";
const CHAT_MODEL: &str = "agent-test-model";
const EMBED_MODEL: &str = "test-embedding-model";
/// 4 轮预算，实际只用 3 轮：第 3 轮就给结论，所以「剩余轮次」还有富余——
/// 这条路径验的是「中途崩溃续跑」，不是「预算耗尽」。
const MAX_STEPS: i32 = 4;
const TOOLS: [&str; 2] = ["knowledge_search", "asset_read"];
/// 崩溃那一刻的进度标签（第 2 轮刚开跑，工具还没被收回）。
const KILLED_PROGRESS: &str = "step:2/4 tools:2";
/// 子进程的租约时长（毫秒）：崩溃恢复最慢就是这么久，调小让门禁跑得快。
const LOCK_TIMEOUT_MS: u64 = 3_000;

#[tokio::test]
async fn killed_orchestrator_resumes_in_flight_agent_step_without_replaying_finished_ones() {
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

    let stub = StubCompute::start(
        // 第 3 条与第 2 条**故意一模一样**：桩按「第几次到达」出牌，而重投递来的那一趟
        // 就是同一步的第二次到达 —— 真实 compute 也只有在拿到同一份请求时才回得出同一份结果。
        Script::agent(vec![
            step_with_tool("call-1", TOOLS[0]),
            step_with_tool("call-2", TOOLS[1]),
            step_with_tool("call-2", TOOLS[1]),
            final_step(),
        ])
        // 第 2 轮永远不回包：进程就死在这一步上。
        .hang("/agents/steps", 2),
    )
    .await;

    let dir = work_dir();
    write_config(&dir, &uri, &schema, &stub.base_url());

    let first = start_orchestrator(&dir);
    client
        .start(
            INSTANCE,
            orchestrations::agent::AGENT_RUN,
            &json!({
                "taskID": TASK,
                "tenantID": TENANT,
                "objective": OBJECTIVE,
                "model": CHAT_MODEL,
                "embedModel": EMBED_MODEL,
                "maxSteps": MAX_STEPS,
                "allowedTools": TOOLS,
            }),
        )
        .await
        .expect("起实例");

    // 走到「第 2 轮正在飞」：第 1 轮的结果已经进历史，进度应当是 step:2/4。
    stub.wait_for("/agents/steps", 2, Duration::from_secs(60))
        .await;
    wait_for_custom_status(&client, INSTANCE, KILLED_PROGRESS).await;

    // 硬杀：没有停机窗口，也没有机会把在飞的活动标记成失败。
    first.kill().await;

    let status = client.status(INSTANCE).await.expect("查状态");
    assert!(!status.is_terminal(), "崩溃不该让实例进终态：{status:?}");
    assert_eq!(
        status,
        InstanceStatus::Running {
            custom_status: Some(KILLED_PROGRESS.to_owned())
        },
        "崩溃后进度应当还停在第 1 轮之后"
    );

    // 重起：租约过期后，框架会把在飞的那一轮重新投出去。
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
    assert_eq!(output["taskID"], json!(TASK));
    assert_eq!(output["steps"], json!(3), "第 3 轮就该收尾，不该多跑");
    assert_eq!(output["finished"], json!(true));
    assert_eq!(output["answer"], json!(ANSWER));
    assert_eq!(output["toolCalls"], json!(2));
    assert_eq!(output["memoryID"], json!(MEMORY_ID));

    // 已完成的轮次不重跑：第 1 轮只有一次调用，第 2 轮两次（被杀的那次 + 重投递的那次）。
    let steps = stub.matching("/agents/steps");
    assert_eq!(
        stub.idempotency_keys("/agents/steps"),
        vec![
            format!("{INSTANCE}:step:1"),
            format!("{INSTANCE}:step:2"),
            format!("{INSTANCE}:step:2"),
            format!("{INSTANCE}:step:3"),
        ],
        "在读的那一轮应当按同一个幂等键重跑一次；收到的请求：{:#?}",
        stub.requests()
    );

    // 重投递拿到的是**同一份请求体**：历史不多不少（第 1 轮的结果没有被塞第二遍），
    // 剩余轮次也一样 —— 下游据此（加上幂等键）就能回同一个结果。
    assert_eq!(
        steps[1].json(),
        steps[2].json(),
        "重投递的请求体应当与被杀的那次完全一致"
    );
    // 同一轮的两趟共享同一条链路：编排把上游 `traceparent` 原样传给每一步。
    assert_eq!(steps[1].traceparent(), steps[2].traceparent());

    // 结论只写一次：收尾活动没有被崩溃/重投递放大。
    assert_eq!(
        stub.idempotency_keys("/agents/memories"),
        vec![format!("{INSTANCE}:remember")],
        "长期记忆应当只写一次"
    );
    let remembered = stub.matching("/agents/memories")[0].json();
    assert_eq!(remembered["tenantID"], json!(TENANT));
    assert_eq!(remembered["taskID"], json!(TASK));
    assert_eq!(remembered["answer"], json!(ANSWER));
    assert_eq!(remembered["steps"], json!(3));
    assert_eq!(remembered["toolCalls"], json!(2));
    assert_eq!(remembered["embedModel"], json!(EMBED_MODEL));

    second.kill().await;
    let _ = std::fs::remove_dir_all(&dir);
    store.cleanup_schema().await.expect("清理测试 schema");
}

/// 造一条「要工具」的单步响应。
fn step_with_tool(call_id: &str, tool: &str) -> Value {
    json!({
        "schemaVersion": INTERNAL_SCHEMA_VERSION,
        "finished": false,
        "message": {
            "role": "assistant",
            "content": "先查一下资料",
            "toolCalls": [{
                "id": call_id,
                "name": tool,
                "arguments": "{}",
                "toolCallType": "function",
            }],
        },
        "toolResults": [{
            "toolCallID": call_id,
            "name": tool,
            "ok": true,
            "content": format!("{call_id} 的结果"),
        }],
        "usage": { "promptTokens": 120, "completionTokens": 30, "totalTokens": 150 },
    })
}

/// 造一条终答（没有工具调用 ⟺ `finished`）。
fn final_step() -> Value {
    json!({
        "schemaVersion": INTERNAL_SCHEMA_VERSION,
        "finished": true,
        "message": { "role": "assistant", "content": ANSWER },
        "toolResults": [],
        "usage": { "promptTokens": 90, "completionTokens": 20, "totalTokens": 110 },
    })
}

/// 子进程的工作目录：配置、日志都落在这里，测试结束后整目录删掉。
fn work_dir() -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("agent-orchestrator-{}", Uuid::new_v4().simple()));
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

compute:
  base_url: '{base_url}'
  token: test-internal-token
  timeout_ms: 10000
  use_system_proxy: false
  embed_batch_size: 16
  embed_model: {EMBED_MODEL}

agent:
  chat_model: {CHAT_MODEL}
  max_steps: {MAX_STEPS}
  allowed_tools:
    - {}

logging:
  filter: warn
"#,
        TOOLS[0]
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
