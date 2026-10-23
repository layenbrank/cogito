//! 资产（asset）的作用域端到端验证（P3e-1）。
//!
//! 需要独立测试库（库名必须含 `test`，避免误伤开发库）：
//!
//! ```text
//! TEST_DATABASE_URL=******127.0.0.1:5432/cogito_service_test cargo test --test asset_scope
//! ```
//!
//! 未设置 `TEST_DATABASE_URL` 时整体跳过。
//!
//! 资产是**内容寻址**的资源：同一份字节会被多个账号各自持有一行（跨账号秒传克隆），
//! 所以它的行级策略比别的表多。断言按策略的可见分支 + 写入约束铺开：
//!
//! 1. `PUBLIC` 对匿名可读——公开分发链接唯一依赖的分支；
//! 2. `creator` 分支：本人看得见自己的行（上传会话、我的文件、下载自己的文件）；
//! 3. `RESTRICTED` 的 `viewers` 分支：只放行被点名的账号；
//! 4. `tenantID` 分支：进租户作用域才生效，账号作用域下这一列只是标签；
//! 5. hash 能力键分支：无身份地跨账号借同一份内容，且只借**已完成**的那一行；
//! 6. `WITH CHECK` 只认创建者：既写不了别人的行，也没法靠 `PUBLIC` 绕过去。
//!
//! 注意 `PUBLIC` 是**全局**分支：它在任何作用域里都成立，包括只拿 hash 的能力键作用域。
//! 公开行本就能匿名读，所以借内容时多看得到几行不构成额外暴露，但断言必须按
//! 「能力键是否命中」而不是「整体集合」来写。
//!
//! 下载路径的断言落在 `UploadService::find_owned_asset` 上：**看不到就是 404**，
//! 看得到但没权限才是 403（旧实现里「他人的 PRIVATE 资产」报 403，泄露了存在性）。
//!
//! 用例跑在非属主角色 `cogito_app_test` 上：属主会绕过策略，那样测不出东西。

use std::sync::LazyLock;
use std::time::Duration;

use entity::asset;
use identity::{TenantId, UserId};
use migration::MigratorTrait;
use sea_orm::{
    ConnectOptions, ConnectionTrait, Database, DatabaseBackend, DatabaseConnection,
    DatabaseTransaction, EntityTrait,
};
use cogito::databases::database::Storage;
use cogito::guards::account::AccountScope;
use cogito::guards::asset::{AssetContentScope, AssetReader};
use cogito::guards::session::Session;
use cogito::guards::tenant::TenantCtx;
use cogito::services::upload::error::UploadError;
use cogito::services::upload::service::UploadService;
use cogito::utils::db::is_row_security_violation;
use cogito::utils::jwt::Claims;
use tokio::sync::Mutex;
use uuid::Uuid;

/// 隔离断言必须运行在非属主角色下：表属主默认绕过策略（迁移已 FORCE）。
const APP_ROLE: &str = "cogito_app_test";

/// 远超测试生命周期的过期时间（2100-01-01），避免用例受系统时钟影响。
const FAR_FUTURE_EXP: i64 = 4_102_444_800;

/// 每个用例都要 `fresh` 整个库，因此必须串行。
static DB_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// 造一个合法 hash：能力键只能由 64 位十六进制字符设进会话变量。
fn hash(seed: &str) -> String {
    seed.repeat(64)
}

struct Fixture {
    /// 超级用户连接：种数据，并按「不受作用域限制」的口径核对真实行。
    admin: DatabaseConnection,
    /// 应用连接（非属主角色）：服务层唯一的数据入口。
    storage: Storage,
    tenant: Uuid,
    /// 租户 Owner，也是公开 / 私有 / 秒传三类资产的创建者。
    owner: UserId,
    /// 与 owner 没有任何关系的第三方账号。
    outsider: UserId,
    /// `RESTRICTED` 资产白名单里被点名的账号。
    viewer: UserId,
    /// `PUBLIC`，创建者是 `owner`。
    asset_public: Uuid,
    /// `PRIVATE`，创建者是 `owner`。
    asset_private: Uuid,
    /// `RESTRICTED`，创建者是 `outsider`，`viewers` 里只有 `viewer`。
    asset_restricted: Uuid,
    /// 带 `"tenantID"` 的资产，创建者是 `viewer`。
    asset_tenant: Uuid,
    /// 秒传源：`COMPLETED`，与下面那条共用一个 hash。
    asset_shared: Uuid,
    /// 未完成会话：同一个 hash，但 `UPLOADING`，不给借。
    asset_pending: Uuid,
}

