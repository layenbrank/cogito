//! 时钟工具（毫秒时间戳）。

use std::time::{SystemTime, UNIX_EPOCH};

/// 当前 UTC 毫秒时间戳；系统时钟异常时回落 0。
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
