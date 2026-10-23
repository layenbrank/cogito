use std::sync::Arc;

use duroxide::ProviderRef;
use duroxide_pg::{MigrationPolicy, PostgresProvider, ProviderConfig};

use crate::{Client, DurableError, DurableSettings};

/// 可靠执行的存储：编排历史 + 连接池。
///
/// 每个进程各连一次；`Store` 是 `Clone` 的，克隆共享同一个池。
///
/// provider 的表建在**独立 schema**（默认 `durable`）里：与业务表（`public`，由
/// `migration` crate 管理、受行级安全约束）互不干扰，两边各管各的迁移世代。
pub struct Store {
    provider: Arc<PostgresProvider>,
    schema: String,
}

impl Store {
    /// 连接并（按设置）应用 provider 自带的迁移。
    ///
    /// `schema` 为空或为 `public` 时直接报错：可靠执行的表与业务表同处一个 schema
    /// 会让两套迁移互相踩，且 `cleanup_schema()` 会误删业务表。
    pub async fn connect(settings: &DurableSettings) -> Result<Self, DurableError> {
        let schema = settings.schema.trim();
        if schema.is_empty() || schema.eq_ignore_ascii_case("public") {
            return Err(DurableError::Store(format!(
                "durable.schema 必须是独立 schema（当前为 {schema:?}）：编排历史不能和业务表同居 public"
            )));
        }

        let mut config = ProviderConfig::url(settings.database_url.clone());
        config.schema_name = Some(schema.to_string());
        config.migration_policy = if settings.auto_migrate {
            MigrationPolicy::ApplyAll
        } else {
            MigrationPolicy::VerifyOnly
        };

        let provider = PostgresProvider::new_with_config(config)
            .await
            .map_err(|e| DurableError::Store(e.to_string()))?;

        Ok(Self {
            schema: provider.schema_name().to_string(),
            provider: Arc::new(provider),
        })
    }

    /// 编排历史所在的 schema 名。
    pub fn schema(&self) -> &str {
        &self.schema
    }

    /// 起实例 / 查状态用的客户端。可脱离运行时使用（api 进程起实例走的也是它）。
    pub fn client(&self) -> Client {
        Client::new(self.provider_ref())
    }

    /// 删掉本实例独占的 schema（连同全部编排历史）。
    ///
    /// 只给测试与运维清理用；本方法不会碰 `public`。
    pub async fn cleanup_schema(&self) -> Result<(), DurableError> {
        self.provider
            .cleanup_schema()
            .await
            .map_err(|e| DurableError::Store(e.to_string()))
    }

    pub(crate) fn provider_ref(&self) -> ProviderRef {
        Arc::clone(&self.provider) as ProviderRef
    }
}

impl Clone for Store {
    fn clone(&self) -> Self {
        Self {
            provider: Arc::clone(&self.provider),
            schema: self.schema.clone(),
        }
    }
}

impl std::fmt::Debug for Store {
    /// 连接串可能带密码，且池没有有意义的调试信息：只打 schema。
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Store")
            .field("schema", &self.schema)
            .finish()
    }
}
