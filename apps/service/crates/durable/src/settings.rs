/// [`crate::Store::connect`] 需要的设置（由 `Configure.durable` 映射而来）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DurableSettings {
    /// 连接串。与 `database.url` 指向同一个库，但 provider 自建连接池，
    /// 不复用 `Storage` 的池（编排历史与业务数据在权限上是两回事）。
    pub database_url: String,
    /// 编排历史所在的 schema，必须与业务表所在的 `public` 分开。
    pub schema: String,
    /// 启动时应用 provider 自带的迁移；`false` 时只校验迁移已跑过，不执行任何 DDL
    /// （给不该建表的进程用，例如 api 只负责起实例）。
    pub auto_migrate: bool,
}

impl DurableSettings {
    pub fn new(
        database_url: impl Into<String>,
        schema: impl Into<String>,
        auto_migrate: bool,
    ) -> Self {
        Self {
            database_url: database_url.into(),
            schema: schema.into(),
            auto_migrate,
        }
    }
}
