use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::{Mutex, oneshot};

use crate::capture::schema::ScreenshotResult;

#[derive(Default)]
pub struct CapturePending {
    pub screenshot: Mutex<Option<ScreenshotResult>>,
}

/// overlay 是否有可见内容（磁贴/贴图）；无内容时截屏前无需 conceal。
/// `ack_tx` 承载「conceal → 前端 DOM 隐藏确认」握手，替代固定 sleep。
#[derive(Default)]
pub struct CaptureConceal {
    has_content: AtomicBool,
    ack_tx: Mutex<Option<oneshot::Sender<()>>>,
}

impl CaptureConceal {
    pub fn set_has_content(&self, has: bool) {
        self.has_content.store(has, Ordering::Relaxed);
    }

    pub fn has_content(&self) -> bool {
        self.has_content.load(Ordering::Relaxed)
    }

    pub async fn arm_ack(&self, tx: oneshot::Sender<()>) {
        *self.ack_tx.lock().await = Some(tx);
    }

    pub async fn take_ack(&self) -> Option<oneshot::Sender<()>> {
        self.ack_tx.lock().await.take()
    }
}
