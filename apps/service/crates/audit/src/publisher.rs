//! 事件发布器：把 outbox 里已提交的事件投递给下游。
//!
//! 语义是**至少一次**：投递成功后才置 `publishedAt`，因此崩溃、超时、下游 5xx
//! 都只会导致重投，不会导致漏投；重复由消费者侧 [`consume_once`](crate::consume_once)
//! 或下游自身的幂等键消除。
//!
//! 失败隔离同样重要：一条投递不出去的事件不能拖住整个 outbox。做法是
//! **按聚合**（`aggregate` + `aggregateID`）退避并阻塞同一聚合后续事件——同一聚合的
//! 事件之间有顺序依赖，乱序投递比延迟投递更糟；而其他聚合照常前进。

use std::{
    collections::{HashMap, HashSet},
    fmt,
    future::Future,
    sync::{Mutex, MutexGuard, PoisonError},
    time::{Duration, Instant},
};

use uuid::Uuid;

use crate::{AuditError, Envelope, PlatformChannel, store};

/// 单条事件的投递失败原因。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DispatchError {
    /// 下游返回非 2xx。
    Status {
        /// HTTP 状态码。
        status: u16,
        /// 响应体片段（已截断，仅供排查）。
        body: String,
    },
    /// 连接、超时等传输层失败。
    Transport(String),
}

impl fmt::Display for DispatchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Status { status, body } if body.is_empty() => write!(f, "下游返回 {status}"),
            Self::Status { status, body } => write!(f, "下游返回 {status}：{body}"),
            Self::Transport(reason) => write!(f, "投递失败：{reason}"),
        }
    }
}

/// 事件投递端口。
///
/// 由调用方实现（`cogito` 侧提供 HTTP 与「只记日志」两种），本 crate 不依赖
/// HTTP 框架，也不决定重试节奏。
pub trait Dispatcher {
    /// 投递一条事件；返回 `Ok(())` 即视为已送达。
    fn dispatch(
        &self,
        envelope: &Envelope,
    ) -> impl Future<Output = Result<(), DispatchError>> + Send;
}

/// 发布器参数。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PublisherOptions {
    /// 一轮最多读取多少条待发布事件。
    pub batch_size: u64,
    /// 聚合退避的基数（第 n 次连续失败等待 `base * 2^n`，上限 `backoff_max`）。
    pub backoff_base: Duration,
    /// 聚合退避的上限。
    pub backoff_max: Duration,
}

impl Default for PublisherOptions {
    fn default() -> Self {
        Self {
            batch_size: 64,
            backoff_base: Duration::from_secs(1),
            backoff_max: Duration::from_secs(60),
        }
    }
}

/// 一条事件的投递失败（仅用于回报与日志，不影响其他事件）。
#[derive(Debug, Clone)]
pub struct PublishFailure {
    /// 事件 ID。
    pub event_id: Uuid,
    /// 聚合名。
    pub aggregate: String,
    /// 聚合标识。
    pub aggregate_id: Uuid,
    /// 失败原因。
    pub error: DispatchError,
}

/// 一轮发布的结果。
#[derive(Debug, Clone, Default)]
#[must_use]
pub struct PublishOutcome {
    /// 本轮读到的事件数。
    pub scanned: u64,
    /// 本轮成功投递并置位的事件数。
    pub published: u64,
    /// 本轮未处理的事件数（退避中、被同聚合失败阻塞、或被其他实例抢先发布）。
    pub skipped: u64,
    /// 本轮投递失败的事件。
    pub failures: Vec<PublishFailure>,
}

impl PublishOutcome {
    /// 没有读到待发布事件（可用来把日志降噪）。
    #[must_use]
    pub fn is_idle(&self) -> bool {
        self.scanned == 0
    }

    /// 本轮是否有投递失败。
    #[must_use]
    pub fn has_failures(&self) -> bool {
        !self.failures.is_empty()
    }
}

/// 聚合键：退避与顺序阻塞的作用范围。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct AggregateKey {
    aggregate: String,
    aggregate_id: Uuid,
}

