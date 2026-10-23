//! 可靠执行端到端契约（P4c）：编排 → 活动 → 重启续跑。
//!
//! 需要独立测试库（库名必须含 `test`，避免误伤开发库）：
//!
//! ```text
//! TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/cogito_service_test \
//!   cargo test --test orchestration -- --test-threads=1
//! ```
//!
//! 未设置 `TEST_DATABASE_URL` 时整体跳过。
//!
//! 每个用例独占一个 schema（跑完 `cleanup_schema()` 删掉）：编排表由 provider 自己建、
//! 自己迁移，不进 `migration` 世代，所以这些用例不需要重建业务库，也不会碰 `public`。
//!
//! 断言四条边界：
//! 1. 顺序 —— 编排把活动串起来跑，后一步拿到前一步的输出；
//! 2. 重启 —— 运行时不在了实例也不丢：重新起一个运行时，卡在等待事件的实例继续跑完；
//! 3. 重放 —— 重启后**已完成的活动不会重跑**（活动计数保持 1），这是编排历史的全部意义；
//! 4. 终态 —— 已完成的实例不会被重放（重启后状态与计数都不变）。

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use durable::{
    Activities, Client, DurableSettings, InstanceStatus, Orchestrations, Runtime, RuntimeTuning,
    Store,
};
use serde_json::json;
use tokio::sync::Mutex;
use uuid::Uuid;

/// 每个用例都要建/删 schema，且共用同一个测试库，因此必须串行。
static DB_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

const STEP_ONE: &str = "TestStepOne";
const STEP_TWO: &str = "TestStepTwo";
const PIPELINE: &str = "TestPipeline";
const GATED: &str = "TestGated";

/// 读取测试库地址；未配置或库名不合法时返回 `None`（调用方直接跳过）。
fn test_database_url() -> Option<String> {
    let uri = std::env::var("TEST_DATABASE_URL").ok()?;
    let uri = uri.trim().to_owned();
    if uri.is_empty() {
        return None;
    }
    let database = uri
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .split('?')
        .next()
        .unwrap_or_default();
    assert!(
        database.contains("test"),
        "TEST_DATABASE_URL 指向的库名必须含 `test`（当前：{database}）"
    );
    Some(uri)
}

/// 每个用例独占 schema，避免用例之间互相看到对方的实例。
fn test_schema() -> String {
    format!("durable_test_{}", Uuid::new_v4().simple())
}

fn settings(uri: &str, schema: &str) -> DurableSettings {
    DurableSettings::new(uri, schema, true)
}

/// 活动调用次数：用来证明「已完成的活动在重启后没有重跑」。
#[derive(Default)]
struct Calls {
    step_one: AtomicUsize,
    step_two: AtomicUsize,
}

impl Calls {
    fn one(&self) -> usize {
        self.step_one.load(Ordering::SeqCst)
    }

    fn two(&self) -> usize {
        self.step_two.load(Ordering::SeqCst)
    }
}

/// 两个活动 + 一条「串起来」的编排。
fn registrations(calls: &Arc<Calls>) -> (Activities, Orchestrations) {
    let one = Arc::clone(calls);
    let two = Arc::clone(calls);

    let activities = Activities::builder()
        .register(STEP_ONE, move |_ctx, input: String| {
            one.step_one.fetch_add(1, Ordering::SeqCst);
            async move { Ok(format!("{input}|one")) }
        })
        .register(STEP_TWO, move |_ctx, input: String| {
            two.step_two.fetch_add(1, Ordering::SeqCst);
            async move { Ok(format!("{input}|two")) }
        });

    let orchestrations =
        Orchestrations::builder().register(PIPELINE, |ctx, input: String| async move {
            let first = ctx.schedule_activity(STEP_ONE, input).await?;
            ctx.schedule_activity(STEP_TWO, first).await
        });

    (activities, orchestrations)
}

/// 「跑一半就停机」的编排：第二步之前先等一个外部事件（`release`）。
///
/// 事件之前的 `set_custom_status("waiting")` 是给测试用的栅栏：状态里能看到它就说明
/// 第一步的结果已经写进历史，此时停机不会把第一步变成「没跑过」。
fn gated_registrations(calls: &Arc<Calls>) -> (Activities, Orchestrations) {
    let one = Arc::clone(calls);
    let two = Arc::clone(calls);

    let activities = Activities::builder()
        .register(STEP_ONE, move |_ctx, input: String| {
            one.step_one.fetch_add(1, Ordering::SeqCst);
            async move { Ok(format!("{input}|one")) }
        })
        .register(STEP_TWO, move |_ctx, input: String| {
            two.step_two.fetch_add(1, Ordering::SeqCst);
            async move { Ok(format!("{input}|two")) }
        });

    let orchestrations =
        Orchestrations::builder().register(GATED, |ctx, input: String| async move {
            let first = ctx.schedule_activity(STEP_ONE, input).await?;
            ctx.set_custom_status("waiting");
            let release = ctx.schedule_wait("release").await;
            let second = ctx.schedule_activity(STEP_TWO, first).await?;
            Ok(format!("{second}|release:{release}"))
        });

    (activities, orchestrations)
}

