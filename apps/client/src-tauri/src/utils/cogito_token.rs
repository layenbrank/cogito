//! cogito 网关 token 的落盘与清理。
//!
//! goose 的自定义 provider 用 `auth.command`（token helper）来读令牌 —— 那个 helper 是
//! 独立进程，读不到渲染进程的 Web Storage，所以登录/刷新时这里把令牌**原子**写一份到
//! `<appData>/cogito/jwt`，退出登录时清掉。helper 只读这一个文件。
use std::fs;
use std::io::Write;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// JWT 文件路径：`<appData>/cogito/jwt`。
///
/// 用 `app_data_dir`（%APPDATA%）而不是 local：它随用户漫游，与「这台机器上的身份」语义
/// 一致；goose provider 的 `auth.command` 在创建时把这个路径作为 `--file` 参数烧进去。
pub fn cogito_jwt_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?;
    Ok(base.join("cogito").join("jwt"))
}

/// 原子写入：先写临时文件再改名，避免 goose 读到一个写了一半的令牌。
pub fn write_jwt(app: &AppHandle, token: &str) -> Result<(), String> {
    let path = cogito_jwt_path(app)?;
    let dir = path
        .parent()
        .ok_or_else(|| "JWT 文件路径没有父目录".to_string())?;
    fs::create_dir_all(dir).map_err(|e| format!("创建 cogito 目录失败: {e}"))?;

    let tmp = path.with_extension("jwt.tmp");
    {
        let mut file =
            fs::File::create(&tmp).map_err(|e| format!("创建 JWT 临时文件失败: {e}"))?;
        file.write_all(token.as_bytes())
            .map_err(|e| format!("写入 JWT 失败: {e}"))?;
        file.flush().map_err(|e| format!("flush JWT 失败: {e}"))?;
    }
    fs::rename(&tmp, &path).map_err(|e| format!("原子替换 JWT 失败: {e}"))?;
    Ok(())
}

/// 退出登录时清掉；文件本就不存在也算成功（幂等）。
pub fn clear_jwt(app: &AppHandle) -> Result<(), String> {
    let path = cogito_jwt_path(app)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("删除 JWT 文件失败: {e}")),
    }
}
