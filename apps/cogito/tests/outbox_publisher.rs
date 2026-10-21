//! 事件发布端到端契约（P4b）：outbox → 发布器 → 下游。
//!
//! 需要独立测试库（库名必须含 `test`，避免误伤开发库）：
//!
//! ```text
//! TEST_DATABASE_URL=******127.0.0.1:5432/cogito_service_test cargo test --test outbox_publisher
//! ```
//!
//! 未设置 `TEST_DATABASE_URL` 时整体跳过。
//!
//! 断言五条边界：
//! 1. 事务边界 —— 事务内的追加才算事件：回滚了就没有，没提交就看不见；
//! 2. 特权边界 —— 发布者以 `cogito_platform` 跨租户读 outbox（租户作用域看不到别的租户）；
//! 3. 失败边界 —— 失败只累加 `attempts`/`lastError`，并阻塞**同一聚合**的后续事件；
//! 4. 至少一次 —— 投递成功但置位前「崩溃」时，重启后重投同一条事件（消费者侧去重）；
//! 5. 线格式 —— HTTP 终点收到 camelCase 信封、`traceparent` 与 `Authorization` 头；
//! 6. 循环边界 —— 首轮失败即退出（编排器重试），停机信号在轮与轮之间生效。

use std::sync::{Arc, LazyLock};
use std::time::Duration;

use audit::{
    AuditError, DispatchError, Dispatcher, Envelope, Event, EventType, PlatformChannel, Publisher,
    PublisherOptions, append, consume_once,
};
use identity::TenantId;
use migration::MigratorTrait;
use sea_orm::{
    ConnectOptions, ConnectionTrait, Database, DatabaseBackend, DatabaseConnection, QueryResult,
    Statement,
};
use cogito::configures::configure::Configure;
use cogito::databases::database::Storage;
use cogito::databases::scope::PLATFORM_ROLE;
use cogito::worker::dispatcher::WorkerDispatcher;
use cogito::worker::runner::{LoopOptions, run};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, oneshot, watch};
use tokio::time::timeout;
use uuid::Uuid;

/// 应用角色：outbox 的 RLS 对它生效；平台角色只靠成员关系借用。
const APP_ROLE: &str = "cogito_app_test";

/// 故意**不**授予平台角色的身份：用来验证「拿不到平台事务 → 首轮失败即退出」。
const NO_PLATFORM_ROLE: &str = "cogito_noplatform_test";

/// 每个用例都要 `fresh` 整个库，因此必须串行。
static DB_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

struct Fixture {
    /// 超级用户连接：种数据、按「不受作用域限制」的口径核对真实行。
    admin: DatabaseConnection,
    /// 应用角色的连接（服务层真实身份），也就是发布器用的通道。
    storage: Storage,
    tenant_a: Uuid,
    tenant_b: Uuid,
}

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
        "TEST_DATABASE_URL 指向的库名必须含 `test`（当前：{database}）：用例会重建库"
    );
    Some(uri)
}

/// 把测试库 URI 的账号换成指定角色，模拟真实部署下的连接身份。
fn role_uri(uri: &str, role: &str) -> String {
    let (scheme, rest) = uri
        .split_once("://")
        .expect("TEST_DATABASE_URL 需要带 scheme");
    let (_, host) = rest
        .rsplit_once('@')
        .expect("TEST_DATABASE_URL 需要带账号信息");

    format!("{scheme}://{role}:{role}@{host}")
}

fn database_of(uri: &str) -> String {
    let tail = uri.rsplit('/').next().unwrap_or_default();

    tail.split('?').next().unwrap_or_default().to_owned()
}

async fn connect(uri: &str, max_connections: u32) -> DatabaseConnection {
    let mut options = ConnectOptions::new(uri.to_owned());
    options
        .max_connections(max_connections)
        .min_connections(1)
        .connect_timeout(Duration::from_secs(10))
        .acquire_timeout(Duration::from_secs(30))
        .sqlx_logging(false);
    Database::connect(options).await.expect("连接测试库失败")
}