/// 轮询状态直到编排写到自己要等的那个进度串（或超时）。
async fn wait_for_custom_status(client: &Client, instance: &str, want: &str) -> InstanceStatus {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let status = client.status(instance).await.expect("查询实例状态");
        if let InstanceStatus::Running { custom_status } = &status
            && custom_status.as_deref() == Some(want)
        {
            return status;
        }
        assert!(
            !status.is_terminal(),
            "实例在等到 {want} 之前已经终态：{status:?}"
        );
        assert!(
            Instant::now() < deadline,
            "等待自定义进度 {want} 超时，当前状态：{status:?}"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

#[tokio::test]
async fn pipeline_completes_and_completed_instance_is_not_rerun_after_restart() {
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
    let calls = Arc::new(Calls::default());
    let instance = "pipeline-1";

    let (activities, orchestrations) = registrations(&calls);
    let runtime = Runtime::start(&store, activities, orchestrations, RuntimeTuning::default())
        .await
        .expect("起运行时");

    client
        .start(instance, PIPELINE, &json!({ "doc": "readme" }))
        .await
        .expect("起实例");

    let status = client
        .wait(instance, Duration::from_secs(60))
        .await
        .expect("等结果");
    let output = status.output().expect("实例应当完成").to_string();
    assert!(
        output.contains(r#"{"doc":"readme"}"#) && output.contains("|one|two"),
        "输出不符合预期：{output}"
    );
    assert_eq!(calls.one(), 1, "第一步只应当跑一次");
    assert_eq!(calls.two(), 1, "第二步只应当跑一次");

    runtime.shutdown(5_000).await;

    // 重启运行时：已完成的实例必须原样留在终态，活动不再被重跑。
    let (activities, orchestrations) = registrations(&calls);
    let restarted = Runtime::start(&store, activities, orchestrations, RuntimeTuning::default())
        .await
        .expect("重起运行时");

    tokio::time::sleep(Duration::from_secs(2)).await;

    let after = client.status(instance).await.expect("重启后查状态");
    assert_eq!(after, status, "重启后已完成实例的状态不应当变化");
    assert_eq!(calls.one(), 1, "重启后第一步不应当重跑");
    assert_eq!(calls.two(), 1, "重启后第二步不应当重跑");

    restarted.shutdown(5_000).await;
    store.cleanup_schema().await.expect("清理测试 schema");
}

#[tokio::test]
async fn pending_instance_resumes_after_restart_without_replaying_completed_step() {
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
    let calls = Arc::new(Calls::default());
    let instance = "gated-1";

    let (activities, orchestrations) = gated_registrations(&calls);
    let runtime = Runtime::start(&store, activities, orchestrations, RuntimeTuning::default())
        .await
        .expect("起运行时");

    client
        .start(instance, GATED, &json!({ "doc": "readme" }))
        .await
        .expect("起实例");
    wait_for_custom_status(&client, instance, "waiting").await;
    assert_eq!(calls.one(), 1, "第一步应当已经跑过一次");

    // 停机：此刻实例卡在等事件上，历史里已经有第一步的结果。
    runtime.shutdown(5_000).await;
    assert_eq!(calls.one(), 1, "停机本身不应当重跑第一步");

    let (activities, orchestrations) = gated_registrations(&calls);
    let restarted = Runtime::start(&store, activities, orchestrations, RuntimeTuning::default())
        .await
        .expect("重起运行时");

    // 投递事件后等结果；长时间没完成就再投一次（事件按名字位置匹配，可能落在订阅生效之前）。
    let deadline = Instant::now() + Duration::from_secs(60);
    let status = loop {
        client
            .raise_event(instance, "release", &json!({ "ok": true }))
            .await
            .expect("投递事件");
        let status = client
            .wait(instance, Duration::from_secs(20))
            .await
            .expect("等结果");
        if status.is_terminal() {
            break status;
        }
        assert!(Instant::now() < deadline, "等待实例完成超时：{status:?}");
    };

    let output = status.output().expect("实例应当完成").to_string();
    assert!(
        output.contains(r#"{"doc":"readme"}"#) && output.contains("|one|two|release:"),
        "输出不符合预期：{output}"
    );
    assert!(
        output.contains(r#"{"ok":true}"#),
        "事件数据应当被编排读到：{output}"
    );
    assert_eq!(calls.one(), 1, "重启后第一步不应当重跑");
    assert_eq!(calls.two(), 1, "第二步只应当跑一次");

    restarted.shutdown(5_000).await;
    store.cleanup_schema().await.expect("清理测试 schema");
}
