//! 服务身份面的端到端验证（P6a / P6b-1 / P9a）。
//!
//! 这是 cogito 第一次对外提供「机器调用机器」的接口：受信服务进程（当前只有 ai-worker）用
//! 共享令牌换一枚**带作用域**的短期令牌，再拿这枚令牌把嵌入 / 对话调用打回 cogito——出网与
//! 计量都留在 cogito 这一侧，服务进程自己不需要供应商密钥。
//!
//! 令牌按**受众**分发、一件受众一件事：`embeddings` 只能打嵌入端点，`chat` 只能打对话端点，
//! `asset-read` 只能按令牌里写死的那个资产打内容端点。内容端点是同一副面孔的另一半——
//! ai-worker 要切分文件，就得有人把字节递过去，而字节只有 cogito 这一侧存着（CAS）。
//!
//! `asset-write` 是这条通道上唯一的**写**，因此它比别的受众多一道门：先得有一张**人批过的**
//! 审批单，签发时回读台账把审批原文（可见性 + 名单）钉进令牌，写端点不再收请求体，也就不用
//! 相信调用方的任何输入。写以批准人的身份落地——资产行的写策略只认创建者，所以「审批人必须
//! 是资产创建者」不是额外加的规矩，而是唯一能写成功的组合。
//!
//! 需要独立测试库（库名必须含 `test`，避免误伤开发库）与一个真 Redis：
//!
//! ```text
//! TEST_DATABASE_URL=postgres://user:pw@127.0.0.1:5432/cogito_service_test \
//! TEST_REDIS_URL=redis://127.0.0.1:6379/9 \
//!   cargo test --test service_scope
//! ```
//!
//! 任一环境变量缺失即整体跳过。断言只盯 Postgres 与 Redis 上的记账。
//!
//! 覆盖的都是用户面测不到、而这条路径上真会出事的地方：两道请求头不能互换、共享密钥留空
//! 即整面关闭、令牌自带的租户/模型作用域无法被请求体放大、三类受众不能互相串门、以及
//! 服务调用的用量必须和用户调用走同一套配额与审计（否则「gateway 是唯一出网点」这句话
//! 就漏在服务调用上）。
//!
//! 内容端点还会把文件真写到 `cas/`（相对 cwd，和开发环境同一个目录），所以用例的内容里
//! 带随机后缀，收尾只删自己**新建**过的那些对象。

mod support;

use std::cell::RefCell;
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use actix_web::http::header::{CONTENT_LENGTH, CONTENT_TYPE};
use actix_web::{App, test, web};
use migration::MigratorTrait;
use sea_orm::{
    ConnectOptions, ConnectionTrait, Database, DatabaseBackend, DatabaseConnection, Statement,
};
use serde_json::{Value, json};
use cogito::clients::redis::RedisPool;
use cogito::configures::configure::{Configure, SERVICE_TOKEN_MAX_TTL_SECS};
use cogito::databases::database::Storage;
use cogito::databases::scope::PLATFORM_ROLE;
use cogito::guards::service::{INTERNAL_TOKEN_HEADER, SERVICE_ACTOR_ID, SERVICE_TOKEN_HEADER};
use cogito::oas::paths;
use cogito::services::gateway::module::GatewayModule;
use cogito::services::gateway::quota;
use cogito::services::gateway::service_token::{self, Audience, Scope};
use cogito::services::upload::storage;
use cogito::utils::code::{auth, business, external, request as request_codes, resource, system};
use support::{StubHttp, StubResponse, bypass_proxy_for_local_stubs, test_database_url};
use tokio::sync::Mutex;
use uuid::Uuid;

/// 隔离断言必须运行在非属主角色下：表属主默认绕过策略（迁移已 FORCE）。
const APP_ROLE: &str = "cogito_app_test";

/// 服务进程侧的共享密钥（请求头 `X-Internal-Token`）。
const INTERNAL_TOKEN: &str = "test-internal-token-at-least-32-chars";

/// cogito 侧签发服务令牌的密钥（`gateway.serviceTokenSecret`）。
const SERVICE_SECRET: &str = "test-service-token-secret-at-least-32";

/// 另一把密钥：用来伪造一枚签名对不上的令牌。
const OTHER_SECRET: &str = "some-other-secret-at-least-32-chars-long";

/// 配置里的默认令牌有效期（秒），用于断言「未指定 ttl 时按配置来」。
const SERVICE_TOKEN_TTL_SECS: u64 = 300;

/// 上游在 `usage` 里报的 token 数：用来核对记账落的是上游报的数而不是我们猜的数。
const TOTAL_TOKENS: i64 = 11;

/// 每个用例都要 `fresh` 整个库，因此必须串行。
static DB_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// 请求 `/service/*` 需要的四件套（与 handler 上的 `web::Data<Arc<_>>` 一一对应）。
struct Shared {
    storage: Arc<Storage>,
    redis: Arc<RedisPool>,
    config: Arc<Configure>,
}

struct Fixture {
    /// 超级用户连接：种数据、按「不受作用域限制」的口径核对真实行。
    admin: DatabaseConnection,
    shared: Shared,
    tenant_a: Uuid,
    tenant_b: Uuid,
    /// 甲租户私有供应商（出站地址指向上游桩）。
    provider_a: Uuid,
    /// 声明了 `embeddings` 能力的甲租户私有模型。
    model_embed: Uuid,
    model_embed_name: String,
    /// 未声明嵌入能力的甲租户私有模型（用来验证能力闸门）。
    model_plain: Uuid,
    model_plain_name: String,
    /// 显式声明「不支持工具调用」的甲租户私有模型（用来验证对话面的能力闸门）。
    model_notools: Uuid,
    model_notools_name: String,
    /// 乙租户私有模型（用来验证跨租户不可见）。
    model_b: Uuid,
    model_b_name: String,
    /// `asset-read` 受众用到的样本资产（跨租户 / 未完成两条都要有）。
    assets: Assets,
    /// 本次用例写进 CAS 的文件（`cas/` 与开发环境共用）：用例结束删掉，只删自己新建的。
    cas_files: RefCell<Vec<String>>,
}

/// 内容端点的样本资产：可读的一份、别的租户的一份、本租户未完成的一份。
#[derive(Default)]
struct Assets {
    tenant_a: SeededAsset,
    tenant_b: SeededAsset,
    pending: SeededAsset,
}

/// 一份资产在库里的 id 与它在 CAS 里的明文——断言要拿两者直接对拍。
#[derive(Default)]
struct SeededAsset {
    id: Uuid,
    content: String,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        for hash in self.cas_files.borrow().iter() {
            let _ = std::fs::remove_file(storage::cas_path(hash));
        }
    }
}

/// 只挂网关模块的最小 App：`/api/v1` 前缀与生产一致，中间件与鉴权不参与断言。
///
/// 写成宏而不是函数，是为了让 `App` 的类型（`ServiceFactory` 的一长串泛型参数）留在调用点
/// 推断——与 `cogito::bootstrap_app!` 同一个理由。
macro_rules! build_app {
    ($shared:expr) => {
        test::init_service(
            App::new()
                .app_data(web::Data::new(Arc::clone(&$shared.storage)))
                .app_data(web::Data::new(Arc::clone(&$shared.redis)))
                .app_data(web::Data::new(Arc::clone(&$shared.config)))
                .service(web::scope("/api/v1").configure(GatewayModule::configure)),
        )
        .await
    };
}

/// 把测试库 URI 的账号换成应用角色，模拟真实部署下的连接身份（非属主、无 BYPASSRLS）。
fn app_uri(uri: &str) -> String {
    let (scheme, rest) = uri
        .split_once("://")
        .expect("TEST_DATABASE_URL 需要带 scheme");
    let (_, host) = rest
        .rsplit_once('@')
        .expect("TEST_DATABASE_URL 需要带账号信息");

    format!("{scheme}://{APP_ROLE}:{APP_ROLE}@{host}")
}

fn database_of(uri: &str) -> String {
    let tail = uri.rsplit('/').next().unwrap_or_default();

    tail.split('?').next().unwrap_or_default().to_owned()
}