async fn exec<C: ConnectionTrait>(conn: &C, sql: &str) {
    if let Err(err) = conn.execute_unprepared(sql).await {
        panic!("SQL 执行失败：{sql}\n{err}");
    }
}

async fn query_one<C: ConnectionTrait>(conn: &C, sql: &str) -> QueryResult {
    conn.query_one_raw(Statement::from_string(
        DatabaseBackend::Postgres,
        sql.to_owned(),
    ))
    .await
    .unwrap_or_else(|err| panic!("查询失败：{sql}\n{err}"))
    .unwrap_or_else(|| panic!("查询没有返回结果：{sql}"))
}

async fn count<C: ConnectionTrait>(conn: &C, sql: &str) -> i64 {
    query_one(conn, sql)
        .await
        .try_get_by_index::<i64>(0)
        .expect("结果不是 bigint")
}

async fn optional_text<C: ConnectionTrait>(conn: &C, sql: &str) -> Option<String> {
    query_one(conn, sql)
        .await
        .try_get_by_index::<Option<String>>(0)
        .expect("结果不是 text")
}

/// 重建库、建应用角色、授权；锁未持有时不得调用。
async fn setup() -> Option<Fixture> {
    let uri = test_database_url()?;
    let admin = connect(&uri, 2).await;

    migration::Migrator::fresh(&admin)
        .await
        .expect("重建测试库失败");

    let exists = count(
        &admin,
        &format!("SELECT count(*) FROM pg_roles WHERE rolname = '{APP_ROLE}'"),
    )
    .await;
    if exists == 0 {
        exec(
            &admin,
            &format!(
                "CREATE ROLE {APP_ROLE} LOGIN PASSWORD '{APP_ROLE}' \
                 NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE"
            ),
        )
        .await;
    }
    // 授权按对象生效，每次重建后都会丢，所以放在 fresh 之后
    for sql in [
        format!("GRANT USAGE ON SCHEMA public TO {APP_ROLE}"),
        format!(
            "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {APP_ROLE}"
        ),
        format!("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {APP_ROLE}"),
    ] {
        exec(&admin, &sql).await;
    }
    // 迁移里由超级用户建好 `cogito_platform`；这里把成员关系拨到测试角色上
    exec(&admin, &format!("GRANT {PLATFORM_ROLE} TO {APP_ROLE}")).await;

    let fixture = Fixture {
        admin,
        storage: Storage::from_parts(
            connect(&role_uri(&uri, APP_ROLE), 2).await,
            database_of(&uri),
        ),
        tenant_a: Uuid::new_v4(),
        tenant_b: Uuid::new_v4(),
    };
    for (tag, tenant) in [("a", fixture.tenant_a), ("b", fixture.tenant_b)] {
        exec(
            &fixture.admin,
            &format!(
                r#"INSERT INTO tenant (id, name, slug, "createdAt", "updatedAt")
                   VALUES ('{tenant}', 'Outbox {tag}', 'outbox-{tag}', now(), now())"#
            ),
        )
        .await;
    }
    Some(fixture)
}

/// 造一条订阅事件（outbox 只要求列齐全，不校验业务语义）。
fn event(aggregate_id: Uuid, tenant: Option<Uuid>, kind: &str) -> Event {
    let event = Event::new(
        "subscription",
        aggregate_id,
        EventType::parse(kind).expect("事件类型字面量"),
        serde_json::json!({ "plan": "PRO" }),
    );
    match tenant {
        Some(tenant) => event.with_tenant(TenantId::from_uuid(tenant)),
        None => event,
    }
}

/// 在租户作用域事务里追加事件并提交——正式链路里事件就是这么进来的。
async fn append_committed(fixture: &Fixture, event: &Event) {
    let tenant = event
        .tenant_id
        .expect("用例里的事件都属于某个租户")
        .as_uuid();
    let tx = fixture
        .storage
        .tenant_tx(TenantId::from_uuid(tenant))
        .await
        .expect("开启租户事务失败");
    append(&tx, event).await.expect("追加事件失败");
    tx.commit().await.expect("提交失败");
}

