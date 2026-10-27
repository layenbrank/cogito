use sea_orm::{
    ConnectOptions, ConnectionTrait, Database, DatabaseConnection, DatabaseTransaction, DbErr,
    Statement, TransactionTrait,
};
use std::sync::Arc;
use tracing::{error, info};

pub type Connection = Arc<DatabaseConnection>;

/// 可克隆：`Arc` 只克隆句柄，供 Tauri state 与 loopback 桥共享同一连接。
#[derive(Clone)]
pub struct Storage {
    connection: Connection,
}

impl Storage {
    pub fn new(connection: Connection) -> Self {
        Self { connection }
    }

    pub fn connection(&self) -> &DatabaseConnection {
        &self.connection
    }

    /// 便捷方法：事务包装
    pub async fn with_transaction<F, Fut, T>(&self, f: F) -> Result<T, DbErr>
    where
        F: FnOnce(&DatabaseTransaction) -> Fut,
        Fut: std::future::Future<Output = Result<T, DbErr>>,
    {
        let txn = (&*self.connection).begin().await?;
        let result = f(&txn).await?;
        txn.commit().await?;
        Ok(result)
    }
}

/// 初始化数据库连接（使用 ConnectOptions + 完整性能配置）
pub async fn initialize(uri: &str) -> Result<Connection, DbErr> {
    info!("正在连接数据库: {}", uri);

    let mut options = ConnectOptions::new(uri.to_owned());
    options
        .max_connections(1)
        .min_connections(1)
        .sqlx_logging(true)
        .sqlx_logging_level(tracing::log::LevelFilter::Debug);

    let connect = Database::connect(options).await?;

    configure(&connect).await?;
    connect.ping().await?;

    info!("数据库连接成功");
    Ok(Arc::new(connect))
}

/// SQLite 性能优化配置（2026 年最佳实践）
async fn configure(connect: &DatabaseConnection) -> Result<(), DbErr> {
    let pragmas = [
        ("journal_mode", "WAL"),            // 写前日志，提升并发
        ("synchronous", "NORMAL"),          // 平衡性能与持久性
        ("cache_size", "-64000"),           // 64MB 缓存（根据设备内存可调）
        ("temp_store", "MEMORY"),           // 临时表全内存
        ("foreign_keys", "ON"),             // 强制外键约束
        ("busy_timeout", "5000"),           // 5 秒忙等待
        ("mmap_size", "268435456"),         // 256MB 内存映射
        ("wal_autocheckpoint", "1000"),     // 自动 checkpoint
        ("journal_size_limit", "10485760"), // WAL 文件上限 10MB
    ];

    for (key, value) in pragmas {
        let sql = format!("PRAGMA {} = {}", key, value);
        if let Err(e) = connect
            .execute(Statement::from_string(
                sea_orm::DatabaseBackend::Sqlite,
                sql,
            ))
            .await
        {
            error!("SQLite 配置失败 {}: {}", key, e);
        } else {
            info!("SQLite 配置成功: {} = {}", key, value);
        }
    }

    let _ = connect
        .execute(Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            "PRAGMA optimize;".to_string(),
        ))
        .await;

    Ok(())
}

/// 数据库文件路径（跨平台）
pub fn database_path(appdata: &std::path::Path) -> std::path::PathBuf {
    if let Err(e) = std::fs::create_dir_all(appdata) {
        error!("创建数据库目录失败: {}", e);
    }
    appdata.join("cogito-client.db")
}
