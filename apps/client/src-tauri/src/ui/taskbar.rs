//! 任务栏占位（auto-hide 的补丁）。
//!
//! `monitor.work_area()` 在任务栏**自动隐藏**时仍等于整屏 —— 系统认为工作区没被占用，
//! 可鼠标一蹭到底边它就会弹出来，盖住贴边浮层的那几十个像素。截屏浮层按监视器铺满整屏、
//! 工具栏又跟着选区贴底走，于是「工具栏有概率跑到任务栏后面」。
//!
//! 所以除了工作区，还要知道「任务栏若探出来会占多厚」，由 `SHAppBarMessage` 回答：
//! `ABM_GETSTATE` 给出是否 auto-hide，`ABM_GETTASKBARPOS` 给出停靠边与注册矩形
//! （auto-hide 时这个矩形仍是完整尺寸，不是那 1~2px 的探出条）。

/// 任务栏停靠边
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Edge {
    Left,
    Top,
    Right,
    Bottom,
}

/// auto-hide 任务栏需要预留的厚度（**物理像素**）与停靠边。
///
/// 返回 `None` 表示不用预留：任务栏常驻（此时 `work_area()` 已经扣过）、没装任务栏，
/// 或者读回来的厚度不可信（个别版本给的是 1~2px 的探出条）。
#[cfg(windows)]
pub fn autohide_reserve() -> Option<(Edge, i32)> {
    use windows::Win32::UI::Shell::{
        ABE_LEFT, ABE_RIGHT, ABE_TOP, ABM_GETSTATE, ABM_GETTASKBARPOS, ABS_AUTOHIDE, APPBARDATA,
        SHAppBarMessage,
    };

    let size = std::mem::size_of::<APPBARDATA>() as u32;
    unsafe {
        let mut state = APPBARDATA {
            cbSize: size,
            ..Default::default()
        };
        if (SHAppBarMessage(ABM_GETSTATE, &mut state) as u32) & ABS_AUTOHIDE == 0 {
            return None;
        }

        let mut pos = APPBARDATA {
            cbSize: size,
            ..Default::default()
        };
        if SHAppBarMessage(ABM_GETTASKBARPOS, &mut pos) == 0 {
            return None;
        }
        let edge = match pos.uEdge {
            ABE_TOP => Edge::Top,
            ABE_LEFT => Edge::Left,
            ABE_RIGHT => Edge::Right,
            _ => Edge::Bottom,
        };
        let thickness = match edge {
            Edge::Top | Edge::Bottom => pos.rc.bottom - pos.rc.top,
            Edge::Left | Edge::Right => pos.rc.right - pos.rc.left,
        };
        // 1~2px 是「已收起的探出条」而不是真实厚度：按它预留等于没预留
        (thickness > 2).then_some((edge, thickness))
    }
}

#[cfg(not(windows))]
pub fn autohide_reserve() -> Option<(Edge, i32)> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_windows_never_reserves() {
        // 非 Windows 走 no-op 分支，保证调用点不用 cfg
        #[cfg(not(windows))]
        assert_eq!(autohide_reserve(), None);
    }
}
