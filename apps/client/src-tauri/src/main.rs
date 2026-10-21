// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write;
use std::path::{Path, PathBuf};

/// 与 `tauri.conf.json` 的 `identifier` 一致；helper 在 Tauri 启动前跑，只能靠它定位 appData。
const APP_IDENTIFIER: &str = "com.cogito.client";

fn main() {
    // goose 自定义 provider 的 `auth.command` 指向主程序自身（`--token-helper`）：
    // 读 `<appData>/cogito/jwt` 输出令牌后立即退出，不拉起 Tauri。
    if run_token_helper() {
        return;
    }
    thinking::app::bootstrap::Bootstrap::run();
}

/// 固定 JWT 路径：`%APPDATA%/<identifier>/cogito/jwt`（与 `cogito_token::cogito_jwt_path` 对齐）。
fn expected_jwt_path() -> Option<PathBuf> {
    let base = dirs::data_dir()?;
    Some(base.join(APP_IDENTIFIER).join("cogito").join("jwt"))
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
        eprintln!("i-thinking-token: cannot resolve app data dir");
        std::process::exit(1);
    };

    if let Some(ref requested) = file {
        if !paths_refer_same(Path::new(requested), &expected) {
            eprintln!(
                "i-thinking-token: --file must be {}",
                expected.display()
            );
            std::process::exit(1);
        }
    }

    let token = match std::fs::read_to_string(&expected) {
        Ok(content) => content.trim().to_string(),
        Err(error) => {
            eprintln!("i-thinking-token: read {}: {error}", expected.display());
            std::process::exit(1);
        }
    };
    if token.is_empty() {
        eprintln!("i-thinking-token: {} is empty", expected.display());
        std::process::exit(1);
    }

    let mut stdout = std::io::stdout().lock();
    if stdout.write_all(token.as_bytes()).is_err() || stdout.flush().is_err() {
        std::process::exit(1);
    }
    true
}
