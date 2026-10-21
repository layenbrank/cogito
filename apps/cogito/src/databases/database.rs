use std::time::Duration;

use anyhow::{Context, Result};
use migration::{Migrator, MigratorTrait};
use sea_orm::{ConnectOptions, Database, DatabaseConnection};

#[derive(Clone)]
pub struct Storage {
    /// 未作用域连接：只能通过 [`Storage::raw`] 取，调用点由门禁 R9 正向登记。
    db: DatabaseConnection,
    pub database: String,
}

impl Storage {
    pub async fn new(uri: &str) -> Result<Self> {
        let database = database_name(uri);

        let mut opt = ConnectOptions::new(uri.to_owned());
        opt.max_connections(20)
            .min_connections(2)
            .connect_timeout(Duration::from_secs(8))
            .acquire_timeout(Duration::from_secs(8))
            .idle_timeout(Duration::from_secs(8))
            .max_lifetime(Duration::from_secs(1800))
            .sqlx_logging(true)
            .sqlx_logging_level(log::LevelFilter::Debug);

        let db = Database::connect(opt)
            .await
            .context("Failed to connect to PostgreSQL")?;

        db.ping().await.context("PostgreSQL ping failed")?;

        Migrator::up(&db, None)
            .await
            .context("Failed to migrate PostgreSQL schema")?;

        Ok(Storage { db, database })
    }

    /// 组一个只带连接与库名的 [`Storage`]：集成测试夹具用（自带池大小与角色），
    /// 正式路径一律走 [`Storage::new`]。
    #[must_use]
    pub const fn from_parts(db: DatabaseConnection, database: String) -> Self {
        Self { db, database }
    }

    /// 未作用域连接：不带任何会话变量，也不受 `*_tx` 通道约束。
    ///
    /// 它只对**天生全局**的数据成立：`auth` 是账号表、没有行级安全（登录必须先按
    /// 用户名/手机号/邮箱跨租户查到账号），以及健康检查的 `ping`。其余读写一律走
    /// 作用域通道——「读不到」应当是策略决定的，而不是忘了进作用域。
    ///
    /// 这是门禁 R9 的观察面：新增调用点会被 `bun run arch` 拦下，需要连同理由登记到
    /// `scripts/capabilities.ts` 的 `UNSCOPED_DB_ALLOWED`。
    #[must_use]
    pub const fn raw(&self) -> &DatabaseConnection {
        &self.db
    }
}

fn database_name(uri: &str) -> String {
    uri.rsplit('/')
        .next()
        .and_then(|tail| tail.split('?').next())
        .filter(|name| !name.is_empty())
        .unwrap_or("cogito-service")
        .to_string()
}