/// 记录调用并按脚本返回结果的派发终点。
#[derive(Clone, Default)]
struct Scripted {
    /// 每次调用返回的结果（按顺序取；用完即 `Ok`）。
    script: Arc<Mutex<Vec<Result<(), DispatchError>>>>,
    /// 收到的信封（按投递顺序）。
    seen: Arc<Mutex<Vec<Envelope>>>,
}

impl Scripted {
    fn new(script: Vec<Result<(), DispatchError>>) -> Self {
        Self {
            script: Arc::new(Mutex::new(script)),
            seen: Arc::new(Mutex::new(Vec::new())),
        }
    }

    async fn delivered(&self) -> Vec<Envelope> {
        self.seen.lock().await.clone()
    }
}

impl Dispatcher for Scripted {
    async fn dispatch(&self, envelope: &Envelope) -> Result<(), DispatchError> {
        self.seen.lock().await.push(envelope.clone());
        let next = {
            let mut script = self.script.lock().await;
            if script.is_empty() {
                None
            } else {
                Some(script.remove(0))
            }
        };
        next.unwrap_or(Ok(()))
    }
}

/// 用给定的终点发布一轮，返回结果与终点记录。
async fn publish_round(
    fixture: &Fixture,
    dispatcher: Scripted,
) -> (Result<audit::PublishOutcome, AuditError>, Vec<Envelope>) {
    let publisher = Publisher::new(
        fixture.storage.clone(),
        dispatcher.clone(),
        PublisherOptions {
            batch_size: 64,
            backoff_base: Duration::from_millis(1),
            backoff_max: Duration::from_millis(5),
        },
    );
    let outcome = publisher.round().await;
    (outcome, dispatcher.delivered().await)
}

/// 覆盖 1 + 2：事务内的追加才成为事件，且跨租户都要能读到。
#[tokio::test]
async fn committed_events_are_published_across_tenants() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        eprintln!("跳过：未设置 TEST_DATABASE_URL");
        return;
    };

    // 两个租户各一条：发布者必须同时看到（租户作用域做不到这一点）
    let a = event(
        Uuid::new_v4(),
        Some(fixture.tenant_a),
        "subscription.created",
    );
    let b = event(
        Uuid::new_v4(),
        Some(fixture.tenant_b),
        "subscription.created",
    );
    append_committed(&fixture, &a).await;
    append_committed(&fixture, &b).await;

    // 租户 A 的作用域只看得见自己那条——这就是需要平台通道的理由
    let scoped = fixture
        .storage
        .tenant_tx(TenantId::from_uuid(fixture.tenant_a))
        .await
        .expect("开启租户事务失败");
    assert_eq!(
        count(&scoped, r#"SELECT count(*) FROM outbox"#).await,
        1,
        "租户作用域必须看不到别的租户事件"
    );
    scoped.rollback().await.expect("回滚失败");

    let (outcome, delivered) = publish_round(&fixture, Scripted::new(vec![])).await;
    let outcome = outcome.expect("发布失败");
    assert_eq!(
        (outcome.scanned, outcome.published, outcome.skipped),
        (2, 2, 0)
    );
    assert_eq!(delivered.len(), 2, "两条事件各投递一次");
    assert_eq!(delivered[0].id, a.id, "按追加顺序投递");

    // 置位与失败痕迹
    assert_eq!(
        count(
            &fixture.admin,
            r#"SELECT count(*) FROM outbox WHERE "publishedAt" IS NULL"#
        )
        .await,
        0,
        "投递成功后必须置位"
    );
    assert_eq!(
        count(
            &fixture.admin,
            r#"SELECT count(*) FROM outbox WHERE attempts <> 0"#
        )
        .await,
        0,
        "成功投递不应累加尝试次数"
    );
}

