//! 编排运行时（durable）的连接装配。
//!
//! api 与 worker 都只是「起实例 / 读状态」的客户端，不跑活动；两边共用这一份，
//! 免得两处对 `auto_migrate`、schema、失败降级的口径各写一遍。
//!
//! 迁移策略沿用配置里的 `auto_migrate`（默认开），**不用 `VerifyOnly`**：两边都是持有
//! DDL 权限的应用后端，`duroxide-pg` 的 verify 只在不做 DDL 的前提下才成立，schema 还没建时
//! 它会直接硬失败。两个进程同时应用迁移也是安全的 —— provider 用 schema 名哈希出的
//! advisory lock 把迁移串行化了。

use std::sync::Arc;

use durable::{Client, DurableSettings, Store};

use crate::configures::configure::Configure;

/// 连不上返回 `None`：调用方把相关能力降级成 503 / 台账原样，而不是把整个进程拖垮。
pub async fn connect(config: &Configure) -> Option<Arc<Client>> {
    let url = match config.require_durable_settings() {
        Ok(url) => url,
        Err(error) => {
            tracing::warn!(error = %error, "编排库未配置：依赖编排的能力不可用");
            return None;
        }
    };

    let settings = DurableSettings::new(
        url,
        config.durable.schema.clone(),
        config.durable.auto_migrate,
    );

    match Store::connect(&settings).await {
        Ok(store) => Some(Arc::new(store.client())),
        Err(error) => {
            tracing::error!(
                error = %error,
                schema = %config.durable.schema,
                "编排库连接失败：依赖编排的能力不可用"
            );
            None
        }
    }
}
