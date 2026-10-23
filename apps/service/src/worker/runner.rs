//! worker 的装配与循环：把 `Storage` 的平台通道接到 `audit::Publisher`，并负责停机。
//!
//! 两件事在这里落地：
//!
//! 1. **平台通道**——`outbox` 强制行级安全，发布者要跨租户看到所有待发布事件，
//!    只能以 `cogito_platform` 角色进入（`Storage` 的平台事务，R8 正向登记）。
//! 2. **停机不丢事件**——收到停机信号后不再开新一轮，正在投递的那一轮走完；
//!    没来得及投递的事件仍在 outbox 里，重启后继续。

use std::time::Duration;

use audit::{AuditError, DispatchError, Dispatcher, PublishOutcome, Publisher, PublisherOptions};
use sea_orm::{DatabaseTransaction, DbErr};
use tokio::sync::watch;

use crate::configures::configure::Configure;
use crate::databases::database::Storage;

/// 让 `Storage` 成为事件发布的特权通道：一轮发布的所有读写都在同一个平台事务里。
///
/// 这是**唯一**允许在请求路径之外提权到平台角色的地方：发布者本质上就是平台级消费者，
/// 它要读的是「所有租户的待发布事件」，没有比这更窄的作用域（见 R8 登记）。
impl audit::PlatformChannel for Storage {
    async fn begin(&self) -> Result<DatabaseTransaction, DbErr> {
        self.platform_tx().await
    }
}

/// 发布循环的参数（来自 `events` 配置段）。
#[derive(Debug, Clone, Copy)]
pub struct LoopOptions {
    /// 轮询间隔：一轮结束到下一轮开始之间的等待。
    pub poll_interval: Duration,
    /// 每批最多读取多少条事件。
    pub batch_size: u64,
    /// 失败聚合的退避基数。
    pub backoff_base: Duration,
    /// 失败聚合的退避上限。
    pub backoff_max: Duration,
}

impl LoopOptions {
    /// 从配置装配循环参数。
    #[must_use]
    pub fn from_configure(configure: &Configure) -> Self {
        Self {
            poll_interval: Duration::from_millis(configure.events.poll_interval_ms),
            batch_size: configure.events.batch_size,
            backoff_base: Duration::from_millis(configure.events.backoff_base_ms),
            backoff_max: Duration::from_millis(configure.events.backoff_max_ms),
        }
    }

    fn publisher_options(self) -> PublisherOptions {
        PublisherOptions {
            batch_size: self.batch_size,
            backoff_base: self.backoff_base,
            backoff_max: self.backoff_max,
        }
    }
}

/// 一直发布，直到 `shutdown` 变为 `true`。
///
/// 首轮失败视为启动失败：多半是平台角色没建、库连不上这类「等下去也不会好」的问题，
/// 让进程退出并由编排器重试，比在日志里刷错误清楚。之后的失败只记日志并继续——
/// 数据库抖动是暂时的，事件留在 outbox 里不会丢。
///
/// # Errors
///
/// 首轮发布失败时返回该错误（[`AuditError`]）。
pub async fn run<D: Dispatcher>(
    storage: Storage,
    dispatcher: D,
    options: LoopOptions,
    mut shutdown: watch::Receiver<bool>,
) -> Result<(), AuditError> {
    let publisher = Publisher::new(storage, dispatcher, options.publisher_options());
    let mut first_round = true;

    loop {
        if *shutdown.borrow() {
            tracing::info!("收到停机信号：停止发布");
            return Ok(());
        }

        match publisher.round().await {
            Ok(outcome) => {
                first_round = false;
                report(&outcome);
            }
            Err(error) => {
                if first_round {
                    return Err(error);
                }
                tracing::warn!(error = %error, "发布一轮失败，稍后重试（事件仍在 outbox 中）");
            }
        }

        // 轮与轮之间只响应停机：一轮内部的投递不会被取消，避免「投了但没置位」的重复放大
        tokio::select! {
            result = shutdown.changed() => {
                if result.is_err() || *shutdown.borrow() {
                    tracing::info!("收到停机信号：停止发布");
                    return Ok(());
                }
            }
            () = tokio::time::sleep(options.poll_interval) => {}
        }
    }
}

/// 把一轮结果写进日志：正常情况下只在有事件时出声，异常情况一定出声。
fn report(outcome: &PublishOutcome) {
    if !outcome.is_idle() && !outcome.has_failures() {
        tracing::debug!(
            scanned = outcome.scanned,
            published = outcome.published,
            skipped = outcome.skipped,
            "事件发布完成"
        );
    }

    for failure in &outcome.failures {
        let hint = match &failure.error {
            // 4xx 不是「等一会儿就好」：端点、鉴权或信封格式有问题，重试再多也没用
            DispatchError::Status { status, .. } if (400..500).contains(status) => {
                "（客户端错误：检查 events.endpoint / token 与下游契约）"
            }
            _ => "",
        };
        tracing::error!(
            event_id = %failure.event_id,
            aggregate = %failure.aggregate,
            aggregate_id = %failure.aggregate_id,
            error = %failure.error,
            "事件投递失败，将在退避后重试{hint}"
        );
    }
}
