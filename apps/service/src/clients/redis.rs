use anyhow::{Context, Result};
use fred::clients::Pool;
use fred::prelude::*;
use fred::types::ConnectHandle;

/// Redis 连接池（fred）。启动时 `init` 并保留驱动任务句柄。
pub struct RedisPool {
    pool: Pool,
    _driver: ConnectHandle,
}

impl RedisPool {
    pub async fn new(url: &str, pool_size: usize) -> Result<Self> {
        let config = Config::from_url(url).context("invalid REDIS_URL")?;
        // `Builder` 的 policy 默认是 `None`，而 fred 的 `should_reconnect()` 对 `None` 返回 false，
        // 于是 `defer_reconnection` 直接放弃 ⇒ 不显式设置就**完全没有重连**：连接断开后池会永久
        // 空转，命令一直排队（`fail_fast = false`），表现为 redis 容器一重建服务就再也不恢复。
        // 默认策略为「每 1s 重试，永不放弃」。
        let mut builder = Builder::from_config(config);
        builder.set_policy(ReconnectPolicy::default());
        let pool = builder
            .build_pool(pool_size.max(1))
            .context("redis pool build failed")?;
        let driver = pool.init().await.context("redis connect failed")?;
        let _: () = pool.ping(None).await.context("redis ping failed")?;
        Ok(Self {
            pool,
            _driver: driver,
        })
    }

    pub fn pool(&self) -> &Pool {
        &self.pool
    }

    pub async fn ping(&self) -> Result<()> {
        let _: () = self.pool.ping(None).await.context("redis ping failed")?;
        Ok(())
    }
}