/// 覆盖 1：回滚掉的追加不产生事件；未提交的追加对发布者不可见。
#[tokio::test]
async fn only_committed_appends_become_events() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        eprintln!("跳过：未设置 TEST_DATABASE_URL");
        return;
    };

    let rolled_back = event(
        Uuid::new_v4(),
        Some(fixture.tenant_a),
        "subscription.created",
    );
    let tx = fixture
        .storage
        .tenant_tx(TenantId::from_uuid(fixture.tenant_a))
        .await
        .expect("开启租户事务失败");
    append(&tx, &rolled_back).await.expect("追加事件失败");
    tx.rollback().await.expect("回滚失败");

    // 未提交：同一个连接池外什么都不该看到
    let pending = event(
        Uuid::new_v4(),
        Some(fixture.tenant_a),
        "subscription.created",
    );
    let open = fixture
        .storage
        .tenant_tx(TenantId::from_uuid(fixture.tenant_a))
        .await
        .expect("开启租户事务失败");
    append(&open, &pending).await.expect("追加事件失败");

    let (outcome, delivered) = publish_round(&fixture, Scripted::new(vec![])).await;
    let outcome = outcome.expect("发布失败");
    assert_eq!(outcome.scanned, 0, "未提交的事件对发布者不可见");
    assert!(delivered.is_empty());

    open.commit().await.expect("提交失败");
    let (outcome, delivered) = publish_round(&fixture, Scripted::new(vec![])).await;
    assert_eq!(outcome.expect("发布失败").published, 1);
    assert_eq!(delivered[0].id, pending.id, "回滚掉的那条从未出现");
}

/// 覆盖 3：失败只记痕迹，并阻塞**同一聚合**的后续事件，其他聚合照常前进。
#[tokio::test]
async fn failure_blocks_the_aggregate_but_not_the_rest() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        eprintln!("跳过：未设置 TEST_DATABASE_URL");
        return;
    };

    let aggregate = Uuid::new_v4();
    let first = event(aggregate, Some(fixture.tenant_a), "subscription.created");
    let second = event(aggregate, Some(fixture.tenant_a), "subscription.renewed");
    let other = event(
        Uuid::new_v4(),
        Some(fixture.tenant_a),
        "subscription.created",
    );
    for item in [&first, &second, &other] {
        append_committed(&fixture, item).await;
    }

    // 同一个发布器跑两轮：退避状态是进程内的，换个实例就等于重启
    let dispatcher = Scripted::new(vec![Err(DispatchError::Status {
        status: 500,
        body: "boom".into(),
    })]);
    let publisher = Publisher::new(
        fixture.storage.clone(),
        dispatcher.clone(),
        PublisherOptions {
            batch_size: 64,
            backoff_base: Duration::from_secs(60),
            backoff_max: Duration::from_secs(120),
        },
    );

    let outcome = publisher.round().await.expect("发布失败");
    assert_eq!(
        (outcome.scanned, outcome.published, outcome.skipped),
        (3, 1, 1)
    );
    assert_eq!(outcome.failures.len(), 1);
    assert_eq!(outcome.failures[0].event_id, first.id);
    let delivered = dispatcher.delivered().await;
    assert_eq!(
        delivered.len(),
        2,
        "同一聚合的第二条不投递（顺序优先于吞吐）"
    );

    let failed = &fixture.admin;
    assert_eq!(
        optional_text(
            failed,
            &format!(
                r#"SELECT "lastError" FROM outbox WHERE id = '{0}'"#,
                first.id
            )
        )
        .await
        .as_deref()
        .map(|error| error.contains("500")),
        Some(true),
        "失败原因要落到 lastError"
    );
    assert_eq!(
        count(
            failed,
            &format!(
                r#"SELECT attempts::bigint FROM outbox WHERE id = '{0}'"#,
                first.id
            )
        )
        .await,
        1,
        "失败累加一次尝试"
    );
    assert_eq!(
        count(
            failed,
            &format!(
                r#"SELECT count(*) FROM outbox WHERE id = '{0}' AND "publishedAt" IS NULL AND attempts = 0"#,
                second.id
            )
        )
        .await,
        1,
        "被阻塞的事件不算失败：它只是还没轮到"
    );
    assert_eq!(
        count(
            failed,
            &format!(
                r#"SELECT count(*) FROM outbox WHERE id = '{0}' AND "publishedAt" IS NOT NULL"#,
                other.id
            )
        )
        .await,
        1,
        "其他聚合不受影响"
    );

    // 同一进程内退避立刻生效：这一轮连试都不试（其余聚合本轮没有待发布事件）
    let outcome = publisher.round().await.expect("发布失败");
    assert_eq!(
        (outcome.scanned, outcome.published, outcome.skipped),
        (2, 0, 2)
    );
    assert_eq!(
        dispatcher.delivered().await.len(),
        2,
        "退避窗口内不得重复投递"
    );
}

