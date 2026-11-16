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
//!
//! 但抢了就得还：把被顶掉的那个窗口记下来，退出截屏（`overlay_hide` / idle）时还回去，
//! 否则截完图直接打字是没反应的 —— 键盘那时候还在透明浮层上。

#[cfg(windows)]
use std::sync::Mutex;

use tauri::WebviewWindow;

/// 抢浮层前台之前的前台窗口句柄（`isize`；Windows 上就是 HWND）
#[cfg(windows)]
static PREVIOUS_FOREGROUND: Mutex<Option<isize>> = Mutex::new(None);

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

/// 把前台还给「抢之前那个窗口」。
///
/// 只在浮层**仍是**前台时还：用户已经点了别的应用就不能抢回去（那是打扰）。
/// 目标窗口关了 / 唤不起来也不算错，用户点一下就好。
pub fn restore_foreground(window: &WebviewWindow) {
    #[cfg(windows)]
    {
        let target = PREVIOUS_FOREGROUND
            .lock()
            .ok()
            .and_then(|mut guard| guard.take());
        if let Some(target) = target {
            windows_impl::restore(window, target);
        }
    }
    #[cfg(not(windows))]
    {
        let _ = window;
    }
}

#[cfg(windows)]
mod windows_impl {
    use tauri::WebviewWindow;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, HWND_TOPMOST, IsIconic,
        IsWindow, SW_RESTORE, SW_SHOW, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
        SetForegroundWindow, SetWindowPos, ShowWindow,
    };

    /// 把自己挂到 `target_thread` 的输入队列上执行 `action`，再解挂。
    ///
    /// 前台锁（`SetForegroundWindow` 只认「当前前台 / 刚收到输入」的进程）就靠这个绕：
    /// 挂上去之后两个线程共用一个输入队列，系统就当我们是同一个前台。
    unsafe fn with_attached_input<R>(target_thread: u32, action: impl FnOnce() -> R) -> R {
        let self_thread = unsafe { GetCurrentThreadId() };
        let attached = target_thread != 0
            && target_thread != self_thread
            && unsafe { AttachThreadInput(self_thread, target_thread, true) }.as_bool();
        let result = action();
        if attached {
            let _ = unsafe { AttachThreadInput(self_thread, target_thread, false) };
        }
        result
    }

    pub(super) fn force(window: &WebviewWindow) -> bool {
        let Ok(hwnd) = window.hwnd() else {
            return false;
        };
        unsafe {
            // 1) 复位置顶 + 显示：先抬 z 序再抢前台（抢到前台也会顺带抬高）
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
            remember(GetForegroundWindow(), hwnd);

            // 2) 前台锁绕行
            let foreground_thread = GetWindowThreadProcessId(GetForegroundWindow(), None);
            with_attached_input(foreground_thread, || {
                if !SetForegroundWindow(hwnd).as_bool() {
                    // 某些 Shell 状态下返回 false 但其实已切过去，以实测结果为准
                    let _ = BringWindowToTop(hwnd);
                }
            });

            GetForegroundWindow() == hwnd
        }
    }

    pub(super) fn restore(window: &WebviewWindow, target: isize) {
        let Ok(hwnd) = window.hwnd() else {
            return;
        };
        let target = HWND(target as *mut core::ffi::c_void);
        unsafe {
            // 用户已经点了别的应用：不抢
            if GetForegroundWindow() != hwnd || !IsWindow(Some(target)).as_bool() {
                return;
            }
            let target_thread = GetWindowThreadProcessId(target, None);
            with_attached_input(target_thread, || {
                let _ = SetForegroundWindow(target);
            });
        }
    }

    /// 记下「被我们顶掉的那个窗口」：多次重试不覆盖已记下的值，也不记自己。
    unsafe fn remember(previous: HWND, self_hwnd: HWND) {
        if previous == self_hwnd || previous.is_invalid() {
            return;
        }
        if let Ok(mut guard) = super::PREVIOUS_FOREGROUND.lock() {
            if guard.is_none() {
                *guard = Some(previous.0 as isize);
            }
        }
    }
}
