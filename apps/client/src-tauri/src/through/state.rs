use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use serde::Deserialize;
use tokio::sync::RwLock;

/// Interactive rectangle reported by the frontend (CSS / logical pixels from
/// `getBoundingClientRect()`, matching the webview client area origin).
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Rect {
    pub fn contains(&self, px: i32, py: i32) -> bool {
        px >= self.x && px < self.x + self.w && py >= self.y && py < self.y + self.h
    }
}

pub struct ThroughState {
    pub window_label: String,
    /// Hit regions keyed by panel/source id so multiple overlays can coexist.
    pub sources: RwLock<HashMap<String, Vec<Rect>>>,
    /// When true, the overlay window never ignores cursor events (screenshot mode).
    screenshot_mode: AtomicBool,
    /// 期望穿透态每被改写一次就 +1。
    ///
    /// worker 用它作废自己的 `last_ignore` 缓存：UIA 探针的 `ClickThrough` guard 会临时
    /// 改 `ignore_cursor_events`，若它落在 worker 之后又把状态改回去，worker 会因为
    /// 「缓存 == 期望值」而不再纠正 —— 全屏透明窗一直吃点击（用户「点哪都没反应」）。
    generation: AtomicU64,
}

impl ThroughState {
    pub fn new(window_label: impl Into<String>) -> Self {
        Self {
            window_label: window_label.into(),
            sources: RwLock::new(HashMap::new()),
            screenshot_mode: AtomicBool::new(false),
            generation: AtomicU64::new(0),
        }
    }

    pub fn is_screenshot_mode(&self) -> bool {
        self.screenshot_mode.load(Ordering::Relaxed)
    }

    pub fn set_screenshot_mode(&self, enabled: bool) {
        self.screenshot_mode.store(enabled, Ordering::Relaxed);
        // 模式变了，穿透期望态一定变了：让 worker 立刻重算
        self.reapply();
    }

    /// 当前代次（worker 每轮比对）
    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::Acquire)
    }

    /// 作废 worker 的缓存，要求它下一轮无条件重算并下发
    pub fn reapply(&self) {
        self.generation.fetch_add(1, Ordering::AcqRel);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generation_only_moves_forward() {
        let state = ThroughState::new("overlay");
        let start = state.generation();

        state.reapply();
        let after_reapply = state.generation();
        assert!(after_reapply > start, "reapply 必须推进代次");

        state.set_screenshot_mode(true);
        let after_mode = state.generation();
        assert!(after_mode > after_reapply, "切换模式也必须推进代次");

        state.set_screenshot_mode(false);
        assert!(state.generation() > after_mode);
        assert!(!state.is_screenshot_mode());
    }
}