/// 覆盖 4：投递成功但置位前崩溃 → 重启后重投同一条（至少一次）。
#[tokio::test]
async fn redelivery_after_crash_is_deduplicated_by_the_consumer() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        eprintln!("跳过：未设置 TEST_DATABASE_URL");
        return;
    };

    let item = event(
        Uuid::new_v4(),
        Some(fixture.tenant_a),
        "subscription.created",
    );
    append_committed(&fixture, &item).await;

    let (outcome, delivered) = publish_round(&fixture, Scripted::new(vec![])).await;
    assert_eq!(outcome.expect("发布失败").published, 1);

    // 模拟「已送到下游、但置位前进程崩了」：把置位抹掉，下一轮会重投同一条
    exec(
        &fixture.admin,
        &format!(
            r#"UPDATE outbox SET "publishedAt" = NULL WHERE id = '{0}'"#,
            item.id
        ),
    )
    .await;
    let (outcome, delivered_again) = publish_round(&fixture, Scripted::new(vec![])).await;
    assert_eq!(outcome.expect("发布失败").published, 1);
    assert_eq!(delivered[0].id, delivered_again[0].id, "重投的是同一条事件");

    // 消费者侧去重：同一个消费者第二次必须跳过
    let consumer = "ai-worker";
    let tx = fixture
        .storage
        .tenant_tx(TenantId::from_uuid(fixture.tenant_a))
        .await
        .expect("开启租户事务失败");
    assert!(
        consume_once(&tx, consumer, item.id)
            .await
            .expect("登记失败")
    );
    assert!(
        !consume_once(&tx, consumer, item.id)
            .await
            .expect("登记失败"),
        "同一消费者重复收到必须跳过"
    );
    tx.rollback().await.expect("回滚失败");
}

/// 由 `Channel` 记录的、发布器实际开启的事务：用来验证通道语义。
#[derive(Clone, Default)]
struct CountingChannel {
    storage: Option<Storage>,
    opened: Arc<Mutex<u32>>,
}

impl PlatformChannel for CountingChannel {
    async fn begin(&self) -> Result<sea_orm::DatabaseTransaction, sea_orm::DbErr> {
        *self.opened.lock().await += 1;
        self.storage
            .as_ref()
            .expect("通道已装配")
            .platform_tx()
            .await
    }
}

/// 覆盖 2 的正面：`Storage` 的平台通道就是发布器用的通道，一轮只开一次事务。
#[tokio::test]
async fn storage_is_the_publisher_platform_channel() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        eprintln!("跳过：未设置 TEST_DATABASE_URL");
        return;
    };

    append_committed(
        &fixture,
        &event(
            Uuid::new_v4(),
            Some(fixture.tenant_b),
            "subscription.created",
        ),
    )
    .await;

    // 应用角色直连平台事务：能读到另一个租户的行（前缀与 Storage 的通道实现一致）
    let tx = fixture.storage.platform_tx().await.expect("平台通道不可用");
    assert_eq!(count(&tx, "SELECT count(*) FROM outbox").await, 1);
    tx.rollback().await.expect("回滚失败");

    let channel = CountingChannel {
        storage: Some(fixture.storage.clone()),
        opened: Arc::new(Mutex::new(0)),
    };
    let publisher = Publisher::new(
        channel.clone(),
        Scripted::new(vec![]),
        PublisherOptions::default(),
    );
    let _ = publisher.round().await.expect("发布失败");
    assert_eq!(*channel.opened.lock().await, 1, "一轮只开一个事务");

    // 租户作用域事务仍然写不进平台级事件（tenantID 为 NULL 无租户可挂）
    let tenant_tx = fixture
        .storage
        .tenant_tx(TenantId::from_uuid(fixture.tenant_a))
        .await
        .expect("开启租户事务失败");
    let platform_event = Event::new(
        "platform",
        Uuid::new_v4(),
        EventType::parse("platform.maintenance").expect("事件类型字面量"),
        serde_json::json!({}),
    );
    assert!(
        append(&tenant_tx, &platform_event).await.is_err(),
        "平台级事件必须走平台通道"
    );
    tenant_tx.rollback().await.expect("回滚失败");
}

