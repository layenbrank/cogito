//! 桥令牌的落盘与校验（S2「令牌不出进程」）。
//!
//! 为什么要把 token 写文件：`cogito-mcp` 是**独立进程**，它必须拿到令牌才能调桥。
//! 以前这条链路是 `bridge:info` 把 token 交给渲染进程，再由渲染进程塞进 MCP 的 env ——
//! 于是任何能读前端内存/日志的代码都拿到了「以用户身份执行任意命令」的凭据（桥之上挂着
//! `app_terminal_run`）。现在改成：token 由 Rust 进程写进 `<appLocalData>/bridge/token`
//! （仅当前用户可读），`bridge:info` 只回**文件路径**，MCP 自己读文件。
//!
//! 附带两道小加固：
//! - 令牌比较用等长逐字节累积（避免按前缀提前返回的时序差）；
//! - 会话绑定：桥侧维护「已登记会话」集合，MCP 每个请求带 `x-cogito-session`，
//!   未登记/缺失的会话即使拿到 token 也调不动工具（防止一份 token 被跨会话复用）。
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// 落盘文件名：`<appLocalData>/bridge/token`。
const TOKEN_DIR: &str = "bridge";
const TOKEN_FILE: &str = "token";

/// 令牌文件路径（不保证存在）。
pub fn token_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("获取应用数据目录失败: {error}"))?;
    Ok(base.join(TOKEN_DIR).join(TOKEN_FILE))
}

/// 写令牌并收紧权限；返回最终路径。
///
/// 写入顺序：临时文件 → 收紧权限 → rename 覆盖。这样 MCP 永远读不到半截令牌
/// （rename 在同一分区上是原子的）。
pub fn write_token(app: &AppHandle, token: &str) -> Result<PathBuf, String> {
    let path = token_path(app)?;
    write_token_to(&path, token)?;
    Ok(path)
}

/// 可测的落盘实现：给定路径写入 + 收紧权限。
pub fn write_token_to(path: &Path, token: &str) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| "令牌文件路径没有父目录".to_string())?;
    fs::create_dir_all(dir).map_err(|error| format!("创建桥目录失败: {error}"))?;

    let tmp = path.with_extension("token.tmp");
    {
        let mut file =
            fs::File::create(&tmp).map_err(|error| format!("创建令牌临时文件失败: {error}"))?;
        file.write_all(token.as_bytes())
            .map_err(|error| format!("写入令牌失败: {error}"))?;
        file.flush()
            .map_err(|error| format!("flush 令牌失败: {error}"))?;
    }
    // 先在临时文件上收紧：rename 不改 ACL，先设好就不会出现「窗口期内谁都能读」。
    restrict_permissions(&tmp)?;
    fs::rename(&tmp, path).map_err(|error| format!("原子替换令牌失败: {error}"))?;
    restrict_permissions(path)?;
    Ok(())
}

/// 读取令牌（MCP 侧用；测试也复用它）。去掉首尾空白 —— 顺手兼容手写的换行。
pub fn read_token(path: &Path) -> Result<String, String> {
    let raw = fs::read_to_string(path).map_err(|error| format!("读取令牌失败: {error}"))?;
    let token = raw.trim().to_string();
    if token.is_empty() {
        return Err("令牌文件为空".to_string());
    }
    Ok(token)
}

/// 等长逐字节比较（避免 `!=` 按前缀提前返回）。
pub fn token_matches(expected: &str, got: &str) -> bool {
    let a = expected.as_bytes();
    let b = got.as_bytes();
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (left, right) in a.iter().zip(b.iter()) {
        diff |= left ^ right;
    }
    diff == 0
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("设置令牌文件权限失败: {error}"))
}

#[cfg(windows)]
fn restrict_permissions(path: &Path) -> Result<(), String> {
    restrict_windows(path)
}