/// 读取测试库地址；未配置或库名不合法时返回 `None`（调用方直接跳过）。
fn test_database_url() -> Option<String> {
    let uri = std::env::var("TEST_DATABASE_URL").ok()?;
    let uri = uri.trim().to_owned();
    if uri.is_empty() {
        return None;
    }
    let database = database_of(&uri);
    assert!(
        database.contains("test"),
        "TEST_DATABASE_URL 指向的库名必须含 `test`（当前：{database}）：用例会重建库"
    );
    Some(uri)
}

fn database_of(uri: &str) -> String {
    let tail = uri.rsplit('/').next().unwrap_or_default();

    tail.split('?').next().unwrap_or_default().to_owned()
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

async fn count<C: ConnectionTrait>(conn: &C, sql: &str) -> i64 {
    conn.query_one_raw(sea_orm::Statement::from_string(
        DatabaseBackend::Postgres,
        sql.to_owned(),
    ))
    .await
    .unwrap_or_else(|err| panic!("查询失败：{sql}\n{err}"))
    .unwrap_or_else(|| panic!("查询没有返回结果：{sql}"))
    .try_get_by_index::<i64>(0)
    .expect("结果不是 bigint")
}

/// 重建库、建应用角色、授权、种三类账号与六条资产；锁未持有时不得调用。
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

    let fixture = Fixture {
        admin,
        storage: Storage::from_parts(connect(&app_uri(&uri), 2).await, database_of(&uri)),
        tenant: Uuid::new_v4(),
        owner: UserId::generate(),
        outsider: UserId::generate(),
        viewer: UserId::generate(),
        asset_public: Uuid::new_v4(),
        asset_private: Uuid::new_v4(),
        asset_restricted: Uuid::new_v4(),
        asset_tenant: Uuid::new_v4(),
        asset_shared: Uuid::new_v4(),
        asset_pending: Uuid::new_v4(),
    };
    seed(&fixture).await;
    Some(fixture)
}

/// 三个账号：租户 Owner、无关第三方、白名单成员；六条资产覆盖策略的每条分支。
async fn seed(fixture: &Fixture) {
    let suffix = Uuid::new_v4().simple().to_string();
    let suffix = &suffix[..8];
    let admin = &fixture.admin;

    for (tag, user) in [
        ("owner", fixture.owner),
        ("outsider", fixture.outsider),
        ("viewer", fixture.viewer),
    ] {
        exec(
            admin,
            &format!(
                r#"INSERT INTO auth (id, username, password, role, status, "createdAt", "updatedAt")
                   VALUES ('{user}', 'asset-{suffix}-{tag}', '!', 'USER', 'ACTIVE', now(), now())"#
            ),
        )
        .await;
    }

    exec(
        admin,
        &format!(
            r#"INSERT INTO tenant (id, name, slug, status, "type", "createdAt", "updatedAt")
               VALUES ('{}', 'Asset', 'asset-{suffix}', 'ACTIVE', 'PERSONAL', now(), now())"#,
            fixture.tenant
        ),
    )
    .await;
    exec(
        admin,
        &format!(
            r#"INSERT INTO tenant_member (id, "tenantID", "userID", role, status, "createdAt", "updatedAt")
               VALUES ('{}', '{}', '{}', 'OWNER', 'ACTIVE', now(), now())"#,
            Uuid::new_v4(),
            fixture.tenant,
            fixture.owner
        ),
    )
    .await;

    // `tenantID` 是 text 历史列型；`viewers` 是 uuid 字符串数组（jsonb）
    for (id, creator, tenant, hash, status, visibility, viewers) in [
        (
            fixture.asset_public,
            fixture.owner,
            None,
            hash("a"),
            "COMPLETED",
            "PUBLIC",
            None,
        ),
        (
            fixture.asset_private,
            fixture.owner,
            None,
            hash("b"),
            "COMPLETED",
            "PRIVATE",
            None,
        ),
        (
            fixture.asset_restricted,
            fixture.outsider,
            None,
            hash("d"),
            "COMPLETED",
            "RESTRICTED",
            Some(format!("[\"{}\"]", fixture.viewer)),
        ),
        (
            fixture.asset_tenant,
            fixture.viewer,
            Some(fixture.tenant),
            hash("e"),
            "COMPLETED",
            "PRIVATE",
            None,
        ),
        (
            fixture.asset_shared,
            fixture.owner,
            None,
            hash("f"),
            "COMPLETED",
            "PRIVATE",
            None,
        ),
        (
            fixture.asset_pending,
            fixture.owner,
            None,
            hash("f"),
            "UPLOADING",
            "PRIVATE",
            None,
        ),
    ] {
        let tenant = match tenant {
            Some(tenant) => format!("'{tenant}'"),
            None => "NULL".to_owned(),
        };
        let viewers = match viewers {
            Some(viewers) => format!("'{viewers}'"),
            None => "NULL".to_owned(),
        };
        exec(
            admin,
            &format!(
                r#"INSERT INTO asset
                       (id, hash, size, "index", mime, name, status, visibility, "viewers", chunk, total,
                        "tenantID", "creator", "createdAt", "updatedAt")
                   VALUES ('{id}', '{hash}', 16, 0, 'image/png', 'asset.png', '{status}', '{visibility}',
                        {viewers}, 1, 1, {tenant}, '{creator}', now(), now())"#
            ),
        )
        .await;
    }
}

