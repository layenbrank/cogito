//! 日志按时间保留：插件仅支持按文件数轮转，启动时清理超期文件。

use std::fs;
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Manager};

/// 保留最近 30 天内的日志文件。
pub const LOG_RETENTION_DAYS: u64 = 30;

/// 单文件上限（字节），超出后轮转为带日期后缀的归档。
pub const LOG_MAX_FILE_SIZE: u128 = 5_000_000; // 5MB：一次崩溃前后的上下文能完整落在一两个文件里

/// 删除 `app_log_dir` 中修改时间早于保留期的 `.log` / `.log.bak`。
pub fn prune_stale_logs(app: &AppHandle) {
    let Ok(dir) = app.path().app_log_dir() else {
        return;
    };
    if !dir.is_dir() {
        return;
    }

    let Some(cutoff) = SystemTime::now().checked_sub(Duration::from_secs(
        LOG_RETENTION_DAYS.saturating_mul(24 * 60 * 60),
    )) else {
        return;
    };

    let Ok(entries) = fs::read_dir(&dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !(name.ends_with(".log") || name.ends_with(".log.bak")) {
            continue;
        }

        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let Ok(modified) = meta.modified() else {
            continue;
        };
        if modified < cutoff {
            let _ = fs::remove_file(&path);
        }
    }
}
