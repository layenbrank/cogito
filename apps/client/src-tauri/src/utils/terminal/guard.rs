//! 会话闸门：同一会话的 `terminal:run` 串行执行 + 闲置回收用的忙碌标记。
//!
//! 为什么需要：
//! - **输出污染**：会话按 cwd 派生，同一目录两次 `terminal:run` 会落进同一个 shell。
//!   两条命令交叉写入时，`read_since(start_cursor)` 会把别人的输出算进本次结果。
//!   闸门让同名会话的 run **串行**（排队而不是并发写入）。
//! - **误杀**：闲置回收不能关掉正在跑长命令的会话，所以要有一个「当前有 run 在跑」的
//!   轻量计数，且必须在 `await` 期间保持（用 RAII 守卫，panic 也能减回去）。
//!
//! 闸门只覆盖 `terminal:run`（非交互写）；用户手打的 `terminal:write` 不排队。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::Mutex as AsyncMutex;

/// agent 会话闲置多久自动关闭。用户主动开出来的 tab 不受这条约束。
pub const IDLE_TTL: Duration = Duration::from_secs(30 * 60);

static GATES: Mutex<Option<HashMap<String, Arc<AsyncMutex<()>>>>> = Mutex::new(None);

/// 取会话闸门：同 id 永远拿到同一个 `Arc`，不同 id 互不影响。
pub fn session_gate(id: &str) -> Arc<AsyncMutex<()>> {
    let mut guard = match GATES.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let map = guard.get_or_insert_with(HashMap::new);
    map.entry(id.to_string())
        .or_insert_with(|| Arc::new(AsyncMutex::new(())))
        .clone()
}

/// 会话被移除时顺手丢掉闸门，避免长跑应用里一直攒空锁。
pub fn forget_session(id: &str) {
    let mut guard = match GATES.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(map) = guard.as_mut() {
        map.remove(id);
    }
}

static BUSY: Mutex<Option<HashMap<String, usize>>> = Mutex::new(None);

fn busy_map() -> std::sync::MutexGuard<'static, Option<HashMap<String, usize>>> {
    match BUSY.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// 一个 run 的忙碌标记（RAII）：进入时 +1，离开时 -1。
pub struct BusyMark {
    id: String,
}

impl BusyMark {
    pub fn enter(id: &str) -> Self {
        let mut guard = busy_map();
        let map = guard.get_or_insert_with(HashMap::new);
        *map.entry(id.to_string()).or_insert(0) += 1;
        Self { id: id.to_string() }
    }
}

impl Drop for BusyMark {
    fn drop(&mut self) {
        let mut guard = busy_map();
        let Some(map) = guard.as_mut() else {
            return;
        };
        if let Some(count) = map.get_mut(&self.id) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                map.remove(&self.id);
            }
        }
    }
}

/// 这个会话现在有没有 run 在跑（闲置回收据此跳过）。
pub fn is_busy(id: &str) -> bool {
    let guard = busy_map();
    guard
        .as_ref()
        .and_then(|map| map.get(id).copied())
        .unwrap_or(0)
        > 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_run_serialized_same_session() {
        let first = session_gate("agent:D:\\w");
        let second = session_gate("agent:D:\\w");
        assert!(Arc::ptr_eq(&first, &second), "同一会话必须共用一个闸门");
        let other = session_gate("agent:D:\\other");
        assert!(!Arc::ptr_eq(&first, &other), "不同会话不能互相阻塞");
    }

    #[test]
    fn busy_mark_counts_and_clears() {
        let id = "agent:busy-test";
        assert!(!is_busy(id));
        {
            let _one = BusyMark::enter(id);
            assert!(is_busy(id), "进入后算忙");
            let _two = BusyMark::enter(id);
            assert!(is_busy(id));
        }
        assert!(!is_busy(id), "全部离开后必须清零（可被闲置回收）");
    }
}