/// 当前事务里看得见的资产 id（行级策略是唯一的过滤器），排序后便于整体比较。
async fn visible_ids(tx: &DatabaseTransaction) -> Vec<String> {
    let mut ids: Vec<String> = asset::Entity::find()
        .all(tx)
        .await
        .expect("列举可见资产失败")
        .iter()
        .map(|row| row.id.to_string())
        .collect();

    ids.sort();
    ids
}

/// 期望值：把若干资产 id 变成与 `visible_ids` 同口径的有序列表。
fn expected(assets: &[Uuid]) -> Vec<String> {
    let mut ids: Vec<String> = assets.iter().map(Uuid::to_string).collect();

    ids.sort();
    ids
}

async fn session_of(fixture: &Fixture, user: UserId) -> Session {
    let claims = Claims {
        sub: user.to_string(),
        username: "asset".to_owned(),
        role: "USER".to_owned(),
        exp: FAR_FUTURE_EXP,
        iat: FAR_FUTURE_EXP - 3600,
    };
    Session::resolve(&fixture.storage, &claims, &format!("asset-token-{user}"))
        .await
        .expect("建立会话失败")
}

async fn insert_asset(
    tx: &DatabaseTransaction,
    hash: &str,
    creator: UserId,
    visibility: &str,
) -> Result<sea_orm::ExecResult, sea_orm::DbErr> {
    tx.execute_unprepared(&format!(
        r#"INSERT INTO asset
               (id, hash, size, "index", mime, name, status, visibility, chunk, total,
                "creator", "createdAt", "updatedAt")
           VALUES ('{}', '{hash}', 16, 0, 'image/png', 'probe.png', 'COMPLETED', '{visibility}',
                1, 1, '{creator}', now(), now())"#,
        Uuid::new_v4()
    ))
    .await
}

/// 匿名只读通道只剩 `PUBLIC`：公开分发链接靠它工作，别的一律读不到。
#[tokio::test]
async fn anonymous_reader_only_sees_public_assets() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let reader = AssetReader::enter(&fixture.storage, None)
        .await
        .expect("进入匿名读作用域失败");
    assert_eq!(
        visible_ids(reader.tx()).await,
        expected(&[fixture.asset_public]),
        "匿名读只该看到 PUBLIC 行：私有 / 白名单 / 租户行都不能漏"
    );
    reader.rollback().await.expect("回滚读事务失败");
}

/// 账号作用域：看得见自己的全部行与别人的 `PUBLIC` 行，看不到别人的私有行。
#[tokio::test]
async fn account_scope_sees_own_rows_and_public_rows_of_others() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let owner = AssetReader::enter(&fixture.storage, Some(fixture.owner))
        .await
        .expect("进入创建者作用域失败");
    assert_eq!(
        visible_ids(owner.tx()).await,
        expected(&[
            fixture.asset_public,
            fixture.asset_private,
            fixture.asset_shared,
            fixture.asset_pending,
        ]),
        "创建者应看到自己名下全部行（含未完成会话），此外只剩别人的 PUBLIC 行"
    );
    owner.rollback().await.expect("回滚读事务失败");

    let outsider = AssetReader::enter(&fixture.storage, Some(fixture.outsider))
        .await
        .expect("进入第三方作用域失败");
    assert_eq!(
        visible_ids(outsider.tx()).await,
        expected(&[fixture.asset_public, fixture.asset_restricted]),
        "第三方只能看到 PUBLIC 与自己的行：他人 PRIVATE 行不可见（否则下载路径会报 403 泄露存在性）"
    );
    outsider.rollback().await.expect("回滚读事务失败");

    // 白名单成员同时踩中两条分支：自己创建的租户资产 + 被点名的 RESTRICTED 资产
    let viewer = AssetReader::enter(&fixture.storage, Some(fixture.viewer))
        .await
        .expect("进入白名单成员作用域失败");
    assert_eq!(
        visible_ids(viewer.tx()).await,
        expected(&[
            fixture.asset_public,
            fixture.asset_restricted,
            fixture.asset_tenant,
        ]),
        "白名单成员应同时看到 viewers 分支与创建者分支"
    );
    viewer.rollback().await.expect("回滚读事务失败");
}