/// 起一个只服务一次请求的桩下游，返回端点与捕获到的原始请求文本。
async fn stub_downstream(status: u16, body: &'static str) -> (String, oneshot::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("绑定桩端口失败");
    let address = listener.local_addr().expect("取本地地址失败");
    let (capture, captured) = oneshot::channel();

    tokio::spawn(async move {
        let Ok((mut socket, _)) = listener.accept().await else {
            return;
        };
        let request = read_request(&mut socket).await;
        let response = format!(
            "HTTP/1.1 {status} DOWNSTREAM\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = capture.send(request);
    });

    (format!("http://{address}/internal/events"), captured)
}

/// 读一条 HTTP 请求（先头后体，按 `content-length`）。
async fn read_request(socket: &mut tokio::net::TcpStream) -> String {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 2048];
    let head_end = loop {
        if let Some(index) = find_head_end(&buffer) {
            break index;
        }
        let read = socket.read(&mut chunk).await.unwrap_or(0);
        if read == 0 {
            return String::from_utf8_lossy(&buffer).into_owned();
        }
        buffer.extend_from_slice(&chunk[..read]);
    };

    let head = String::from_utf8_lossy(&buffer[..head_end]).to_ascii_lowercase();
    let length = content_length(&head);
    while buffer.len() - head_end - 4 < length {
        let read = socket.read(&mut chunk).await.unwrap_or(0);
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
    }

    String::from_utf8_lossy(&buffer).into_owned()
}

fn find_head_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn content_length(head: &str) -> usize {
    head.lines()
        .find_map(|line| line.strip_prefix("content-length:"))
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or(0)
}

/// 覆盖 5：HTTP 终点收到 camelCase 信封 + `traceparent` + `Authorization`。
#[tokio::test]
async fn http_endpoint_receives_envelope_with_trace_context() {
    let (endpoint, captured) = stub_downstream(202, "accepted").await;

    let mut configure = Configure::default();
    configure.events.endpoint = endpoint;
    configure.events.token = "s3cret".to_owned();
    let dispatcher = WorkerDispatcher::from_configure(&configure).expect("装配终点失败");

    let mut envelope = Envelope::from(&event(
        Uuid::new_v4(),
        Some(Uuid::new_v4()),
        "subscription.created",
    ));
    envelope.traceparent =
        Some("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01".to_owned());
    dispatcher.dispatch(&envelope).await.expect("投递失败");

    let request = captured.await.expect("桩下游没有收到请求");
    let head = request
        .split("\r\n\r\n")
        .next()
        .expect("请求必须有头")
        .to_ascii_lowercase();
    assert!(head.starts_with("post /internal/events"), "实际：{head}");
    assert!(
        head.contains("authorization: bearer s3cret"),
        "缺鉴权头：{head}"
    );
    assert!(
        head.contains("traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"),
        "缺 traceparent：{head}"
    );

    let body = request
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .expect("请求必须有体");
    let payload: serde_json::Value = serde_json::from_str(body).expect("信封必须是 JSON");
    for key in [
        "id",
        "aggregate",
        "aggregateID",
        "eventType",
        "schemaVersion",
        "payload",
        "tenantID",
        "traceparent",
        "createdAt",
    ] {
        assert!(payload.get(key).is_some(), "信封缺字段 {key}：{payload}");
    }
    assert_eq!(payload["id"], serde_json::json!(envelope.id));
    assert_eq!(payload["tenantID"], serde_json::json!(envelope.tenant_id));
}

