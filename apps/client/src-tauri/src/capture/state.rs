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
    /// 抢到执行权返回 true；已在执行中返回 false（调用方应当静默忽略本次）
    pub fn try_begin(&self) -> bool {
        !self.running.swap(true, Ordering::AcqRel)
    }

    pub fn end(&self) {
        self.running.store(false, Ordering::Release);
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
