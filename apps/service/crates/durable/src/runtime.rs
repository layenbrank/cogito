use std::sync::Arc;
use std::time::Duration;

use duroxide::runtime::{Runtime as DuroxideRuntime, RuntimeOptions};

use crate::{Activities, DurableError, Orchestrations, Store};

/// 运行时并发与租约档位。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RuntimeTuning {
    /// 同时推进的编排轮次数（每个轮次处理一个实例的一步）。
    pub orchestration_concurrency: usize,
    /// 同时执行的活动数（真正干活的并行度）。
    pub worker_concurrency: usize,
    /// 活动租约时长（毫秒）：执行者领到一步后，多久没续期就算失联。
    /// 进程被硬杀时它手里那一步要等租约过期才能被别人接手，所以这个值同时是
    /// 「崩溃恢复最慢多久」的上界。
    pub worker_lock_timeout_ms: u64,
    /// 租约续期提前量（毫秒），恒小于 `worker_lock_timeout_ms`。
    pub worker_lock_renewal_buffer_ms: u64,
}

impl RuntimeTuning {
    /// 活动租约默认时长（毫秒）。与实现本体的默认值一致。
    pub const DEFAULT_WORKER_LOCK_TIMEOUT_MS: u64 = 30_000;
    /// 租约续期默认提前量（毫秒）。与实现本体的默认值一致。
    pub const DEFAULT_WORKER_LOCK_RENEWAL_BUFFER_MS: u64 = 5_000;

    /// 只调并发：租约用默认值（恢复最慢 30s 量级）。
    pub fn new(orchestration_concurrency: usize, worker_concurrency: usize) -> Self {
        Self::with_worker_lock_timeouts(
            orchestration_concurrency,
            worker_concurrency,
            Self::DEFAULT_WORKER_LOCK_TIMEOUT_MS,
            Self::DEFAULT_WORKER_LOCK_RENEWAL_BUFFER_MS,
        )
    }

    /// 连租约一起调。入参离谱时钳到合法区间（`timeout` 至少 1ms，`buffer` 至少比 `timeout`
    /// 小 1ms），免得把「配置写错了」变成运行时的 panic。
    pub fn with_worker_lock_timeouts(
        orchestration_concurrency: usize,
        worker_concurrency: usize,
        worker_lock_timeout_ms: u64,
        worker_lock_renewal_buffer_ms: u64,
    ) -> Self {
        let timeout = worker_lock_timeout_ms.max(1);
        Self {
            orchestration_concurrency: orchestration_concurrency.max(1),
            worker_concurrency: worker_concurrency.max(1),
            worker_lock_timeout_ms: timeout,
            worker_lock_renewal_buffer_ms: worker_lock_renewal_buffer_ms.min(timeout - 1),
        }
    }
}

impl Default for RuntimeTuning {
    /// 与实现本体的默认值一致：编排 2、活动 2、租约 30s。够用且不抢资源，按需再调。
    fn default() -> Self {
        Self::new(2, 2)
    }
}

/// duroxide 在 `session_idle_timeout <= worker_lock_timeout - worker_lock_renewal_buffer` 时
/// 直接 panic（它担心长活动期间 session 被解绑）。启动前照着它的公式算一遍：把 panic
/// 换成一条能看懂的启动错误。
fn ensure_lock_invariant(options: &RuntimeOptions) -> Result<(), DurableError> {
    let renewal_interval = options
        .worker_lock_timeout
        .checked_sub(options.worker_lock_renewal_buffer)
        .unwrap_or(Duration::from_secs(1));
    if options.session_idle_timeout <= renewal_interval {
        return Err(DurableError::Config(format!(
            "租约参数不合法：worker_lock_timeout_ms ({}) - worker_lock_renewal_buffer_ms ({}) \
             必须小于 session 空闲超时（{}ms）。请调小 worker_lock_timeout_ms，\
             或保留默认租约。",
            options.worker_lock_timeout.as_millis(),
            options.worker_lock_renewal_buffer.as_millis(),
            options.session_idle_timeout.as_millis(),
        )));
    }

    Ok(())
}

