use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicI64, Ordering};
use tokio::sync::Mutex;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OverlayMountPayload {
    pub kind: String,
    #[serde(rename = "magneticTileID")]
    pub magnetic_tile_id: String,
    pub size: Option<i32>,
    pub shape: Option<String>,
    pub direction: Option<String>,
    #[serde(default)]
    pub round: Option<String>,
    #[serde(default)]
    pub background: Option<Value>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub mark: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OverlayUnmountPayload {
    #[serde(rename = "magneticTileID")]
    pub magnetic_tile_id: String,
}

#[derive(Default)]
pub struct OverlayPending {
    pub mount: Mutex<Option<OverlayMountPayload>>,
    pub unmount: Mutex<Option<OverlayUnmountPayload>>,
}

/// 心跳超时：超过即判定 overlay 渲染进程已挂（白屏），宿主需要重载页面。
pub const PING_TIMEOUT_MS: i64 = 3 * 60 * 1000;

/// overlay 页面健康度：页面定时 `overlay:ping`，宿主在展示前据此判断是否要重载。
#[derive(Default)]
pub struct OverlayHealth {
    last_ping_ms: AtomicI64,
}

impl OverlayHealth {
    pub fn mark_ping(&self, now: i64) {
        self.last_ping_ms.store(now, Ordering::Relaxed);
    }

    pub fn last_ping(&self) -> i64 {
        self.last_ping_ms.load(Ordering::Relaxed)
    }

    pub fn is_stale(&self, now: i64) -> bool {
        is_stale(now, self.last_ping(), PING_TIMEOUT_MS)
    }
}

/// 心跳是否过期（纯函数，便于单测）。`last == 0` = 从未心跳，视为健康，
/// 避免冷启动/首次展示就被当成「挂了」而多一次重载。
pub fn is_stale(now: i64, last: i64, timeout: i64) -> bool {
    last != 0 && now.saturating_sub(last) > timeout
}

#[cfg(test)]
mod tests {
    use super::is_stale;

    #[test]
    fn stale_only_after_ping_timeout() {
        assert!(!is_stale(1_000_000, 0, 500), "从未心跳不算过期");
        assert!(!is_stale(1_000_000, 999_800, 500), "刚打过心跳");
        assert!(is_stale(1_000_000, 999_000, 500), "超时即过期");
    }
}
