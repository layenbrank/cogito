//! Windows Job Object：把 sidecar 子进程绑到宿主的生命周期上。
//!
//! 为什么需要：`panic = "unwind"` 只能保证 Rust 侧 panic 走 `RunEvent::Exit`，
//! 枚举到的还有三种「没有收尾机会」的退出：
//!
//! 1. `std::process::abort()`（第三方库 abort、或我们自己的兜底）；
//! 2. 任务管理器 / 安装器 / 蓝屏前的强制结束；
//! 3. 原生层崩溃（WebView2、显卡驱动、Rust 之外的 C++ 代码）。
//!
//! 这几种情况下没有 `RunEvent::Exit`，`corex-daemon` 与 `goose serve` 会留下来
//! 占住管道、端口和几百 MB 内存 —— 用户看到的就是「主程序退了，后台还在转」。
//!
//! Job Object 的 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 由内核兜底：Job 的最后一个
//! 句柄关闭时，Job 内所有进程一律被杀。句柄由宿主进程持有，宿主无论怎么死，
//! 内核都会关掉它 → 整棵子进程树被回收。正常退出仍走 `shutdown_and_wait`
//! 的优雅路径（先 IPC shutdown，再 kill），Job 只是最后一道保险。
//!
//! 只在 Windows 生效；其它平台保留同名空实现，调用点不用 `cfg`。

/// 把 `pid` 纳入全局 Job（`KILL_ON_JOB_CLOSE`）。
///
/// 尽力而为：拿不到进程句柄、子进程已在别的 Job 里等情况只记 warn，
/// 不阻断启动 —— 优雅退出路径仍然覆盖这些场景。
pub fn adopt(pid: u32, label: &str) {
    imp::adopt(pid, label)
}

/// Job 是否可用（单测/诊断用）。
pub fn is_available() -> bool {
    imp::ensure_job().is_some()
}

#[cfg(not(windows))]
mod imp {
    pub fn adopt(_pid: u32, _label: &str) {}

    pub fn ensure_job() -> Option<()> {
        None
    }
}

#[cfg(windows)]
mod imp {
    use std::sync::OnceLock;

    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    /// 进程级 Job 句柄（存成 `usize` 以便放进 `OnceLock`，避免裸指针跨线程）。
    /// 故意不实现关闭：句柄要活到进程结束，这正是 `KILL_ON_JOB_CLOSE` 的前提。
    static JOB: OnceLock<usize> = OnceLock::new();

    fn create_job() -> Option<HANDLE> {
        unsafe {
            let handle = CreateJobObjectW(None, None).ok()?;
            if handle.is_invalid() {
                return None;
            }

            let mut limit = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limit.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

            if let Err(error) = SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limit as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) {
                let _ = CloseHandle(handle);
                tracing::warn!(target: "sidecar", "创建 Job Object 失败，子进程回收退回正常退出路径: {error}");
                return None;
            }

            Some(handle)
        }
    }

    pub fn ensure_job() -> Option<HANDLE> {
        let raw = *JOB.get_or_init(|| {
            create_job()
                .map(|handle| handle.0 as usize)
                .unwrap_or_default()
        });
        if raw == 0 {
            return None;
        }
        Some(HANDLE(raw as *mut core::ffi::c_void))
    }

    pub fn adopt(pid: u32, label: &str) {
        if pid == 0 {
            return;
        }
        let Some(job) = ensure_job() else {
            return;
        };

        unsafe {
            let process = match OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) {
                Ok(process) => process,
                Err(error) => {
                    tracing::warn!(target: "sidecar", "{label} (pid={pid}) 打开进程失败，未能纳入 Job: {error}");
                    return;
                }
            };
            let assigned = AssignProcessToJobObject(job, process);
            let _ = CloseHandle(process);

            match assigned {
                Ok(()) => tracing::info!(
                    target: "sidecar",
                    "{label} (pid={pid}) 已纳入 Job：主进程被强杀时由内核回收"
                ),
                Err(error) => tracing::warn!(
                    target: "sidecar",
                    "{label} (pid={pid}) 纳入 Job 失败（退回正常退出回收）: {error}"
                ),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adopt_ignores_zero_pid() {
        // 0 是无效 pid：只允许「静默跳过」，绝不能 panic
        adopt(0, "test");
    }

    #[test]
    #[cfg(windows)]
    fn job_is_created_on_windows() {
        assert!(
            is_available(),
            "Windows 上应能创建 KILL_ON_JOB_CLOSE 的 Job"
        );
    }
}
