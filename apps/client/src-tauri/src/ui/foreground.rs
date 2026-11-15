//! 把浮层顶到前台：绕开 Windows 前台锁 + 重新排到 topmost 带最上层。
//!
//! 事故形态：截屏热键从**后台进程**触发（用户当时在别的应用里），
//! `capture_once` 还要先 conceal → 抓帧 → 发布 pending，最后才切模式。
//! 到这时 `window.set_focus()` 里的 `SetForegroundWindow` 很可能被前台锁静默拒绝：
//! 浮层拿不到激活 ⇒ WebView2 恢复不了合成（页面一直停在 hidden）⇒
//! 表现为「按了快捷键没有遮罩、没有窗口吸附，点一下鼠标才出来」。
//!
//! 两件事在这里一起做：
//!
//! 1. **复位置顶**：`SetWindowPos(HWND_TOPMOST)` 把浮层抬到 topmost 带的最上面。
//!    任务栏同样是 topmost，谁最后 `SetWindowPos` 谁在上面 —— 不重抬的话，
//!    贴屏幕底部的工具栏会被任务栏压住（任务栏置顶设置下「工具栏在任务栏后面」就是这么来的）。
//! 2. **抢前台**：`AttachThreadInput` 把自己的线程挂到当前前台窗口的输入队列上，
//!    `SetForegroundWindow` 在这之后才不会被锁挡住；失败再 `BringWindowToTop` 兜一次。
//!
//! 返回值是「是否**确认**成为前台窗口」，调用方据此打日志 —— 静默失败是最难查的一类问题。

use tauri::WebviewWindow;

/// 让窗口成为前台窗口并置于 topmost 最上层；返回是否确认成功。
pub fn force_foreground(window: &WebviewWindow) -> bool {
    #[cfg(windows)]
    {
        windows_impl::force(window)
    }
    #[cfg(not(windows))]
    {
        let _ = window.set_focus();
        window.is_focused().unwrap_or(false)
    }
}

#[cfg(windows)]
mod windows_impl {
    use tauri::WebviewWindow;
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, HWND_TOPMOST, IsIconic,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_RESTORE, SW_SHOW,
        SetForegroundWindow, SetWindowPos, ShowWindow,
    };

    pub(super) fn force(window: &WebviewWindow) -> bool {
        let Ok(hwnd) = window.hwnd() else {
            return false;
        };
        unsafe {
            // 1) 复位置顶 + 显示：顺序固定，先抬 z 序再抢前台（抢到前台也会顺带抬高）
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_NOACTIVATE,
            );
            let _ = ShowWindow(hwnd, SW_SHOW);
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }
            if GetForegroundWindow() == hwnd {
                return true;
            }

            // 2) 前台锁绕行：挂到当前前台窗口的输入队列上
            let foreground = GetForegroundWindow();
            let foreground_thread = GetWindowThreadProcessId(foreground, None);
            let self_thread = GetCurrentThreadId();
            let attached = foreground_thread != 0
                && foreground_thread != self_thread
                && AttachThreadInput(self_thread, foreground_thread, true).as_bool();
            let activated = SetForegroundWindow(hwnd).as_bool();
            if !activated {
                // 某些 Shell 状态下 SetForegroundWindow 返回 false 但其实已经切过去了，
                // 以 `GetForegroundWindow` 的实测结果为准
                let _ = BringWindowToTop(hwnd);
            }
            if attached {
                let _ = AttachThreadInput(self_thread, foreground_thread, false);
            }

            GetForegroundWindow() == hwnd
        }
    }
}