/// `RESTRICTED`：`viewers` 点到名的账号能读，其他人（含匿名）读不到。
#[tokio::test]
async fn restricted_assets_reach_named_viewers_only() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let viewer = AssetReader::enter(&fixture.storage, Some(fixture.viewer))
        .await
        .expect("进入白名单成员作用域失败");
    assert!(
        visible_ids(viewer.tx())
            .await
            .contains(&fixture.asset_restricted.to_string()),
        "白名单成员应读得到 RESTRICTED 行"
    );
    viewer.rollback().await.expect("回滚读事务失败");

    // 创建者（`outsider`）走的是创建者分支，所以这里挑既不是创建者也没被点名的账号
    for (tag, user) in [("第三方", Some(fixture.owner)), ("匿名", None)] {
        let reader = AssetReader::enter(&fixture.storage, user)
            .await
            .expect("进入读作用域失败");
        assert!(
            !visible_ids(reader.tx())
                .await
                .contains(&fixture.asset_restricted.to_string()),
            "{tag}不该看到 RESTRICTED 行"
        );
        reader.rollback().await.expect("回滚读事务失败");
    }
}

/// `"tenantID"` 分支只在租户作用域内有意义：账号作用域看不到它，哪怕是租户 Owner。
#[tokio::test]
async fn tenant_branch_only_opens_inside_tenant_scope() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let account = AssetReader::enter(&fixture.storage, Some(fixture.owner))
        .await
        .expect("进入账号作用域失败");
    assert!(
        !visible_ids(account.tx())
            .await
            .contains(&fixture.asset_tenant.to_string()),
        "账号作用域没有租户：租户自己是 Owner 也读不到带 tenantID 的行"
    );
    account.rollback().await.expect("回滚读事务失败");

    let session = session_of(&fixture, fixture.owner).await;
    let ctx = TenantCtx::enter(
        &fixture.storage,
        &session,
        TenantId::from_uuid(fixture.tenant),
    )
    .await
    .expect("进入租户作用域失败");
    assert_eq!(
        visible_ids(ctx.tx()).await,
        expected(&[fixture.asset_public, fixture.asset_tenant]),
        "租户作用域 = 本租户行 + PUBLIC 行；别人的无租户私有行仍然不可见"
    );
    ctx.rollback().await.expect("回滚租户事务失败");
}

/// 能力键分支：无身份地按 hash 借内容，跨账号借得到，未完成会话借不到。
#[tokio::test]
async fn hash_capability_borrows_completed_content_across_accounts() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let scope = AssetContentScope::open(&fixture.storage, &hash("f"))
        .await
        .expect("按 hash 进入内容作用域失败");
    assert_eq!(scope.hash(), hash("f").as_str());
    let borrowed = visible_ids(scope.tx()).await;
    assert!(
        borrowed.contains(&fixture.asset_shared.to_string()),
        "已完成的那一行必须借得出来（秒传克隆的前提）"
    );
    assert!(
        !borrowed.contains(&fixture.asset_pending.to_string()),
        "同一 hash 的未完成会话不能借：否则猜到 hash 的人就能续传别人的上传会话"
    );
    assert_eq!(
        borrowed,
        expected(&[fixture.asset_public, fixture.asset_shared]),
        "PUBLIC 是全局分支，能力键作用域里同样可见，所以这里看到的是「命中 hash 的行 + 公开行」"
    );
    scope.rollback().await.expect("回滚内容事务失败");

    // 借的是内容，不是所有权：创建者是谁无关
    let cross = AssetContentScope::open(&fixture.storage, &hash("b"))
        .await
        .expect("按 hash 进入内容作用域失败");
    assert!(
        visible_ids(cross.tx())
            .await
            .contains(&fixture.asset_private.to_string()),
        "已完成的他人私有内容按 hash 借得到（跨账号秒传的前提）"
    );
    cross.rollback().await.expect("回滚内容事务失败");

    let absent = AssetContentScope::open(&fixture.storage, &hash("9"))
        .await
        .expect("按 hash 进入内容作用域失败");
    let miss = visible_ids(absent.tx()).await;
    assert!(
        !miss.contains(&fixture.asset_shared.to_string())
            && !miss.contains(&fixture.asset_pending.to_string()),
        "没有任何行命中这个 hash 时就借不到内容：{miss:?}"
    );
    absent.rollback().await.expect("回滚内容事务失败");
}

