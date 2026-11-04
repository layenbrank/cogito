use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::{Mutex, oneshot};

use crate::capture::schema::ScreenshotResult;

#[derive(Default)]
pub struct CapturePending {
    pub screenshot: Mutex<Option<ScreenshotResult>>,
    /// 单飞闸门：上一次抓屏还没走完时，连按快捷键直接忽略（只出一张图）
    running: AtomicBool,
}

impl CapturePending {
    /// 抢到执行权返回 guard；已在执行中返回 `None`（调用方应当静默忽略本次）。
    ///
    /// 用 guard 而不是裸的 `try_begin` / `end`：`capture:open` 里的 `end()` 写在
    /// `capture_once(...).await` **之后**，命令 future 一旦被丢弃（overlay 重载、窗口关闭、
    /// Tauri 取消），`end()` 就不会执行，闸门永久停在 `true` —— 之后每次按热键都静默
    /// `Ok(())`，只能重启应用。复位交给 `Drop`，它一定跑。
    pub fn begin(&self) -> Option<PendingGuard<'_>> {
        if self.running.swap(true, Ordering::AcqRel) {
            return None;
        }
        Some(PendingGuard { owner: self })
    }

    fn release(&self) {
        self.running.store(false, Ordering::Release);
    }
}

/// 单飞闸门的持有者：`Drop` 时复位（panic / future 被丢弃都覆盖）。
pub struct PendingGuard<'a> {
    owner: &'a CapturePending,
}

impl Drop for PendingGuard<'_> {
    fn drop(&mut self) {
        self.owner.release();
    }
}

/// 截屏前/后的两次前端握手：
/// - `concealed`：DOM 已隐藏（替代固定 sleep，避免把磁贴/旧截屏 UI 拍进位图）
/// - `ready`：冻结帧已画上屏（避免 reveal 早于首帧，露出实时桌面）
///
/// `has_content` 由前端上报；截屏态下即使没有磁贴也要 conceal（否则会拍到上一次的截屏 UI）。
#[derive(Default)]
pub struct CaptureHandshake {
    has_content: AtomicBool,
    concealed_tx: Mutex<Option<oneshot::Sender<()>>>,
    ready_tx: Mutex<Option<oneshot::Sender<()>>>,
}

impl CaptureHandshake {
    pub fn set_has_content(&self, has: bool) {
        self.has_content.store(has, Ordering::Relaxed);
    }

    pub fn has_content(&self) -> bool {
        self.has_content.load(Ordering::Relaxed)
    }

    pub async fn arm_concealed(&self, tx: oneshot::Sender<()>) {
        *self.concealed_tx.lock().await = Some(tx);
    }

    pub async fn take_concealed(&self) -> Option<oneshot::Sender<()>> {
        self.concealed_tx.lock().await.take()
    }

    pub async fn arm_ready(&self, tx: oneshot::Sender<()>) {
        *self.ready_tx.lock().await = Some(tx);
    }

    pub async fn take_ready(&self) -> Option<oneshot::Sender<()>> {
        self.ready_tx.lock().await.take()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guard_holds_the_slot_until_dropped() {
        let pending = CapturePending::default();
        {
            let guard = pending.begin();
            assert!(guard.is_some(), "首次应抢到闸门");
            assert!(pending.begin().is_none(), "执行中不能再抢");
        }
        assert!(
            pending.begin().is_some(),
            "guard drop 之后必须能再次抢到（否则热键永久失效）"
        );
    }

    #[test]
    fn guard_releases_slot_even_when_dropped_mid_flight() {
        let pending = CapturePending::default();
        let guard = pending.begin().expect("首次应抢到");
        // 模拟命令 future 被丢弃（窗口重载 / Tauri 取消）：没有显式 end()
        drop(guard);
        assert!(pending.begin().is_some(), "取消路径也必须复位闸门");
    }
}