/// 单个聚合的退避状态（进程内，重启即忘：重启后立刻重试是期望行为）。
#[derive(Debug, Clone, Copy)]
struct Backoff {
    until: Instant,
    consecutive_failures: u32,
}

/// 事件发布器。
///
/// 泛型而不是 trait object：`PlatformChannel` / `Dispatcher` 都用 `impl Future` 返回，
/// 静态分派即可，无需 `async-trait` 依赖。
pub struct Publisher<C: PlatformChannel, D: Dispatcher> {
    channel: C,
    dispatcher: D,
    options: PublisherOptions,
    backoff: Mutex<HashMap<AggregateKey, Backoff>>,
}

impl<C: PlatformChannel, D: Dispatcher> Publisher<C, D> {
    /// 组装发布器。
    pub fn new(channel: C, dispatcher: D, options: PublisherOptions) -> Self {
        Self {
            channel,
            dispatcher,
            options,
            backoff: Mutex::new(HashMap::new()),
        }
    }

    /// 发布一轮：读一批待发布事件，按序投递，再把结果写回 outbox。
    ///
    /// 读与写共用同一个平台事务。投递发生在事务打开期间，但读取路径不加任何锁，
    /// 写回只针对「仍然未发布」的行，因此多实例并行发布是安全的（各自投递，
    /// 谁先置位谁算成功）。
    ///
    /// # Errors
    ///
    /// 平台通道或 outbox 读写失败时返回 [`AuditError::Db`]；下游错误不算错误。
    pub async fn round(&self) -> Result<PublishOutcome, AuditError> {
        let transaction = self.channel.begin().await?;
        let pending = store::pending(&transaction, self.options.batch_size).await?;
        let mut outcome = PublishOutcome {
            scanned: pending.len() as u64,
            ..PublishOutcome::default()
        };
        if pending.is_empty() {
            transaction.commit().await?;
            return Ok(outcome);
        }

        let now = Instant::now();
        let mut blocked: HashSet<AggregateKey> = HashSet::new();
        let mut published: Vec<(Uuid, AggregateKey)> = Vec::new();
        let mut failed: Vec<(Uuid, AggregateKey, String)> = Vec::new();

        for model in &pending {
            let key = AggregateKey {
                aggregate: model.aggregate.clone(),
                aggregate_id: model.aggregate_id,
            };
            // 同聚合前一条失败 → 本轮跳过该聚合的后续事件，保持聚合内有序
            if blocked.contains(&key) || self.in_backoff(&key, now) {
                outcome.skipped += 1;
                continue;
            }
            match self.dispatcher.dispatch(&Envelope::from(model)).await {
                Ok(()) => published.push((model.id, key)),
                Err(error) => {
                    blocked.insert(key.clone());
                    outcome.failures.push(PublishFailure {
                        event_id: model.id,
                        aggregate: key.aggregate.clone(),
                        aggregate_id: key.aggregate_id,
                        error: error.clone(),
                    });
                    failed.push((model.id, key, error.to_string()));
                }
            }
        }

        for (event_id, _) in &published {
            if store::mark_published(&transaction, *event_id).await? {
                outcome.published += 1;
            } else {
                // 另一个发布者已经置位：本轮不算我们发布
                outcome.skipped += 1;
            }
        }
        for (event_id, _, reason) in &failed {
            store::mark_failed(&transaction, *event_id, reason).await?;
        }
        transaction.commit().await?;

        // 事务提交成功后才动退避状态：只有真正落到库里的失败才配拖慢重试
        self.record_failures(&failed, now);
        self.clear_backoff(&published);

        Ok(outcome)
    }

    /// 聚合是否还在退避窗口内。
    fn in_backoff(&self, key: &AggregateKey, now: Instant) -> bool {
        let backoff = self.lock_backoff();
        backoff.get(key).is_some_and(|entry| entry.until > now)
    }