#[cfg(windows)]
fn restrict_windows(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;

    use windows::Win32::Foundation::{CloseHandle, HANDLE, HLOCAL, LocalFree};
    use windows::Win32::Security::Authorization::{
        EXPLICIT_ACCESS_W, GRANT_ACCESS, NO_MULTIPLE_TRUSTEE, SE_FILE_OBJECT, SetEntriesInAclW,
        SetNamedSecurityInfoW, TRUSTEE_IS_SID, TRUSTEE_IS_USER, TRUSTEE_W,
    };
    use windows::Win32::Security::{
        ACL, DACL_SECURITY_INFORMATION, GetTokenInformation, NO_INHERITANCE,
        PROTECTED_DACL_SECURITY_INFORMATION, TOKEN_QUERY, TOKEN_USER, TokenUser,
    };
    use windows::Win32::Storage::FileSystem::FILE_ALL_ACCESS;
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    use windows::core::PWSTR;

    // 1. 当前进程令牌里的用户 SID
    let mut token = HANDLE::default();
    unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) }
        .map_err(|error| format!("取进程令牌失败: {error}"))?;

    let mut needed = 0u32;
    let _ = unsafe { GetTokenInformation(token, TokenUser, None, 0, &mut needed) };
    if needed == 0 {
        let _ = unsafe { CloseHandle(token) };
        return Err("取当前用户 SID 长度失败".to_string());
    }
    let mut buffer = vec![0u8; needed as usize];
    let filled = unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            Some(buffer.as_mut_ptr() as *mut core::ffi::c_void),
            needed,
            &mut needed,
        )
    };
    let _ = unsafe { CloseHandle(token) };
    filled.map_err(|error| format!("取当前用户 SID 失败: {error}"))?;
    let sid = unsafe { (*(buffer.as_ptr() as *const TOKEN_USER)).User.Sid };

    // 2. 只给当前用户 FULL，且不继承父目录 ACE
    let entry = EXPLICIT_ACCESS_W {
        grfAccessPermissions: FILE_ALL_ACCESS.0,
        grfAccessMode: GRANT_ACCESS,
        grfInheritance: NO_INHERITANCE,
        Trustee: TRUSTEE_W {
            pMultipleTrustee: std::ptr::null_mut(),
            MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
            TrusteeForm: TRUSTEE_IS_SID,
            TrusteeType: TRUSTEE_IS_USER,
            ptstrName: PWSTR(sid.0 as *mut u16),
        },
    };

    let mut acl: *mut ACL = std::ptr::null_mut();
    unsafe { SetEntriesInAclW(Some(&[entry]), None, &mut acl) }
        .ok()
        .map_err(|error| format!("构造令牌 DACL 失败: {error}"))?;

    let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    wide.push(0);
    let result = unsafe {
        SetNamedSecurityInfoW(
            windows::core::PCWSTR(wide.as_ptr()),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            None,
            None,
            Some(acl),
            None,
        )
    };
    let _ = unsafe { LocalFree(Some(HLOCAL(acl as *mut core::ffi::c_void))) };
    result
        .ok()
        .map_err(|error| format!("设置令牌 DACL 失败: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("cogito-bridge-token-tests");
        let _ = fs::create_dir_all(&dir);
        dir.join(name)
    }

    #[test]
    fn writes_reads_and_trims_token() {
        let path = scratch("plain/token");
        write_token_to(&path, "  abc-123\n").expect("write token");
        assert_eq!(read_token(&path).expect("read token"), "abc-123");
        let _ = fs::remove_dir_all(path.parent().expect("parent"));
    }

    #[test]
    fn empty_token_file_is_an_error() {
        let path = scratch("empty/token");
        write_token_to(&path, "   ").expect("write token");
        assert!(read_token(&path).is_err());
        let _ = fs::remove_dir_all(path.parent().expect("parent"));
    }

    #[test]
    fn token_compare_is_exact() {
        assert!(token_matches("abc", "abc"));
        assert!(!token_matches("abc", "abd"));
        assert!(!token_matches("abc", "abcd"));
        assert!(!token_matches("abc", ""));
    }

    #[cfg(windows)]
    #[test]
    fn windows_dacl_keeps_only_one_ace() {
        let path = scratch("dacl/token");
        write_token_to(&path, "secret").expect("write token");
        assert_eq!(
            dacl_ace_count(&path),
            Some(1),
            "令牌文件只应保留当前用户一条 ACE"
        );
        let _ = fs::remove_dir_all(path.parent().expect("parent"));
    }

    /// 读回文件 DACL 的 ACE 数量（默认继承 + 本机其它组都会在这里现形）。
    #[cfg(windows)]
    fn dacl_ace_count(path: &Path) -> Option<u32> {
        use std::os::windows::ffi::OsStrExt;

        use windows::Win32::Foundation::{HLOCAL, LocalFree};
        use windows::Win32::Security::Authorization::{GetNamedSecurityInfoW, SE_FILE_OBJECT};
        use windows::Win32::Security::{
            ACL, ACL_SIZE_INFORMATION, AclSizeInformation, DACL_SECURITY_INFORMATION,
            GetAclInformation,
        };

        let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
        wide.push(0);
        let mut dacl: *mut ACL = std::ptr::null_mut();
        let mut security_descriptor =
            windows::Win32::Security::PSECURITY_DESCRIPTOR(std::ptr::null_mut());
        let status = unsafe {
            GetNamedSecurityInfoW(
                windows::core::PCWSTR(wide.as_ptr()),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                None,
                None,
                Some(&mut dacl),
                None,
                &mut security_descriptor,
            )
        };
        if status.0 != 0 || dacl.is_null() {
            return None;
        }
        let mut info = ACL_SIZE_INFORMATION::default();
        let ok = unsafe {
            GetAclInformation(
                dacl,
                (&raw mut info).cast(),
                std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32,
                AclSizeInformation,
            )
        };
        let _ = unsafe { LocalFree(Some(HLOCAL(security_descriptor.0))) };
        ok.ok().map(|()| info.AceCount)
    }
}