/// 覆盖 5：非 2xx 视作失败，并把状态码与响应体交给发布器。
#[tokio::test]
async fn http_endpoint_status_and_body_become_a_dispatch_error() {
    let (endpoint, _captured) = stub_downstream(503, "downstream busy").await;

    let mut configure = Configure::default();
    configure.events.endpoint = endpoint;
    let dispatcher = WorkerDispatcher::from_configure(&configure).expect("装配终点失败");

    let error = dispatcher
        .dispatch(&Envelope::from(&event(
            Uuid::new_v4(),
            Some(Uuid::new_v4()),
            "subscription.created",
        )))
        .await
        .expect_err("503 必须算失败");
    match error {
        DispatchError::Status { status, body } => {
            assert_eq!(status, 503);
            assert!(body.contains("downstream busy"), "实际：{body}");
        }
        other => panic!("期望 Status，实际：{other:?}"),
    }
}

/// 未配置终点（本地/联调）时退化为只记日志，事件照样算已投递。
#[tokio::test]
async fn missing_endpoint_degrades_to_logging() {
    let configure = Configure::default();
    let dispatcher = WorkerDispatcher::from_configure(&configure).expect("装配终点失败");
    assert!(matches!(dispatcher, WorkerDispatcher::Logging));

    let delivered = dispatcher
        .dispatch(&Envelope::from(&event(
            Uuid::new_v4(),
            Some(Uuid::new_v4()),
            "subscription.created",
        )))
        .await;
    assert!(delivered.is_ok(), "只记日志不算失败");
}

/// 覆盖 6：停机信号只在轮与轮之间生效，收到后循环正常返回。
#[tokio::test]
async fn run_returns_as_soon_as_shutdown_is_requested() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        eprintln!("跳过：未设置 TEST_DATABASE_URL");
        return;
    };

    let (shutdown, receiver) = watch::channel(false);
    let worker = tokio::spawn(run(
        fixture.storage.clone(),
        WorkerDispatcher::Logging,
        loop_options(Duration::from_millis(10)),
        receiver,
    ));

    // 等第一轮真的跑起来再发信号，走的是「轮与轮之间响应停机」那条路
    tokio::time::sleep(Duration::from_millis(50)).await;
    shutdown.send(true).expect("发送停机信号");

    let result = timeout(Duration::from_secs(10), worker)
        .await
        .expect("worker 收到停机信号后必须退出")
        .expect("worker 任务 panic");
    assert!(result.is_ok(), "停机是正常退出：{result:?}");
}

/// 覆盖 6：首轮失败 = 起不来。拿不到平台事务（角色没授权/库连不上）等下去也不会好，
/// 必须带着错误退出，交给编排器重试；之后的失败才是「记日志继续跑」。
#[tokio::test]
async fn first_round_failure_stops_the_worker() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else {
        eprintln!("跳过：未设置 TEST_DATABASE_URL");
        return;
    };

    let uri = test_database_url().expect("setup 已确认配置存在");
    let exists = count(
        &fixture.admin,
        &format!("SELECT count(*) FROM pg_roles WHERE rolname = '{NO_PLATFORM_ROLE}'"),
    )
    .await;
    if exists == 0 {
        exec(
            &fixture.admin,
            &format!(
                "CREATE ROLE {NO_PLATFORM_ROLE} LOGIN PASSWORD '{NO_PLATFORM_ROLE}' \
                 NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE"
            ),
        )
        .await;
    }
    exec(
        &fixture.admin,
        &format!("GRANT USAGE ON SCHEMA public TO {NO_PLATFORM_ROLE}"),
    )
    .await;

    // 这个身份**没有**被授予 `cogito_platform`：`SET LOCAL ROLE` 会失败
    let storage = Storage::from_parts(
        connect(&role_uri(&uri, NO_PLATFORM_ROLE), 2).await,
        database_of(&uri),
    );
    let (shutdown, receiver) = watch::channel(false);

    let result = run(
        storage,
        Scripted::default(),
        loop_options(Duration::from_millis(10)),
        receiver,
    )
    .await;
    let _ = shutdown;
    assert!(result.is_err(), "首轮失败必须让 worker 退出：{result:?}");
}

/// 发布循环参数：轮询快、退避长（用例只关心第一轮）。
fn loop_options(poll_interval: Duration) -> LoopOptions {
    LoopOptions {
        poll_interval,
        batch_size: 64,
        backoff_base: Duration::from_secs(60),
        backoff_max: Duration::from_secs(120),
    }
}