    /// 记下本轮失败聚合的连续失败次数，得到下一次允许尝试的时间。
    fn record_failures(&self, failed: &[(Uuid, AggregateKey, String)], now: Instant) {
        if failed.is_empty() {
            return;
        }
        let mut backoff = self.lock_backoff();
        for (_, key, _) in failed {
            let entry = backoff.entry(key.clone()).or_insert(Backoff {
                until: now,
                consecutive_failures: 0,
            });
            entry.consecutive_failures = entry.consecutive_failures.saturating_add(1);
            entry.until = now + self.delay(entry.consecutive_failures);
        }
    }

    /// 本轮投递成功的聚合恢复正常节奏。
    fn clear_backoff(&self, published: &[(Uuid, AggregateKey)]) {
        if published.is_empty() {
            return;
        }
        let mut backoff = self.lock_backoff();
        for (_, key) in published {
            backoff.remove(key);
        }
    }

    /// 指数退避，封顶 `backoff_max`。
    fn delay(&self, consecutive_failures: u32) -> Duration {
        let factor = 1_u32 << consecutive_failures.min(20);
        self.options
            .backoff_base
            .saturating_mul(factor)
            .min(self.options.backoff_max)
    }

    /// 退避表加锁；锁只在无 `await` 的短片段里持有，中毒（某个线程 panic）后继续用。
    fn lock_backoff(&self) -> MutexGuard<'_, HashMap<AggregateKey, Backoff>> {
        self.backoff.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 只用来构造 `Publisher`：任何一轮发布都会立刻拿到通道错误，不会真的投递。
    struct DeadChannel;

    impl PlatformChannel for DeadChannel {
        async fn begin(&self) -> Result<sea_orm::DatabaseTransaction, sea_orm::DbErr> {
            Err(sea_orm::DbErr::Custom("测试用：没有通道".to_owned()))
        }
    }

    struct DeadDispatcher;

    impl Dispatcher for DeadDispatcher {
        async fn dispatch(&self, _envelope: &Envelope) -> Result<(), DispatchError> {
            Err(DispatchError::Transport("测试用：不会调用".to_owned()))
        }
    }

    fn publisher(options: PublisherOptions) -> Publisher<DeadChannel, DeadDispatcher> {
        Publisher::new(DeadChannel, DeadDispatcher, options)
    }

    #[test]
    fn backoff_grows_exponentially_and_stops_at_max() {
        let publisher = publisher(PublisherOptions {
            backoff_base: Duration::from_secs(1),
            backoff_max: Duration::from_secs(10),
            ..PublisherOptions::default()
        });

        assert_eq!(publisher.delay(1), Duration::from_secs(2));
        assert_eq!(publisher.delay(2), Duration::from_secs(4));
        assert_eq!(publisher.delay(3), Duration::from_secs(8));
        assert_eq!(publisher.delay(4), Duration::from_secs(10), "封顶");
        assert_eq!(
            publisher.delay(u32::MAX),
            Duration::from_secs(10),
            "不因移位溢出"
        );
    }

    #[test]
    fn failure_blocks_only_its_own_aggregate() {
        let publisher = publisher(PublisherOptions::default());
        let now = Instant::now();
        let failing = AggregateKey {
            aggregate: "subscription".to_owned(),
            aggregate_id: Uuid::nil(),
        };
        let healthy = AggregateKey {
            aggregate: "subscription".to_owned(),
            aggregate_id: Uuid::max(),
        };

        assert!(!publisher.in_backoff(&failing, now), "一开始没有退避");

        publisher.record_failures(&[(Uuid::nil(), failing.clone(), "boom".to_owned())], now);
        assert!(publisher.in_backoff(&failing, now));
        assert!(
            !publisher.in_backoff(&healthy, now),
            "退避按聚合隔离，不能拖住其他聚合"
        );

        // 成功投递后立刻恢复，不必等退避窗口结束
        publisher.clear_backoff(&[(Uuid::nil(), failing.clone())]);
        assert!(!publisher.in_backoff(&failing, now));
    }
}
