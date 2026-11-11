// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write;
use std::path::{Path, PathBuf};

// helper 在 Tauri 启动前跑，拿不到 `AppHandle`，只能按 identifier 自己推 appData；
// identifier 由 `cogito::utils::instance` 统一给出（正式包 / 隔离 dev 实例）。

fn main() {
    // goose 自定义 provider 的 `auth.command` 指向主程序自身（`--token-helper`）：
    // 读 `<appData>/cogito/jwt` 输出令牌后立即退出，不拉起 Tauri。
    if run_token_helper() {
        return;
    }
    // 必须早于 Tauri 与日志插件：release 下 `windows_subsystem = "windows"` 没有 stderr，
    // 只有先装 hook，panic 现场才会落到 `<appLocalData>/diagnostics/crash/`。
    cogito::utils::diagnostics::install_panic_hook();
    cogito::app::bootstrap::Bootstrap::run();
}

/// 固定 JWT 路径：`%APPDATA%/<identifier>/cogito/jwt`（与 `cogito_token::cogito_jwt_path` 对齐）。
fn expected_jwt_path() -> Option<PathBuf> {
    let base = cogito::utils::instance::app_data_dir()?;
    Some(base.join("cogito").join("jwt"))
}

/// `--file` 的结构校验（宽松版）：`<appData>/<identifier>/cogito/jwt`，且 identifier
/// 以 `com.cogito.client` 开头。
///
/// 正式包走 [`expected_jwt_path`] 的精确比对；这里覆盖隔离 dev 实例
/// （`com.cogito.client.dev`）——`auth.command` 里的 `--file` 是启动时烧进去的绝对
/// 路径，helper 只确认它仍在 appData 下的 cogito 目录里，别被改写成读任意本地文件。
fn is_allowed_jwt_path(path: &Path) -> bool {
    if path.file_name().and_then(|name| name.to_str()) != Some("jwt") {
        return false;
    }
    if path
        .parent()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        != Some("cogito")
    {
        return false;
    }
    let Some(identifier_dir) = path.parent().and_then(Path::parent) else {
        return false;
    };
    let Some(identifier) = identifier_dir.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    if !identifier.starts_with("com.cogito.client") {
        return false;
    }
    match dirs::data_dir() {
        Some(base) => paths_refer_same(identifier_dir, &base.join(identifier)),
        None => false,
    }
}

fn paths_refer_same(a: &Path, b: &Path) -> bool {
    match (std::path::absolute(a), std::path::absolute(b)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

/// goose 的命令鉴权 helper：stdout 输出 trim 后的令牌（goose 会拼成 `Bearer <token>`），
/// 文件缺失/为空/读失败则写 stderr 并以非零码退出。返回 `true` 表示「本次就是 helper 调用」。
///
/// 只读规范后的 `<appData>/cogito/jwt`；若传了 `--file` 必须与该路径一致，否则拒绝
/// （防止 `custom_providers` JSON 被改写成读任意本地文件）。
fn run_token_helper() -> bool {
    let args: Vec<String> = std::env::args().collect();
    if !args.iter().any(|arg| arg == "--token-helper") {
        return false;
    }

    let mut file: Option<String> = None;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--file" => {
                file = args.get(i + 1).cloned();
                i += 2;
            }
            "--token-helper" => i += 1,
            _ => i += 1,
        }
    }

    let Some(expected) = expected_jwt_path() else {
        eprintln!("cogito-token: cannot resolve app data dir");
        std::process::exit(1);
    };

    if let Some(ref requested) = file {
        let requested = Path::new(requested);
        if !paths_refer_same(requested, &expected) && !is_allowed_jwt_path(requested) {
            eprintln!("cogito-token: --file must be {}", expected.display());
            std::process::exit(1);
        }
    }

    let token = match std::fs::read_to_string(&expected) {
        Ok(content) => content.trim().to_string(),
        Err(error) => {
            eprintln!("cogito-token: read {}: {error}", expected.display());
            std::process::exit(1);
        }
    };
    if token.is_empty() {
        eprintln!("cogito-token: {} is empty", expected.display());
        std::process::exit(1);
    }

    let mut stdout = std::io::stdout().lock();
    if stdout.write_all(token.as_bytes()).is_err() || stdout.flush().is_err() {
        std::process::exit(1);
    }
    true
}