/// 配额计数落在真 Redis 上（不是内存假实现），所以必须显式配置，缺失即跳过。
fn test_redis_url() -> Option<String> {
    let uri = std::env::var("TEST_REDIS_URL").ok()?.trim().to_owned();
    if uri.is_empty() { None } else { Some(uri) }
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

/// 单个整数标量（`bigint` 口径）；查询失败或没结果都是断言失败。
async fn scalar<C: ConnectionTrait>(conn: &C, sql: &str) -> i64 {
    conn.query_one_raw(Statement::from_string(
        DatabaseBackend::Postgres,
        sql.to_owned(),
    ))
    .await
    .unwrap_or_else(|err| panic!("查询失败：{sql}\n{err}"))
    .unwrap_or_else(|| panic!("查询没有返回结果：{sql}"))
    .try_get_by_index::<i64>(0)
    .expect("结果不是 bigint")
}

/// 单个文本标量；查询失败或没结果都是断言失败。
async fn text_scalar<C: ConnectionTrait>(conn: &C, sql: &str) -> String {
    conn.query_one_raw(Statement::from_string(
        DatabaseBackend::Postgres,
        sql.to_owned(),
    ))
    .await
    .unwrap_or_else(|err| panic!("查询失败：{sql}\n{err}"))
    .unwrap_or_else(|| panic!("查询没有返回结果：{sql}"))
    .try_get_by_index::<String>(0)
    .expect("结果不是文本")
}

/// 资产行的「可见性 + 谁建的 + 谁最后改的」——三个字段一起断言，才看得出写入是以谁的身份落地的。
async fn visibility_of<C: ConnectionTrait>(conn: &C, asset: Uuid) -> String {
    text_scalar(
        conn,
        &format!(
            r#"SELECT "visibility" || '|' || coalesce("creator"::text, '-') || '|'
              || coalesce("updater"::text, '-')
         FROM asset WHERE id = '{asset}'"#
        ),
    )
    .await
}

/// 资产行的可见对象名单，按库里的原样读回来再解析（免得断言依赖 jsonb 的排版）。
async fn viewers_of<C: ConnectionTrait>(conn: &C, asset: Uuid) -> Value {
    let raw = text_scalar(
        conn,
        &format!(r#"SELECT coalesce("viewers"::text, 'null') FROM asset WHERE id = '{asset}'"#),
    )
    .await;

    serde_json::from_str(&raw).unwrap_or_else(|err| panic!("viewers 不是 JSON：{raw}\n{err}"))
}

/// 种一个用户：写字工具要「以人的身份」落地，而 `asset."creator"` 指向 `auth` 行。
async fn seed_user(fixture: &Fixture, tag: &str) -> Uuid {
    let id = Uuid::new_v4();
    let tail = &id.simple().to_string()[..8];

    exec(
        &fixture.admin,
        &format!(
            r#"INSERT INTO auth (id, username, password, role, status, "createdAt", "updatedAt")
       VALUES ('{id}', 'svc-{tag}-{tail}', 'x', 'USER', 'ACTIVE', now(), now())"#
        ),
    )
    .await;

    id
}

/// 种一个**有主**的资产（`creator` 指向真人）：只有创建者本人才能改可见性。
///
/// 不种分片也不进 CAS——这组用例只关心可见性的落库，不关心字节。
async fn seed_owned_asset(fixture: &Fixture, tenant: Uuid, creator: Uuid) -> Uuid {
    let id = Uuid::new_v4();
    let content = id.as_bytes();

    exec(
        &fixture.admin,
        &format!(
            r#"INSERT INTO asset
         (id, "tenantID", kind, hash, size, "index", mime, name, status, visibility,
          chunk, total, creator, "createdAt", "updatedAt")
       VALUES ('{id}', '{tenant}', 'file', '{}', {}, 0, 'text/plain', 'owned-{id}',
               'COMPLETED', 'PRIVATE', 0, 0, '{creator}', now(), now())"#,
            storage::calculate_hash(content),
            content.len() as i64
        ),
    )
    .await;

    id
}

/// 种一条审批台账：一个任务 + 它的第 0 步待批记录，返回审批号。
///
/// 审批号在主程序里是 `{taskID}:{step}:{index}`——这里照这个形状拼，好让「审批号不存在」的
/// 负例和真货长得一样。
async fn seed_approval(
    fixture: &Fixture,
    tenant: Uuid,
    requester: Uuid,
    state: &str,
    decided_by: Option<Uuid>,
    arguments: &str,
) -> String {
    let task = Uuid::new_v4();
    let approval = format!("{task}:0:0");
    let escaped = arguments.replace('\'', "''");
    let decider = decided_by.map_or_else(|| "NULL".to_owned(), |id| format!("'{id}'"));
    let reason = if state == "REJECTED" { "不同意" } else { "" };

    exec(
        &fixture.admin,
        &format!(
            r#"INSERT INTO agent_task
         (id, "tenantID", "userID", status, objective, model, "maxSteps", "allowedTools",
          "instanceID", "createdAt", "updatedAt")
       VALUES ('{task}', '{tenant}', '{requester}', 'RUNNING', '把这份文件标成只给这几个人看',
               'stub-model', 4, '["asset_visibility_write"]'::jsonb, 'agent-{task}',
               now(), now())"#
        ),
    )
    .await;
    exec(
        &fixture.admin,
        &format!(
            r#"INSERT INTO agent_approval
         (id, "tenantID", "taskID", step, tool, arguments, state, "decidedBy", "decidedAt",
          reason, "expiresAt", "createdAt", "updatedAt")
       VALUES ('{approval}', '{tenant}', '{task}', 0, 'asset_visibility_write', '{escaped}',
               '{state}', {decider}, now(), '{reason}', now() + interval '1 hour',
               now(), now())"#
        ),
    )
    .await;

    approval
}

/// 重建库、建应用角色、授权、种两个租户的目录；锁未持有时不得调用。
///
/// `service_secret`：`None` = 用默认测试密钥；`Some("")` = 模拟「未配置」（整面关闭）。
async fn setup(upstream_base_url: &str, service_secret: Option<&str>) -> Option<Fixture> {
    let uri = test_database_url()?;
    let redis_url = test_redis_url()?;
    // 必须早于任何 HTTP 客户端构造：本机系统代理会把发往 127.0.0.1 的请求也劫走
    bypass_proxy_for_local_stubs();

    let admin = connect(&uri, 2).await;
    migration::Migrator::fresh(&admin)
        .await
        .expect("重建测试库失败");

    let exists = scalar(
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
        format!("GRANT {PLATFORM_ROLE} TO {APP_ROLE}"),
    ] {
        exec(&admin, &sql).await;
    }

    let mut config = Configure::default();
    config.ai_worker.token = INTERNAL_TOKEN.to_owned();
    config.gateway.service_token_secret = service_secret.unwrap_or(SERVICE_SECRET).to_owned();
    config.gateway.service_token_ttl_secs = SERVICE_TOKEN_TTL_SECS;

    // 模型名带随机后缀：目录行的 `name` 没有库级唯一约束，串行用例之间不该互相踩到
    let suffix = Uuid::new_v4().simple().to_string();
    let suffix = &suffix[..8];

    let mut fixture = Fixture {
        admin,
        shared: Shared {
            storage: Arc::new(Storage::from_parts(
                connect(&app_uri(&uri), 2).await,
                database_of(&uri),
            )),
            redis: Arc::new(
                RedisPool::new(&redis_url, 4)
                    .await
                    .expect("连接测试 Redis 失败"),
            ),
            config: Arc::new(config),
        },
        tenant_a: Uuid::new_v4(),
        tenant_b: Uuid::new_v4(),
        provider_a: Uuid::new_v4(),
        model_embed: Uuid::new_v4(),
        model_embed_name: format!("svc-embed-{suffix}"),
        model_plain: Uuid::new_v4(),
        model_plain_name: format!("svc-plain-{suffix}"),
        model_notools: Uuid::new_v4(),
        model_notools_name: format!("svc-notools-{suffix}"),
        model_b: Uuid::new_v4(),
        model_b_name: format!("svc-embed-b-{suffix}"),
        assets: Assets::default(),
        cas_files: RefCell::new(Vec::new()),
    };
    let assets = seed(&fixture, upstream_base_url).await;
    fixture.assets = assets;

    Some(fixture)
}

/// 两个租户各一条目录行；甲租户下三个模型：一个声明嵌入能力、一个没声明、一个是乙租户私有（同样声明了能力）。
///
/// 顺带种下 `asset-read` 要读的三份资产：甲租户可读的一份、乙租户的一份（验证作用域不会
/// 被路径放大）、甲租户**未完成**的一份（验证未完成的上传签发不出读取令牌）。
async fn seed(fixture: &Fixture, upstream_base_url: &str) -> Assets {
    let admin = &fixture.admin;

    for (tag, tenant) in [("a", fixture.tenant_a), ("b", fixture.tenant_b)] {
        exec(
            admin,
            &format!(
                r#"INSERT INTO tenant (id, name, slug, status, "type", "createdAt", "updatedAt")
                   VALUES ('{tenant}', 'Service {tag}', '{tenant}', 'ACTIVE', 'PERSONAL', now(), now())"#
            ),
        )
        .await;
    }

    // 私有供应商：甲租户的出站点指向上游桩，密钥留空（因此不该有 Authorization 头）
    exec(
        admin,
        &format!(
            r#"INSERT INTO gateway_provider (id, kind, name, "baseURL", "apiKeyEnc", status, "createdAt", "updatedAt", "tenantID")
               VALUES ('{}', 'openai', 'svc-provider-a', '{upstream_base_url}', '', 'ACTIVE', now(), now(), '{}')"#,
            fixture.provider_a, fixture.tenant_a
        ),
    )
    .await;

    // 乙租户的模型也声明了嵌入能力：跨租户 404 必须来自作用域，而不是「能力没声明」
    for (id, name, tenant, capabilities) in [
        (
            fixture.model_embed,
            &fixture.model_embed_name,
            fixture.tenant_a,
            json!({ "embeddings": true }),
        ),
        (
            fixture.model_plain,
            &fixture.model_plain_name,
            fixture.tenant_a,
            json!({ "chat": true }),
        ),
        (
            fixture.model_notools,
            &fixture.model_notools_name,
            fixture.tenant_a,
            json!({ "tools": false }),
        ),
        (
            fixture.model_b,
            &fixture.model_b_name,
            fixture.tenant_b,
            json!({ "embeddings": true }),
        ),
    ] {
        exec(
            admin,
            &format!(
                r#"INSERT INTO gateway_model
                     (id, "providerID", name, label, enabled, capabilities, "createdAt", "updatedAt", "tenantID")
                   VALUES ('{id}', '{}', '{name}', 'Svc', true, '{capabilities}', now(), now(), '{tenant}')"#,
                fixture.provider_a
            ),
        )
        .await;
    }

    // 内容都带随机后缀：`cas/` 是所有用例（也是开发环境）共用的目录，内容不同才不会互相命中
    let suffix = Uuid::new_v4().simple().to_string();
    let suffix = &suffix[..8];
    Assets {
        tenant_a: seed_asset(
            fixture,
            fixture.tenant_a,
            "COMPLETED",
            &[
                &format!("alpha-{suffix}-"),
                &format!("beta-{suffix}-"),
                &format!("gamma-{suffix}"),
            ],
        )
        .await,
        tenant_b: seed_asset(
            fixture,
            fixture.tenant_b,
            "COMPLETED",
            &[&format!("other-tenant-{suffix}")],
        )
        .await,
        pending: seed_asset(
            fixture,
            fixture.tenant_a,
            "UPLOADING",
            &[&format!("half-uploaded-{suffix}")],
        )
        .await,
    }
}

/// 种一份「库里的行 + CAS 里的字节都自洽」的资产：分片按内容寻址写进 CAS，`asset` / `chunk`
/// 两行按同一份分片清单登记。
///
/// 走的是真文件系统（内容端点真的会去读 `cas/`），所以用 `store_cas` 而不是手工造目录，并在
/// 返回时记下**新建**的对象，交给 [`Fixture::drop`] 收拾——已经存在（说明别人写过同一份内容）
/// 的就不能删。
async fn seed_asset(fixture: &Fixture, tenant: Uuid, status: &str, chunks: &[&str]) -> SeededAsset {
    let id = Uuid::new_v4();
    let content = chunks.concat();

    // 行级策略按「本租户」放行 asset 的只读分支，`creator` 留空即可（服务身份不是某个用户）
    exec(
        &fixture.admin,
        &format!(
            r#"INSERT INTO asset
                 (id, "tenantID", kind, hash, size, "index", mime, name, status, visibility,
                  chunk, total, "createdAt", "updatedAt")
               VALUES ('{id}', '{tenant}', 'file', '{}', {}, 0, 'text/plain', 'svc-{id}',
                       '{status}', 'PRIVATE', {}, {}, now(), now())"#,
            storage::calculate_hash(content.as_bytes()),
            content.len() as i64,
            chunks.first().map_or(0, |chunk| chunk.len() as i32),
            chunks.len() as i32
        ),
    )
    .await;

    // 分片行带 asset 外键，所以必须排在 asset 之后
    for (index, chunk) in chunks.iter().enumerate() {
        let hash = storage::calculate_hash(chunk.as_bytes());
        let reused = storage::store_cas(&hash, chunk.as_bytes())
            .await
            .expect("写 CAS 失败");
        if !reused {
            fixture.cas_files.borrow_mut().push(hash.clone());
        }
        exec(
            &fixture.admin,
            &format!(
                r#"INSERT INTO chunk (id, "assetID", "index", hash, size, "createdAt")
                   VALUES ('{}', '{id}', {index}, '{hash}', {}, now())"#,
                Uuid::new_v4(),
                chunk.len() as i64
            ),
        )
        .await;
    }

    SeededAsset { id, content }
}

/// 发一条请求，读出 `(HTTP 状态, JSON 体)`。
///
/// 与 [`build_app`] 同理写成宏：`init_service` 返回的服务的请求/响应类型不可命名，留在调用点推断才写得出来。
/// 展开成 `async` 块，调用处照常 `.await`。
macro_rules! call {
    ($app:expr, $request:expr $(,)?) => {
        async {
            let response = test::call_service(&$app, $request.to_request()).await;
            let status = response.status().as_u16();
            let body = test::read_body(response).await;

            (
                status,
                serde_json::from_slice::<Value>(&body).unwrap_or(Value::Null),
            )
        }
    };
}

/// 发一条请求，读出 `(HTTP 状态, 响应头, 原始字节)`。
///
/// 内容端点回的是文件本身而不是 JSON，所以要能拿到字节流与头部——与 `cas/` 里的明文逐字节
/// 对拍这件事，只能这么验。
macro_rules! call_raw {
    ($app:expr, $request:expr $(,)?) => {
        async {
            let response = test::call_service(&$app, $request.to_request()).await;
            let status = response.status().as_u16();
            let headers = response.headers().clone();

            (status, headers, test::read_body(response).await)
        }
    };
}

fn token_request(tenant: Uuid, model: &str) -> test::TestRequest {
    test::TestRequest::post()
        .uri(paths::SERVICE_TOKEN)
        .insert_header((INTERNAL_TOKEN_HEADER, INTERNAL_TOKEN))
        .set_json(json!({ "tenantID": tenant.to_string(), "model": model }))
}

fn token_request_with_ttl(tenant: Uuid, model: &str, ttl_secs: u64) -> test::TestRequest {
    test::TestRequest::post()
        .uri(paths::SERVICE_TOKEN)
        .insert_header((INTERNAL_TOKEN_HEADER, INTERNAL_TOKEN))
        .set_json(json!({
            "tenantID": tenant.to_string(),
            "model": model,
            "ttlSecs": ttl_secs,
        }))
}

fn embeddings_request(token: &str, body: Value) -> test::TestRequest {
    test::TestRequest::post()
        .uri(paths::SERVICE_EMBEDDINGS)
        .insert_header((SERVICE_TOKEN_HEADER, token))
        .set_json(body)
}

/// 打服务面**对话**端点。
fn chat_request(token: &str, body: Value) -> test::TestRequest {
    test::TestRequest::post()
        .uri(paths::SERVICE_CHAT)
        .insert_header((SERVICE_TOKEN_HEADER, token))
        .set_json(body)
}

/// 申请一枚**对话**令牌（`scope = chat`）：作用域是「一个租户的一个模型」。
fn chat_token_request(tenant: Uuid, model: &str) -> test::TestRequest {
    test::TestRequest::post()
        .uri(paths::SERVICE_TOKEN)
        .insert_header((INTERNAL_TOKEN_HEADER, INTERNAL_TOKEN))
        .set_json(json!({
            "tenantID": tenant.to_string(),
            "scope": "chat",
            "model": model,
        }))
}

/// 申请一枚**内容读取**令牌（`scope = asset-read`）：作用域是「一个租户的一个资产」。
fn asset_token_request(tenant: Uuid, scope: &str, asset_id: &str) -> test::TestRequest {
    test::TestRequest::post()
        .uri(paths::SERVICE_TOKEN)
        .insert_header((INTERNAL_TOKEN_HEADER, INTERNAL_TOKEN))
        .set_json(json!({
            "tenantID": tenant.to_string(),
            "scope": scope,
            "assetID": asset_id,
        }))
}

/// 申请一枚**可见性写入**令牌（`scope = asset-write`）：作用域是「一个租户的一个资产 + 一次审批」。
///
/// 这里没有可见性也没有名单——参数不在请求体里，而在那张审批单上。
fn asset_write_request(tenant: Uuid, asset_id: &str, approval_id: &str) -> test::TestRequest {
    test::TestRequest::post()
        .uri(paths::SERVICE_TOKEN)
        .insert_header((INTERNAL_TOKEN_HEADER, INTERNAL_TOKEN))
        .set_json(json!({
            "tenantID": tenant.to_string(),
            "scope": "asset-write",
            "assetID": asset_id,
            "approvalID": approval_id,
        }))
}

/// 打内容端点。路径里的 `{id}` 占位符是给文档/路由清单用的，请求时得换成真 id。
fn asset_content_request(asset_id: &str, token: &str) -> test::TestRequest {
    test::TestRequest::get()
        .uri(&paths::SERVICE_ASSET_CONTENT.replace("{id}", asset_id))
        .insert_header((SERVICE_TOKEN_HEADER, token))
}

/// 打可见性写入端点：写什么全在令牌里，所以这里**不发请求体**。
fn asset_visibility_request(asset_id: &str, token: &str) -> test::TestRequest {
    test::TestRequest::put()
        .uri(&paths::SERVICE_ASSET_VISIBILITY.replace("{id}", asset_id))
        .insert_header((SERVICE_TOKEN_HEADER, token))
}

/// 上游在 `usage` 里报 [`TOTAL_TOKENS`] 个 token，并回一条可识别的向量。
fn upstream_body() -> Value {
    json!({
        "object": "list",
        "data": [{ "object": "embedding", "index": 0, "embedding": [0.5, 0.25] }],
        "model": "upstream-model",
        "usage": { "prompt_tokens": TOTAL_TOKENS, "total_tokens": TOTAL_TOKENS },
    })
}

/// 上游回的对话形状：同样带 `usage`，好核对记账落的是上游报的数而不是我们猜的数。
fn upstream_chat_body() -> Value {
    json!({
        "id": "chatcmpl-stub",
        "object": "chat.completion",
        "model": "upstream-model",
        "choices": [{
            "index": 0,
            "message": { "role": "assistant", "content": "pong" },
            "finish_reason": "stop",
        }],
        "usage": { "prompt_tokens": 7, "completion_tokens": 4, "total_tokens": TOTAL_TOKENS },
    })
}

/// 信封里的 `code`（错误码常量是 `i32`，JSON 里读出来是 `i64`，这里转回来）。
fn error_code(body: &Value) -> i32 {
    body["code"]
        .as_i64()
        .and_then(|code| i32::try_from(code).ok())
        .unwrap_or_else(|| panic!("响应里没有数字 code：{body}"))
}

/// 用正确的内部令牌换一枚令牌（断言 200），返回响应体。
macro_rules! mint {
    ($app:expr, $tenant:expr, $model:expr $(,)?) => {
        async {
            let (status, body) = call!($app, token_request($tenant, $model)).await;
            assert_eq!(status, 200, "签发服务令牌失败：{body}");

            body
        }
    };
}

/// 取一枚指向甲租户自己模型的令牌（[`another_tenants_model_is_invisible`] 的反证用）。
macro_rules! token_for_own_model {
    ($fixture:expr, $app:expr $(,)?) => {
        async {
            let body = mint!($app, $fixture.tenant_a, &$fixture.model_embed_name).await;

            body["token"].as_str().expect("响应缺少 token").to_owned()
        }
    };
}

/// 用正确的内部令牌换一枚**内容读取**令牌（断言 200），返回响应体。
macro_rules! mint_asset_token {
    ($app:expr, $tenant:expr, $asset:expr $(,)?) => {
        async {
            let (status, body) =
                call!($app, asset_token_request($tenant, "asset-read", $asset)).await;
            assert_eq!(status, 200, "签发资产读取令牌失败：{body}");

            body
        }
    };
}

/// 用正确的内部令牌换一枚**对话**令牌（断言 200），返回响应体。
macro_rules! mint_chat_token {
    ($app:expr, $tenant:expr, $model:expr $(,)?) => {
        async {
            let (status, body) = call!($app, chat_token_request($tenant, $model)).await;
            assert_eq!(status, 200, "签发对话令牌失败：{body}");

            body
        }
    };
}

/// 换一枚写令牌，断言签发成功并回响应体。
macro_rules! mint_write_token {
    ($app:expr, $tenant:expr, $asset:expr, $approval:expr $(,)?) => {
        async {
            let (status, body) =
                call!($app, asset_write_request($tenant, $asset, $approval),).await;
            assert_eq!(status, 200, "签发写令牌失败：{body}");

            body
        }
    };
}

/// 从响应体里取令牌串。
fn token_of(body: &Value) -> String {
    body["token"].as_str().expect("响应缺少 token").to_owned()
}

/// 令牌里的作用域就是 cogito 认定的作用域：按该端点的受众验签一遍再断言，而不是只信响应字段。
fn claims_of(body: &Value, audience: Audience) -> service_token::ServiceClaims {
    let token = body["token"].as_str().expect("响应缺少 token");

    service_token::verify(SERVICE_SECRET, token, audience).expect("刚签发的令牌应当可验签")
}

#[actix_web::test]
async fn internal_token_is_required_and_not_interchangeable() {
    let _guard = DB_LOCK.lock().await;
    let upstream = StubHttp::start(vec![StubResponse::json(200, upstream_body())]).await;
    let Some(fixture) = setup(&upstream.base_url(), None).await else {
        return;
    };
    let app = build_app!(fixture.shared);

    // 不带共享密钥：401（不能说「body 合法就放过」）
    let (status, body) = call!(
        &app,
        test::TestRequest::post()
            .uri(paths::SERVICE_TOKEN)
            .set_json(json!({
                "tenantID": fixture.tenant_a.to_string(),
                "model": fixture.model_embed_name,
            })),
    )
    .await;
    assert_eq!(status, 401);
    assert_eq!(error_code(&body), auth::INVALID_CREDENTIALS);

    // 共享密钥写错：同样 401（不能退化成「有这个头就行」）
    let (status, _) = call!(
        &app,
        token_request(fixture.tenant_a, &fixture.model_embed_name)
            .insert_header((INTERNAL_TOKEN_HEADER, "wrong-internal-token")),
    )
    .await;
    assert_eq!(status, 401);

    // 拿**合法的服务令牌**冒充内部令牌：两道头对应两种信任，不能互换
    let (minted, _) = service_token::mint(
        SERVICE_SECRET,
        Scope::Embeddings {
            tenant_id: &fixture.tenant_a.to_string(),
            model: &fixture.model_embed_name,
        },
        60,
    )
    .unwrap();
    let (status, _) = call!(
        &app,
        test::TestRequest::post()
            .uri(paths::SERVICE_TOKEN)
            .insert_header((INTERNAL_TOKEN_HEADER, minted.as_str()))
            .set_json(json!({
                "tenantID": fixture.tenant_a.to_string(),
                "model": fixture.model_embed_name,
            })),
    )
    .await;
    assert_eq!(status, 401);

    // 反过来：服务令牌放在 X-Service-Token 上换令牌也没用（守卫只认 X-Internal-Token）
    let (status, _) = call!(
        &app,
        test::TestRequest::post()
            .uri(paths::SERVICE_TOKEN)
            .insert_header((SERVICE_TOKEN_HEADER, minted.as_str()))
            .set_json(json!({
                "tenantID": fixture.tenant_a.to_string(),
                "model": fixture.model_embed_name,
            })),
    )
    .await;
    assert_eq!(status, 401);

    assert!(
        upstream.requests().is_empty(),
        "签发阶段不该触网：{:#?}",
        upstream.requests()
    );
}

#[actix_web::test]
async fn token_issuance_checks_tenant_not_model() {
    let _guard = DB_LOCK.lock().await;
    let upstream = StubHttp::start(vec![StubResponse::json(200, upstream_body())]).await;
    let Some(fixture) = setup(&upstream.base_url(), None).await else {
        return;
    };
    let app = build_app!(fixture.shared);

    // 未知租户：404（否则等于给任意租户发令牌）
    let (status, body) = call!(
        &app,
        token_request(Uuid::new_v4(), &fixture.model_embed_name),
    )
    .await;
    assert_eq!(status, 404);
    assert_eq!(error_code(&body), resource::NOT_FOUND);

    // 租户 ID 不是 UUID：400，且不能落到「查不到」的 404 上
    let (status, body) = call!(
        &app,
        test::TestRequest::post()
            .uri(paths::SERVICE_TOKEN)
            .insert_header((INTERNAL_TOKEN_HEADER, INTERNAL_TOKEN))
            .set_json(json!({ "tenantID": "not-a-uuid", "model": "m" })),
    )
    .await;
    assert_eq!(status, 400);
    assert_eq!(error_code(&body), request_codes::INVALID_PARAMETER_VALUE);

    // model 为空：400
    let (status, _) = call!(
        &app,
        test::TestRequest::post()
            .uri(paths::SERVICE_TOKEN)
            .insert_header((INTERNAL_TOKEN_HEADER, INTERNAL_TOKEN))
            .set_json(json!({
                "tenantID": fixture.tenant_a.to_string(),
                "model": "  ",
            })),
    )
    .await;
    assert_eq!(status, 400);

    // 模型是否存在/是否可用**不在这里判定**：令牌段只认租户，判定留给真正出站的那一次
    let (status, _) = call!(
        &app,
        token_request(fixture.tenant_a, "no-such-model-at-all"),
    )
    .await;
    assert_eq!(status, 200);

    assert!(upstream.requests().is_empty());
}

#[actix_web::test]
async fn token_carries_scope_and_clamps_ttl() {
    let _guard = DB_LOCK.lock().await;
    let upstream = StubHttp::start(vec![StubResponse::json(200, upstream_body())]).await;
    let Some(fixture) = setup(&upstream.base_url(), None).await else {
        return;
    };
    let app = build_app!(fixture.shared);

    // 缺省 TTL 来自配置
    let body = mint!(&app, fixture.tenant_a, &fixture.model_embed_name).await;
    assert_eq!(body["tokenType"], json!("service"));
    assert_eq!(body["model"], json!(fixture.model_embed_name));
    assert_eq!(body["tenantID"], json!(fixture.tenant_a.to_string()));
    // 不写 scope 就是嵌入：默认值是唯一的，不能靠调用方每次都记得写
    assert_eq!(body["scope"], json!("embeddings"));
    assert!(body.get("assetID").is_none(), "嵌入令牌不该带 assetID");

    let claims = claims_of(&body, Audience::Embeddings);
    assert_eq!(claims.sub, service_token::SUBJECT);
    assert_eq!(claims.aud, service_token::AUDIENCE_EMBEDDINGS);
    assert_eq!(
        claims.model.as_deref(),
        Some(fixture.model_embed_name.as_str())
    );
    assert!(claims.asset_id.is_none());
    assert_eq!(claims.tenant_id, fixture.tenant_a.to_string());
    assert_eq!(body["expiresAt"], json!(claims.exp));
    assert_eq!(claims.exp - claims.iat, SERVICE_TOKEN_TTL_SECS as i64);

    // 想要更长的有效期会被压到上限：调用方不能自己把窗口拉长
    let (status, body) = call!(
        &app,
        token_request_with_ttl(fixture.tenant_a, &fixture.model_embed_name, 99_999),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(
        claims_of(&body, Audience::Embeddings).exp - claims_of(&body, Audience::Embeddings).iat,
        SERVICE_TOKEN_MAX_TTL_SECS as i64
    );

    // 0 秒被抬到 1 秒：不会签出一枚出生即过期的令牌
    let (status, body) = call!(
        &app,
        token_request_with_ttl(fixture.tenant_a, &fixture.model_embed_name, 0),
    )
    .await;
    assert_eq!(status, 200);
    let claims = claims_of(&body, Audience::Embeddings);
    assert_eq!(claims.exp - claims.iat, 1);

    assert!(upstream.requests().is_empty());
}

#[actix_web::test]
async fn empty_secret_disables_the_whole_surface() {
    let _guard = DB_LOCK.lock().await;
    let upstream = StubHttp::start(vec![StubResponse::json(200, upstream_body())]).await;
    let Some(fixture) = setup(&upstream.base_url(), Some("")).await else {
        return;
    };
    let app = build_app!(fixture.shared);

    // 没配密钥：签发端点 503，而不是「签出一个谁都能验不过的令牌」
    let (status, body) = call!(
        &app,
        token_request(fixture.tenant_a, &fixture.model_embed_name),
    )
    .await;
    assert_eq!(status, 503);
    assert_eq!(error_code(&body), system::SERVICE_UNAVAILABLE);

    // 出站面同样关闭：连随手编的令牌也是 503（说明是整面关，不只是关了签发）
    let (status, _) = call!(
        &app,
        embeddings_request("whatever-not-a-jwt", json!({ "input": ["hi"] })),
    )
    .await;
    assert_eq!(status, 503);

    assert!(upstream.requests().is_empty());
}

#[actix_web::test]
async fn forged_token_is_rejected_before_any_egress() {
    let _guard = DB_LOCK.lock().await;
    let upstream = StubHttp::start(vec![StubResponse::json(200, upstream_body())]).await;
    let Some(fixture) = setup(&upstream.base_url(), None).await else {
        return;
    };
    let app = build_app!(fixture.shared);

    // 密钥不同 → 签名对不上；形状不对 → 连解析都过不去。两者都必须是 401
    let (forged, _) = service_token::mint(
        OTHER_SECRET,
        Scope::Embeddings {
            tenant_id: &fixture.tenant_a.to_string(),
            model: &fixture.model_embed_name,
        },
        300,
    )
    .unwrap();
    for token in [forged.as_str(), "not-a-jwt", ""] {
        let (status, body) =
            call!(&app, embeddings_request(token, json!({ "input": ["hi"] })),).await;
        assert_eq!(status, 401, "令牌 {token:?} 不该被接受");
        assert_eq!(error_code(&body), auth::INVALID_CREDENTIALS);
    }

    assert!(
        upstream.requests().is_empty(),
        "验签失败必须在出站之前发生：{:#?}",
        upstream.requests()
    );
}

#[actix_web::test]
async fn embeddings_forwards_and_meters() {
    let _guard = DB_LOCK.lock().await;
    let upstream = StubHttp::start(vec![StubResponse::json(200, upstream_body())]).await;
    let Some(fixture) = setup(&upstream.base_url(), None).await else {
        return;
    };
    let app = build_app!(fixture.shared);

    let body = mint!(&app, fixture.tenant_a, &fixture.model_embed_name).await;
    let token = body["token"].as_str().expect("响应缺少 token").to_owned();

    let (status, response_body) = call!(
        &app,
        embeddings_request(
            &token,
            json!({ "input": ["a", "b"], "dimensions": 8, "encoding_format": "float" }),
        ),
    )
    .await;
    assert_eq!(status, 200, "嵌入转发失败：{response_body}");
    // 上游 JSON 原样返回（裸结构，不套信封）：调用方按 OpenAI 形状解析即可
    assert_eq!(response_body["data"][0]["embedding"][0], json!(0.5));

    let request = upstream.only();
    assert_eq!(request.method, "POST");
    assert_eq!(request.path, "/embeddings");
    let sent = request.json();
    // 模型来自令牌作用域；`input`/`dimensions` 等由调用方透传
    assert_eq!(sent["model"], json!(fixture.model_embed_name));
    assert_eq!(sent["input"], json!(["a", "b"]));
    assert_eq!(sent["dimensions"], json!(8));
    assert_eq!(sent["encoding_format"], json!("float"));
    // 供应商没配密钥：不许凭空造 Authorization 头
    assert!(request.header("authorization").is_none());

    // 记账三件套缺一个，都意味着服务调用绕过了计量
    let usage_rows = scalar(
        &fixture.admin,
        &format!(
            r#"SELECT count(*) FROM gateway_usage
               WHERE "tenantID" = '{}' AND "modelID" = '{}' AND "providerID" = '{}'"#,
            fixture.tenant_a, fixture.model_embed, fixture.provider_a
        ),
    )
    .await;
    assert_eq!(usage_rows, 1);

    let tokens = scalar(
        &fixture.admin,
        &format!(
            r#"SELECT coalesce(sum("promptTokens"), 0)::bigint FROM gateway_usage WHERE "tenantID" = '{}'"#,
            fixture.tenant_a
        ),
    )
    .await;
    assert_eq!(tokens, TOTAL_TOKENS);

    let key = quota::quota_key("tenant", &fixture.tenant_a);
    assert_eq!(
        quota::used_tokens(&fixture.shared.redis, &key)
            .await
            .expect("读配额失败"),
        TOTAL_TOKENS,
        "服务调用的用量必须计入同一个日窗配额"
    );

    let audits = scalar(
        &fixture.admin,
        &format!(
            r#"SELECT count(*) FROM gateway_audit
               WHERE action = 'gateway.embeddings' AND actor = '{SERVICE_ACTOR_ID}'
                 AND "tenantID" = '{}'"#,
            fixture.tenant_a
        ),
    )
    .await;
    assert_eq!(audits, 1);
}

#[actix_web::test]
async fn body_model_cannot_widen_the_token_scope() {
    let _guard = DB_LOCK.lock().await;
    let upstream = StubHttp::start(vec![StubResponse::json(200, upstream_body())]).await;
    let Some(fixture) = setup(&upstream.base_url(), None).await else {
        return;
    };
    let app = build_app!(fixture.shared);

    let body = mint!(&app, fixture.tenant_a, &fixture.model_embed_name).await;
    let token = body["token"].as_str().expect("响应缺少 token").to_owned();

    // 请求体里换个模型：400，且一分钱都不出网
    let (status, response) = call!(
        &app,
        embeddings_request(&token, json!({ "model": "gpt-4o", "input": ["hi"] }),),
    )
    .await;
    assert_eq!(status, 400);
    assert_eq!(
        error_code(&response),
        request_codes::INVALID_PARAMETER_VALUE
    );
    assert!(upstream.requests().is_empty());

    // 写自己的模型名是合法的（不是「一律禁止 model 字段」）
    let (status, _) = call!(
        &app,
        embeddings_request(
            &token,
            json!({ "model": fixture.model_embed_name, "input": ["hi"] }),
        ),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(upstream.requests().len(), 1);
}

#[actix_web::test]
async fn model_gate_is_enforced_at_egress() {
    let _guard = DB_LOCK.lock().await;
    let upstream = StubHttp::start(vec![StubResponse::json(200, upstream_body())]).await;
    let Some(fixture) = setup(&upstream.base_url(), None).await else {
        return;
    };
    let app = build_app!(fixture.shared);

    // 没声明 embeddings 能力：令牌签得出来，但出站时被挡下（400，不触网）
    let body = mint!(&app, fixture.tenant_a, &fixture.model_plain_name).await;
    let token = body["token"].as_str().expect("响应缺少 token").to_owned();
    let (status, response) =
        call!(&app, embeddings_request(&token, json!({ "input": ["hi"] })),).await;
    assert_eq!(status, 400);
    assert_eq!(
        error_code(&response),
        request_codes::INVALID_PARAMETER_VALUE
    );

    // 模型压根不存在：404
    let body = mint!(&app, fixture.tenant_a, "no-such-model-at-all").await;
    let token = body["token"].as_str().expect("响应缺少 token").to_owned();
    let (status, response) =
        call!(&app, embeddings_request(&token, json!({ "input": ["hi"] })),).await;
    assert_eq!(status, 404);
    assert_eq!(error_code(&response), resource::NOT_FOUND);

    assert!(upstream.requests().is_empty());
}

#[actix_web::test]
async fn failed_egress_is_not_metered() {
    let _guard = DB_LOCK.lock().await;
    let upstream = StubHttp::start(vec![StubResponse::json(
        503,
        json!({ "error": { "message": "overloaded" } }),
    )])
    .await;
    let Some(fixture) = setup(&upstream.base_url(), None).await else {
        return;
    };
    let app = build_app!(fixture.shared);

    let body = mint!(&app, fixture.tenant_a, &fixture.model_embed_name).await;
    let token = body["token"].as_str().expect("响应缺少 token").to_owned();

    let (status, response) =
        call!(&app, embeddings_request(&token, json!({ "input": ["hi"] })),).await;
    assert_eq!(status, 502, "上游故障应答：{response}");
    assert_eq!(error_code(&response), external::THIRD_PARTY_API_ERROR);

    // 上游没成功就不该有用量、配额与审计——否则重试会把额度白吃掉
    let usage_rows = scalar(
        &fixture.admin,
        &format!(
            r#"SELECT count(*) FROM gateway_usage WHERE "tenantID" = '{}'"#,
            fixture.tenant_a
        ),
    )
    .await;
    assert_eq!(usage_rows, 0);

    let key = quota::quota_key("tenant", &fixture.tenant_a);
    assert_eq!(
        quota::used_tokens(&fixture.shared.redis, &key)
            .await
            .expect("读配额失败"),
        0
    );

    let audits = scalar(
        &fixture.admin,
        &format!(
            r#"SELECT count(*) FROM gateway_audit WHERE "tenantID" = '{}'"#,
            fixture.tenant_a
        ),
    )
    .await;
    assert_eq!(audits, 0);
}

#[actix_web::test]
async fn another_tenants_model_is_invisible() {
    let _guard = DB_LOCK.lock().await;
    let upstream = StubHttp::start(vec![StubResponse::json(200, upstream_body())]).await;
    let Some(fixture) = setup(&upstream.base_url(), None).await else {
        return;
    };
    let app = build_app!(fixture.shared);

    // 甲租户的令牌 + 乙租户的私有模型：签发段不拦（它只认租户），出站段必须 404
    let body = mint!(&app, fixture.tenant_a, &fixture.model_b_name).await;
    let token = body["token"].as_str().expect("响应缺少 token").to_owned();
    let (status, response) =
        call!(&app, embeddings_request(&token, json!({ "input": ["hi"] })),).await;
    assert_eq!(status, 404);
    assert_eq!(error_code(&response), resource::NOT_FOUND);
    assert!(upstream.requests().is_empty());

    // 反证：同一个令牌换成甲租户自己的模型就能出站，说明 404 来自作用域而不是别的
    let (status, _) = call!(
        &app,
        embeddings_request(
            &token_for_own_model!(&fixture, &app).await,
            json!({ "input": ["hi"] })
        ),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(upstream.requests().len(), 1);
}

#[actix_web::test]
async fn asset_token_reads_exactly_one_asset() {
    let _guard = DB_LOCK.lock().await;
    let upstream = StubHttp::start(vec![StubResponse::json(200, upstream_body())]).await;
    let Some(fixture) = setup(&upstream.base_url(), None).await else {
        return;
    };
    let app = build_app!(fixture.shared);

    let own = &fixture.assets.tenant_a;
    let own_id = own.id.to_string();
    let body = mint_asset_token!(&app, fixture.tenant_a, &own_id).await;

    // 令牌把作用域交回调用方（ai-worker 不必自己拼资产 id），且不夹带嵌入才需要的模型
    assert_eq!(body["tokenType"], json!("service"));
    assert_eq!(body["scope"], json!("asset-read"));
    assert_eq!(body["assetID"], json!(own_id));
    assert_eq!(body["tenantID"], json!(fixture.tenant_a.to_string()));
    assert!(body.get("model").is_none(), "读取令牌不该带 model");

    let claims = claims_of(&body, Audience::AssetContent);
    assert_eq!(claims.aud, service_token::AUDIENCE_ASSET_CONTENT);
    assert_eq!(claims.asset_id.as_deref(), Some(own_id.as_str()));
    assert!(claims.model.is_none());

    // 读出来的必须是上传那份字节：分片顺序、拼接口径、`content-length` 三者一起验
    let token = token_of(&body);
    let (status, headers, bytes) = call_raw!(&app, asset_content_request(&own_id, &token)).await;
    assert_eq!(status, 200, "读内容失败");
    assert_eq!(
        headers
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some("text/plain")
    );
    assert_eq!(
        headers
            .get(CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok()),
        Some(own.content.len().to_string().as_str())
    );
    assert_eq!(
        String::from_utf8_lossy(&bytes).as_ref(),
        own.content.as_str()
    );

    // 路径里的资产只用于**比对**：换成别人的资产是 403，而不是「换个人来读」
    let other_id = fixture.assets.tenant_b.id.to_string();
    let (status, response) = call!(&app, asset_content_request(&other_id, &token)).await;
    assert_eq!(status, 403);
    assert_eq!(error_code(&response), resource::ACCESS_RESTRICTED);

    // 也不能靠签发去够别人的资产：甲租户签乙租户的资产 → 404，连存在性都不外泄
    let (status, response) = call!(
        &app,
        asset_token_request(fixture.tenant_a, "asset-read", &other_id),
    )
    .await;
    assert_eq!(status, 404);
    assert_eq!(error_code(&response), business::upload::FILE_NOT_FOUND);

    // 反证：乙租户拿自己的令牌读自己的资产是 200——上一条 404 来自作用域，不是资产读不出
    let other_token = token_of(&mint_asset_token!(&app, fixture.tenant_b, &other_id).await);
    let (status, _, bytes) = call_raw!(&app, asset_content_request(&other_id, &other_token)).await;
    assert_eq!(status, 200);
    assert_eq!(
        String::from_utf8_lossy(&bytes).as_ref(),
        fixture.assets.tenant_b.content.as_str()
    );

    // 没传完的资产签不出读取令牌——否则等于把「续传别人的上传会话」的入口递出去
    let pending_id = fixture.assets.pending.id.to_string();
    let (status, response) = call!(
        &app,
        asset_token_request(fixture.tenant_a, "asset-read", &pending_id),
    )
    .await;
    assert_eq!(status, 400);
    assert_eq!(
        error_code(&response),
        request_codes::INVALID_PARAMETER_VALUE
    );

    assert!(upstream.requests().is_empty(), "这条面孔不该触网");
}

#[actix_web::test]
async fn chat_forwards_and_meters() {
    let _guard = DB_LOCK.lock().await;
    let upstream = StubHttp::start(vec![StubResponse::json(200, upstream_chat_body())]).await;
    let Some(fixture) = setup(&upstream.base_url(), None).await else {
        return;
    };
    let app = build_app!(fixture.shared);

    let body = mint_chat_token!(&app, fixture.tenant_a, &fixture.model_plain_name).await;
    assert_eq!(body["scope"], json!("chat"));
    assert_eq!(body["model"], json!(fixture.model_plain_name));
    assert!(body.get("assetID").is_none(), "对话令牌不该带 assetID");
    // 作用域写进了签名：按对话受众验签能过，且只带模型不带资产
    let claims = claims_of(&body, Audience::Chat);
    assert_eq!(claims.aud, service_token::AUDIENCE_CHAT);
    assert_eq!(
        claims.model.as_deref(),
        Some(fixture.model_plain_name.as_str())
    );
    assert!(claims.asset_id.is_none());
    let token = token_of(&body);

    let (status, response_body) = call!(
        &app,
        chat_request(
            &token,
            json!({
                "model": fixture.model_plain_name,
                "messages": [{ "role": "user", "content": "ping" }],
                "stream": true,
            }),
        ),
    )
    .await;
    assert_eq!(status, 200, "对话转发失败：{response_body}");
    // 上游 JSON 原样返回（裸结构，不套信封）
    assert_eq!(
        response_body["choices"][0]["message"]["content"],
        json!("pong")
    );

    let request = upstream.only();
    assert_eq!(request.method, "POST");
    assert_eq!(request.path, "/chat/completions");
    let sent = request.json();
    // 模型来自令牌作用域，`messages` 由调用方透传
    assert_eq!(sent["model"], json!(fixture.model_plain_name));
    assert_eq!(sent["messages"][0]["content"], json!("ping"));
    // 服务面一律非流式：调用方就算写了 `stream: true` 也会被按下去
    assert_eq!(sent["stream"], json!(false));
    assert!(request.header("authorization").is_none());

    // 与用户面同一套记账：用量行、日窗配额、审计三件套
    let usage_rows = scalar(
        &fixture.admin,
        &format!(
            r#"SELECT count(*) FROM gateway_usage
               WHERE "tenantID" = '{}' AND "modelID" = '{}' AND "providerID" = '{}'"#,
            fixture.tenant_a, fixture.model_plain, fixture.provider_a
        ),
    )
    .await;
    assert_eq!(usage_rows, 1);

    let tokens = scalar(
        &fixture.admin,
        &format!(
            r#"SELECT coalesce(sum("totalTokens"), 0)::bigint FROM gateway_usage WHERE "tenantID" = '{}'"#,
            fixture.tenant_a
        ),
    )
    .await;
    assert_eq!(tokens, TOTAL_TOKENS);

    let key = quota::quota_key("tenant", &fixture.tenant_a);
    assert_eq!(
        quota::used_tokens(&fixture.shared.redis, &key)
            .await
            .expect("读配额失败"),
        TOTAL_TOKENS,
        "服务调用的用量必须计入同一个日窗配额"
    );

    let audits = scalar(
        &fixture.admin,
        &format!(
            r#"SELECT count(*) FROM gateway_audit
               WHERE action = 'gateway.chat' AND actor = '{SERVICE_ACTOR_ID}'
                 AND "tenantID" = '{}'"#,
            fixture.tenant_a
        ),
    )
    .await;
    assert_eq!(audits, 1);
}

#[actix_web::test]
async fn chat_token_scope_and_capability_are_enforced_at_egress() {
    let _guard = DB_LOCK.lock().await;
    let upstream = StubHttp::start(vec![StubResponse::json(200, upstream_chat_body())]).await;
    let Some(fixture) = setup(&upstream.base_url(), None).await else {
        return;
    };
    let app = build_app!(fixture.shared);

    // 请求体换个模型：400，一分钱都不出网（真正生效的模型只在令牌里）
    let token =
        token_of(&mint_chat_token!(&app, fixture.tenant_a, &fixture.model_plain_name).await);
    let (status, response) = call!(
        &app,
        chat_request(
            &token,
            json!({
                "model": "gpt-4o",
                "messages": [{ "role": "user", "content": "ping" }],
            }),
        ),
    )
    .await;
    assert_eq!(status, 400);
    assert_eq!(
        error_code(&response),
        request_codes::INVALID_PARAMETER_VALUE
    );
    assert!(upstream.requests().is_empty());

    // 显式声明 `tools: false` 的模型：令牌签得出来，出站时被挡下（400，不触网）——
    // 对话面的能力闸门口径与嵌入面相反：未声明按支持处理，只有显式否认才拒
    let token =
        token_of(&mint_chat_token!(&app, fixture.tenant_a, &fixture.model_notools_name).await);
    let (status, response) = call!(
        &app,
        chat_request(
            &token,
            json!({
                "model": fixture.model_notools_name,
                "messages": [{ "role": "user", "content": "ping" }],
            }),
        ),
    )
    .await;
    assert_eq!(status, 400);
    assert_eq!(
        error_code(&response),
        request_codes::INVALID_PARAMETER_VALUE
    );
    assert!(upstream.requests().is_empty());

    // 未声明 `tools` 的模型照样放行（默认支持工具，否则每个部署都得先补全整张模型表）
    let token =
        token_of(&mint_chat_token!(&app, fixture.tenant_a, &fixture.model_plain_name).await);
    let (status, _) = call!(
        &app,
        chat_request(
            &token,
            json!({
                "model": fixture.model_plain_name,
                "messages": [{ "role": "user", "content": "ping" }],
            }),
        ),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(upstream.requests().len(), 1);

    // 别租户的模型名换成同租户令牌也一样取不到：对话面并没有因为「服务身份」就跨出租户作用域
    let token = token_of(&mint_chat_token!(&app, fixture.tenant_a, &fixture.model_b_name).await);
    let (status, body) = call!(
        &app,
        chat_request(
            &token,
            json!({
                "model": fixture.model_b_name,
                "messages": [{ "role": "user", "content": "ping" }],
            }),
        ),
    )
    .await;
    assert_eq!(status, 404);
    assert_eq!(error_code(&body), resource::NOT_FOUND);
}

#[actix_web::test]
async fn chat_token_cannot_cross_audiences() {
    let _guard = DB_LOCK.lock().await;
    let upstream = StubHttp::start(vec![StubResponse::json(200, upstream_chat_body())]).await;
    let Some(fixture) = setup(&upstream.base_url(), None).await else {
        return;
    };
    let app = build_app!(fixture.shared);

    let chat_payload = json!({
        "model": fixture.model_plain_name,
        "messages": [{ "role": "user", "content": "ping" }],
    });

    // 嵌入令牌打对话端点：401（受众写死在端点里，令牌自己说了不算）
    let embed_token = token_of(&mint!(&app, fixture.tenant_a, &fixture.model_embed_name).await);
    let (status, body) = call!(&app, chat_request(&embed_token, chat_payload.clone())).await;
    assert_eq!(status, 401);
    assert_eq!(error_code(&body), auth::INVALID_CREDENTIALS);

    // 反过来：对话令牌打嵌入端点同样 401
    let chat_token =
        token_of(&mint_chat_token!(&app, fixture.tenant_a, &fixture.model_plain_name).await);
    let (status, body) = call!(
        &app,
        embeddings_request(&chat_token, json!({ "input": ["hi"] })),
    )
    .await;
    assert_eq!(status, 401);
    assert_eq!(error_code(&body), auth::INVALID_CREDENTIALS);

    // 读取令牌打对话端点也不行——三件受众两两不通
    let asset_id = fixture.assets.tenant_a.id.to_string();
    let asset_token = token_of(&mint_asset_token!(&app, fixture.tenant_a, &asset_id).await);
    let (status, body) = call!(&app, chat_request(&asset_token, chat_payload.clone())).await;
    assert_eq!(status, 401);
    assert_eq!(error_code(&body), auth::INVALID_CREDENTIALS);

    // 伪造签名 / 形状不对 / 干脆不带：一样拒
    let tenant_id = fixture.tenant_a.to_string();
    let (forged, _) = service_token::mint(
        OTHER_SECRET,
        Scope::Chat {
            tenant_id: &tenant_id,
            model: &fixture.model_plain_name,
        },
        300,
    )
    .unwrap();
    for token in [forged.as_str(), "not-a-jwt", ""] {
        let (status, body) = call!(&app, chat_request(token, chat_payload.clone())).await;
        assert_eq!(status, 401, "令牌 {token:?} 不该被接受");
        assert_eq!(error_code(&body), auth::INVALID_CREDENTIALS);
    }

    assert!(upstream.requests().is_empty(), "这条面孔不该触网");
}

#[actix_web::test]
async fn asset_read_token_cannot_cross_audiences() {
    let _guard = DB_LOCK.lock().await;
    let upstream = StubHttp::start(vec![StubResponse::json(200, upstream_body())]).await;
    let Some(fixture) = setup(&upstream.base_url(), None).await else {
        return;
    };
    let app = build_app!(fixture.shared);

    let asset_id = fixture.assets.tenant_a.id.to_string();
    let tenant_id = fixture.tenant_a.to_string();

    // 嵌入令牌打内容端点：401（受众写死在端点里，令牌自己说了不算）
    let embed_token = token_of(&mint!(&app, fixture.tenant_a, &fixture.model_embed_name).await);
    let (status, body) = call!(&app, asset_content_request(&asset_id, &embed_token)).await;
    assert_eq!(status, 401);
    assert_eq!(error_code(&body), auth::INVALID_CREDENTIALS);

    // 反过来：读取令牌打嵌入端点同样 401，而且一分钱都不出网
    let asset_token = token_of(&mint_asset_token!(&app, fixture.tenant_a, &asset_id).await);
    let (status, body) = call!(
        &app,
        embeddings_request(&asset_token, json!({ "input": ["hi"] })),
    )
    .await;
    assert_eq!(status, 401);
    assert_eq!(error_code(&body), auth::INVALID_CREDENTIALS);

    // 伪造签名 / 形状不对 / 干脆不带：内容端点一样拒
    let (forged, _) = service_token::mint(
        OTHER_SECRET,
        Scope::AssetContent {
            tenant_id: &tenant_id,
            asset_id: &asset_id,
        },
        300,
    )
    .unwrap();
    for token in [forged.as_str(), "not-a-jwt", ""] {
        let (status, body) = call!(&app, asset_content_request(&asset_id, token)).await;
        assert_eq!(status, 401, "令牌 {token:?} 不该被接受");
        assert_eq!(error_code(&body), auth::INVALID_CREDENTIALS);
    }

    // 过期令牌：最短 1 秒有效期，等它过期。
    // 等一下的时长不是随手写的：`jsonwebtoken` 默认容差 60 秒（故 `verify` 里 leeway=0），
    // 且 `exp` 是秒级整数、判定式是 `exp < now`。要跨越「签发在下半秒、验签在整秒边界」的
    // 最坏情况，就得让验签时刻至少比签发时刻的整秒大 2 秒。
    let (expiring, _) = service_token::mint(
        SERVICE_SECRET,
        Scope::AssetContent {
            tenant_id: &tenant_id,
            asset_id: &asset_id,
        },
        1,
    )
    .unwrap();
    tokio::time::sleep(Duration::from_millis(2_200)).await;
    let (status, body) = call!(&app, asset_content_request(&asset_id, &expiring)).await;
    assert_eq!(status, 401);
    assert_eq!(error_code(&body), auth::INVALID_CREDENTIALS);

    assert!(upstream.requests().is_empty());
}

#[actix_web::test]
async fn asset_token_issuance_validates_scope() {
    let _guard = DB_LOCK.lock().await;
    let upstream = StubHttp::start(vec![StubResponse::json(200, upstream_body())]).await;
    let Some(fixture) = setup(&upstream.base_url(), None).await else {
        return;
    };
    let app = build_app!(fixture.shared);

    let asset_id = fixture.assets.tenant_a.id.to_string();

    // 不写 scope 就还是嵌入（默认值唯一），且不会因为请求体多带 assetID 就变成读取令牌
    let (status, body) = call!(
        &app,
        test::TestRequest::post()
            .uri(paths::SERVICE_TOKEN)
            .insert_header((INTERNAL_TOKEN_HEADER, INTERNAL_TOKEN))
            .set_json(json!({
                "tenantID": fixture.tenant_a.to_string(),
                "model": fixture.model_embed_name,
                "assetID": asset_id,
            })),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(body["scope"], json!("embeddings"));
    assert!(body.get("assetID").is_none(), "嵌入令牌不该带 assetID");

    // 未知 scope：400（宁可拒了也不猜调用方想要什么；asset-write 已是真受众，拿 asset-delete 当反例）
    let (status, body) = call!(
        &app,
        asset_token_request(fixture.tenant_a, "asset-delete", &asset_id),
    )
    .await;
    assert_eq!(status, 400);
    assert_eq!(error_code(&body), request_codes::INVALID_PARAMETER_VALUE);

    // asset-read 不带 assetID / 带空白：400——没有资产的读取令牌没有意义
    for missing in [Value::Null, json!("  ")] {
        let mut payload = json!({
            "tenantID": fixture.tenant_a.to_string(),
            "scope": "asset-read",
        });
        if !missing.is_null() {
            payload["assetID"] = missing.clone();
        }
        let (status, body) = call!(
            &app,
            test::TestRequest::post()
                .uri(paths::SERVICE_TOKEN)
                .insert_header((INTERNAL_TOKEN_HEADER, INTERNAL_TOKEN))
                .set_json(&payload),
        )
        .await;
        assert_eq!(status, 400, "payload {payload} 不该通过");
        assert_eq!(error_code(&body), request_codes::INVALID_PARAMETER_VALUE);
    }

    // assetID 不是 UUID：400，且不能落到「查不到」的 404 上
    let (status, body) = call!(
        &app,
        asset_token_request(fixture.tenant_a, "asset-read", "not-a-uuid"),
    )
    .await;
    assert_eq!(status, 400);
    assert_eq!(error_code(&body), request_codes::INVALID_PARAMETER_VALUE);

    // 资产不存在：404（与读内容同一个口径：FILE_NOT_FOUND）
    let (status, body) = call!(
        &app,
        asset_token_request(fixture.tenant_a, "asset-read", &Uuid::new_v4().to_string(),),
    )
    .await;
    assert_eq!(status, 404);
    assert_eq!(error_code(&body), business::upload::FILE_NOT_FOUND);

    // 读取令牌同样认租户：未知租户 404
    let (status, _) = call!(
        &app,
        asset_token_request(Uuid::new_v4(), "asset-read", &asset_id),
    )
    .await;
    assert_eq!(status, 404);

    assert!(upstream.requests().is_empty());
}

/// 写令牌的整条链：审批原文 → 签发时回读定稿 → 写端点落地。
///
/// 这条路径上「谁说了算」只有一处：**人批过的那张单子**。所以要验的不只是写成功，而是
/// 写进去的字面量确实出自那张单子、落地确实落在批准人头上、以及令牌越界用不动。
#[actix_web::test]
async fn approved_visibility_write_lands_as_approver() {
    let _guard = DB_LOCK.lock().await;
    let upstream = StubHttp::start(vec![StubResponse::json(200, upstream_body())]).await;
    let Some(fixture) = setup(&upstream.base_url(), None).await else {
        return;
    };
    let app = build_app!(fixture.shared);

    let tenant = fixture.tenant_a;
    let tenant_id = tenant.to_string();
    let owner = seed_user(&fixture, "owner").await;
    let owner_id = owner.to_string();
    let viewer = seed_user(&fixture, "viewer").await;
    let asset = seed_owned_asset(&fixture, tenant, owner).await;
    let asset_id = asset.to_string();

    // 人批的是「只给这两个人看」；名单里带着创建者本人，是因为他也要能读回自己刚改过的东西
    let arguments = json!({
        "assetID": asset_id,
        "visibility": "RESTRICTED",
        "viewers": [viewer.to_string(), owner_id],
    });
    let approval = seed_approval(
        &fixture,
        tenant,
        owner,
        "APPROVED",
        Some(owner),
        &arguments.to_string(),
    )
    .await;

    let body = mint_write_token!(&app, tenant, &asset_id, &approval).await;
    assert_eq!(body["scope"], json!("asset-write"));
    assert_eq!(body["assetID"], json!(asset_id));
    assert_eq!(body["approvalID"], json!(approval));
    assert!(body.get("model").is_none(), "写令牌没有模型这一说");

    // 响应的字段不算数，令牌里的作用域才算数：按该受众验签一遍，看审批原文有没有真被钉进去
    let grant = claims_of(&body, Audience::AssetVisibility)
        .approval
        .expect("写令牌必须带审批凭据");
    assert_eq!(grant.approval_id, approval);
    assert_eq!(grant.actor_id, owner_id);
    assert_eq!(grant.visibility, "RESTRICTED");
    assert_eq!(
        grant.viewers,
        vec![viewer.to_string(), owner_id.clone()],
        "名单以审批原文为准，顺序不变"
    );

    // 换令牌读的是自己的台账，不出网
    assert!(upstream.requests().is_empty());

    let token = token_of(&body);
    let (status, written) = call!(&app, asset_visibility_request(&asset_id, &token)).await;
    assert_eq!(status, 200, "写入失败：{written}");
    assert_eq!(written["id"], json!(asset_id));
    assert_eq!(written["visibility"], json!("RESTRICTED"));
    assert_eq!(
        written["viewers"],
        json!([viewer.to_string(), owner_id.clone()])
    );

    // 库里的真行才算数：可见性、名单、以及「是谁改的」
    assert_eq!(
        visibility_of(&fixture.admin, asset).await,
        format!("RESTRICTED|{owner_id}|{owner_id}")
    );
    assert_eq!(
        viewers_of(&fixture.admin, asset).await,
        json!([viewer.to_string(), owner_id.clone()])
    );

    // 写令牌是「能力」不是「一次性凭据」：没人能回收它，只能靠短有效期兜着
    let (status, _) = call!(&app, asset_visibility_request(&asset_id, &token)).await;
    assert_eq!(status, 200, "同一枚写令牌重放应当仍然生效");

    // 但能力只覆盖那一个资产：拿它去打另一个资产，什么都不写
    let other = seed_owned_asset(&fixture, tenant, owner).await;
    let (status, body) = call!(&app, asset_visibility_request(&other.to_string(), &token),).await;
    assert_eq!(status, 403);
    assert_eq!(error_code(&body), resource::ACCESS_RESTRICTED);
    assert_eq!(
        visibility_of(&fixture.admin, other).await,
        format!("PRIVATE|{owner_id}|-"),
        "越界的那一下不能留下任何痕迹"
    );

    // 受众是硬边界：写令牌读不了内容，读令牌也写不动
    let (status, body) = call!(&app, asset_content_request(&asset_id, &token)).await;
    assert_eq!(status, 401);
    assert_eq!(error_code(&body), auth::INVALID_CREDENTIALS);
    let read_token = token_of(&mint_asset_token!(&app, tenant, &asset_id).await);
    let (status, body) = call!(&app, asset_visibility_request(&asset_id, &read_token)).await;
    assert_eq!(status, 401);
    assert_eq!(error_code(&body), auth::INVALID_CREDENTIALS);

    // 签名对不上 / 形状不对 / 干脆不带：这里连审批都不必读，先过令牌这一关
    let (forged, _) = service_token::mint(
        OTHER_SECRET,
        Scope::AssetVisibility {
            tenant_id: &tenant_id,
            asset_id: &asset_id,
            approval_id: &approval,
            actor_id: &owner_id,
            visibility: "RESTRICTED",
            viewers: &[viewer.to_string()],
        },
        300,
    )
    .unwrap();
    for token in [forged.as_str(), "not-a-jwt", ""] {
        let (status, body) = call!(&app, asset_visibility_request(&asset_id, token)).await;
        assert_eq!(status, 401, "令牌 {token:?} 不该被接受");
        assert_eq!(error_code(&body), auth::INVALID_CREDENTIALS);
    }

    // 第二条链：这次批的是 PRIVATE，名单必须被清干净。
    // 留着旧名单的话，下次有人把它改回 RESTRICTED 就会悄悄沿用上一批人。
    let arguments = json!({ "assetID": asset_id, "visibility": "PRIVATE" });
    let approval = seed_approval(
        &fixture,
        tenant,
        owner,
        "APPROVED",
        Some(owner),
        &arguments.to_string(),
    )
    .await;
    let token = token_of(&mint_write_token!(&app, tenant, &asset_id, &approval).await);
    let (status, written) = call!(&app, asset_visibility_request(&asset_id, &token)).await;
    assert_eq!(status, 200, "写入失败：{written}");
    assert_eq!(written["visibility"], json!("PRIVATE"));
    assert_eq!(written["viewers"], json!([]), "非 RESTRICTED 不该回名单");
    assert_eq!(viewers_of(&fixture.admin, asset).await, Value::Null);
    assert_eq!(
        visibility_of(&fixture.admin, asset).await,
        format!("PRIVATE|{owner_id}|{owner_id}")
    );

    assert!(upstream.requests().is_empty());
}

/// 单子不对就不签：审批台账里的每一种「不该签」的样子都试一遍。
///
/// 全部落在同一个业务码上（500509，HTTP 403），消息也不区分原因——外人在能拿到码之前
/// 不该从响应里看出「这条审批存在吗 / 被谁批的 / 批的是什么」。
#[actix_web::test]
async fn visibility_write_requires_a_valid_approval() {
    let _guard = DB_LOCK.lock().await;
    let upstream = StubHttp::start(vec![StubResponse::json(200, upstream_body())]).await;
    let Some(fixture) = setup(&upstream.base_url(), None).await else {
        return;
    };
    let app = build_app!(fixture.shared);

    let tenant = fixture.tenant_a;
    let owner = seed_user(&fixture, "owner").await;
    let stranger = seed_user(&fixture, "stranger").await;
    let viewer = seed_user(&fixture, "viewer").await;
    let asset = seed_owned_asset(&fixture, tenant, owner).await;
    let asset_id = asset.to_string();
    let other = seed_owned_asset(&fixture, tenant, owner).await.to_string();

    let approved = json!({
        "assetID": asset_id,
        "visibility": "RESTRICTED",
        "viewers": [viewer.to_string()],
    })
    .to_string();

    // 台账里那一行长什么样，直接决定签不签得出来
    let cases = [
        ("审批还在等人批", "PENDING", Some(owner), approved.clone()),
        ("审批被人驳回了", "REJECTED", Some(owner), approved.clone()),
        ("没记是谁批的", "APPROVED", None, approved.clone()),
        (
            "参数原文不是 JSON",
            "APPROVED",
            Some(owner),
            "就是一段普通文字".to_owned(),
        ),
        (
            "参数里有工具不认识的字段",
            "APPROVED",
            Some(owner),
            json!({ "assetID": asset_id, "visibility": "PUBLIC", "extra": 1 }).to_string(),
        ),
        (
            "批的是另一个资产",
            "APPROVED",
            Some(owner),
            json!({ "assetID": other, "visibility": "PUBLIC" }).to_string(),
        ),
        (
            "可见性字面量不认识",
            "APPROVED",
            Some(owner),
            json!({ "assetID": asset_id, "visibility": "SECRET" }).to_string(),
        ),
        (
            "非 RESTRICTED 却带着名单",
            "APPROVED",
            Some(owner),
            json!({
                "assetID": asset_id,
                "visibility": "PUBLIC",
                "viewers": [viewer.to_string()],
            })
            .to_string(),
        ),
        (
            "名单里不是用户 id",
            "APPROVED",
            Some(owner),
            json!({ "assetID": asset_id, "visibility": "RESTRICTED", "viewers": ["who?"] })
                .to_string(),
        ),
        (
            "名单里是空白",
            "APPROVED",
            Some(owner),
            json!({ "assetID": asset_id, "visibility": "RESTRICTED", "viewers": ["  "] })
                .to_string(),
        ),
        (
            "批准人另有其人",
            "APPROVED",
            Some(stranger),
            approved.clone(),
        ),
    ];

    for (name, state, decider, arguments) in cases {
        let approval =
            seed_approval(&fixture, tenant, owner, state, decider, arguments.as_str()).await;
        let (status, body) = call!(&app, asset_write_request(tenant, &asset_id, &approval)).await;
        assert_eq!(status, 403, "{name}：不该签出写令牌（{body}）");
        assert_eq!(
            error_code(&body),
            business::agent::APPROVAL_INVALID,
            "{name}"
        );
    }

    // 台账里根本没有这条（审批号连形状都不对也一样）：照 403 回，不回答存在性
    for approval in [
        Uuid::new_v4().to_string(),
        format!("{}:0:0", Uuid::new_v4()),
        "not-an-approval".to_owned(),
    ] {
        let (status, body) = call!(&app, asset_write_request(tenant, &asset_id, &approval)).await;
        assert_eq!(status, 403, "审批 {approval} 不该签出写令牌");
        assert_eq!(error_code(&body), business::agent::APPROVAL_INVALID);
    }

    // 别的租户的单子：租户作用域下读不到，等于没批过（同上，不泄露别人的台账）
    let foreign = seed_approval(
        &fixture,
        fixture.tenant_b,
        owner,
        "APPROVED",
        Some(owner),
        &approved,
    )
    .await;
    let (status, body) = call!(&app, asset_write_request(tenant, &asset_id, &foreign)).await;
    assert_eq!(status, 403, "跨租户的审批不该签出写令牌");
    assert_eq!(error_code(&body), business::agent::APPROVAL_INVALID);

    // 单子合规但资产不存在：404，与「读不到这个资产」同一个口径
    let ghost = Uuid::new_v4().to_string();
    let arguments = json!({ "assetID": ghost, "visibility": "PUBLIC" }).to_string();
    let approval =
        seed_approval(&fixture, tenant, owner, "APPROVED", Some(owner), &arguments).await;
    let (status, body) = call!(&app, asset_write_request(tenant, &ghost, &approval)).await;
    assert_eq!(status, 404);
    assert_eq!(error_code(&body), business::upload::FILE_NOT_FOUND);

    // 请求体少字段是「调用方自己写错了」：400，还没轮到查台账
    for payload in [
        json!({ "tenantID": tenant.to_string(), "scope": "asset-write", "assetID": asset_id }),
        json!({ "tenantID": tenant.to_string(), "scope": "asset-write", "approvalID": "a:0:0" }),
        json!({
            "tenantID": tenant.to_string(),
            "scope": "asset-write",
            "assetID": asset_id,
            "approvalID": "  ",
        }),
    ] {
        let (status, body) = call!(
            &app,
            test::TestRequest::post()
                .uri(paths::SERVICE_TOKEN)
                .insert_header((INTERNAL_TOKEN_HEADER, INTERNAL_TOKEN))
                .set_json(&payload),
        )
        .await;
        assert_eq!(status, 400, "payload {payload} 不该通过");
        assert_eq!(error_code(&body), request_codes::INVALID_PARAMETER_VALUE);
    }

    // 折腾了一圈，这个资产必须一个字都没变
    assert_eq!(
        visibility_of(&fixture.admin, asset).await,
        format!("PRIVATE|{owner}|-"),
        "没有任何一条负例该写进库里"
    );
    assert!(upstream.requests().is_empty());
}