/// 可靠执行运行时：从存储里领活、重放历史、执行活动、写回结果。
///
/// 一个部署单元只应该有一个进程跑运行时（本仓库里是 `orchestrator` 二进制）：多个进程
/// 同时跑会把同一个实例的轮次抢来抢去（实现本体用锁保证正确性，但并行推进没有意义）。
/// 起实例（[`crate::Client`]）不受此限，任何进程都能起。
///
/// 进程重启后无需任何补偿动作：未完成的实例与待执行的活动都在存储里，运行时会接着跑。
pub struct Runtime {
    inner: Arc<DuroxideRuntime>,
}

impl Runtime {
    /// 起运行时并注册处理器。
    ///
    /// 处理器注册表有错（重名、保留名字）时返回 [`DurableError::Registration`]，不带病运行。
    pub async fn start(
        store: &Store,
        activities: Activities,
        orchestrations: Orchestrations,
        tuning: RuntimeTuning,
    ) -> Result<Self, DurableError> {
        let activities = activities.build()?;
        let orchestrations = orchestrations.build()?;

        let options = RuntimeOptions {
            orchestration_concurrency: tuning.orchestration_concurrency.max(1),
            worker_concurrency: tuning.worker_concurrency.max(1),
            worker_lock_timeout: Duration::from_millis(tuning.worker_lock_timeout_ms),
            worker_lock_renewal_buffer: Duration::from_millis(tuning.worker_lock_renewal_buffer_ms),
            ..Default::default()
        };
        ensure_lock_invariant(&options)?;

        let inner = DuroxideRuntime::start_with_options(
            store.provider_ref(),
            activities,
            orchestrations,
            options,
        )
        .await;

        Ok(Self { inner })
    }

    /// 停机：给在跑的活动 `grace_ms` 毫秒收尾（编排状态在存储里，收不完也不丢），
    /// 超时后强制中止。`grace_ms = 0` 表示立即中止——只有测试模拟「崩溃」时才这么用。
    pub async fn shutdown(&self, grace_ms: u64) {
        Arc::clone(&self.inner).shutdown(Some(grace_ms)).await;
    }
}

impl std::fmt::Debug for Runtime {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Runtime")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tuning_clamps_concurrency_and_lock_timeouts() {
        let tuning = RuntimeTuning::with_worker_lock_timeouts(0, 0, 0, 9_999);
        assert_eq!(tuning.orchestration_concurrency, 1);
        assert_eq!(tuning.worker_concurrency, 1);
        assert_eq!(tuning.worker_lock_timeout_ms, 1);
        assert_eq!(tuning.worker_lock_renewal_buffer_ms, 0);

        let tuning = RuntimeTuning::with_worker_lock_timeouts(4, 4, 3_000, 45_000);
        assert_eq!(tuning.worker_lock_timeout_ms, 3_000);
        assert_eq!(tuning.worker_lock_renewal_buffer_ms, 2_999);
    }

    #[test]
    fn default_tuning_matches_implementation_defaults() {
        let tuning = RuntimeTuning::default();
        assert_eq!(tuning.orchestration_concurrency, 2);
        assert_eq!(tuning.worker_concurrency, 2);
        assert_eq!(tuning.worker_lock_timeout_ms, 30_000);
        assert_eq!(tuning.worker_lock_renewal_buffer_ms, 5_000);
    }

    #[test]
    fn lock_invariant_rejects_oversized_lock_timeout() {
        let options = RuntimeOptions {
            worker_lock_timeout: Duration::from_secs(600),
            worker_lock_renewal_buffer: Duration::from_secs(5),
            ..Default::default()
        };
        let err = ensure_lock_invariant(&options).expect_err("must be rejected");
        assert!(err.to_string().contains("worker_lock_timeout_ms"));
    }

    #[test]
    fn lock_invariant_accepts_defaults_and_short_timeouts() {
        assert!(ensure_lock_invariant(&RuntimeOptions::default()).is_ok());

        let tight = RuntimeOptions {
            worker_lock_timeout: Duration::from_secs(3),
            worker_lock_renewal_buffer: Duration::from_millis(500),
            ..Default::default()
        };
        assert!(ensure_lock_invariant(&tight).is_ok());
    }
}