/// 下载路径的契约：看不到 → 404；看得到但没权限 → 403（现在是白名单/未完成两类）。
#[tokio::test]
async fn download_path_hides_invisible_assets_as_not_found() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let public = fixture.asset_public.to_string();
    let private = fixture.asset_private.to_string();
    let restricted = fixture.asset_restricted.to_string();
    let tenant = fixture.asset_tenant.to_string();
    let pending = fixture.asset_pending.to_string();
    let owner = fixture.owner.to_string();
    let outsider = fixture.outsider.to_string();
    let viewer = fixture.viewer.to_string();

    let found = UploadService::find_owned_asset(&fixture.storage, &public, None)
        .await
        .expect("匿名下载 PUBLIC 资产失败");
    assert_eq!(found.id, fixture.asset_public);

    for (tag, id, user) in [
        ("他人私有（匿名）", private.as_str(), None),
        (
            "他人私有（第三方）",
            private.as_str(),
            Some(outsider.as_str()),
        ),
        // `asset_restricted` 的创建者正是 `outsider`，所以这里要挑既不是创建者
        // 也没被点名进 `viewers` 的账号：owner
        (
            "白名单外（租户 Owner）",
            restricted.as_str(),
            Some(owner.as_str()),
        ),
        (
            "带 tenantID 但不在租户作用域",
            tenant.as_str(),
            Some(owner.as_str()),
        ),
    ] {
        let err = UploadService::find_owned_asset(&fixture.storage, id, user)
            .await
            .expect_err(&format!("{tag}：不可见的行必须报错"));
        assert!(
            matches!(err, UploadError::NotFound),
            "{tag}：不可见就是 404（旧实现报 403，等于承认这一行存在），实际 {err:?}"
        );
    }

    let owned = UploadService::find_owned_asset(&fixture.storage, &private, Some(&owner))
        .await
        .expect("创建者下载自己的 PRIVATE 资产失败");
    assert_eq!(owned.id, fixture.asset_private);

    let shared = UploadService::find_owned_asset(&fixture.storage, &restricted, Some(&viewer))
        .await
        .expect("白名单成员下载 RESTRICTED 资产失败");
    assert_eq!(shared.id, fixture.asset_restricted);

    let err = UploadService::find_owned_asset(&fixture.storage, &pending, Some(&owner))
        .await
        .expect_err("未完成会话不可下载");
    assert!(
        matches!(err, UploadError::BadRequest(_)),
        "看得到但还没传完：400 而不是 404，实际 {err:?}"
    );
}

/// 写入约束只认创建者：伪造他人行会撞上行级安全，改 `PUBLIC` 也绕不过去。
#[tokio::test]
async fn write_check_rejects_forged_creators() {
    let _guard = DB_LOCK.lock().await;
    let Some(fixture) = setup().await else { return };

    let scope = AccountScope::open(&fixture.storage, fixture.outsider)
        .await
        .expect("进入账号作用域失败");

    insert_asset(scope.tx(), &hash("1"), fixture.outsider, "PRIVATE")
        .await
        .expect("写自己的行应当成功");
    insert_asset(scope.tx(), &hash("2"), fixture.outsider, "PUBLIC")
        .await
        .expect("写自己的公开行应当成功");

    let err = insert_asset(scope.tx(), &hash("3"), fixture.owner, "PUBLIC")
        .await
        .expect_err("伪造他人为创建者的写入必须被拒绝");
    assert!(
        is_row_security_violation(&err),
        "应当撞上行级安全检查，实际 {err:?}"
    );

    scope.rollback().await.expect("回滚账号事务失败");
}
