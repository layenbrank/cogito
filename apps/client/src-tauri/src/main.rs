// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write;

fn main() {
    // goose 自定义 provider 的 `auth.command` 指向主程序自身（`--token-helper`）：
    // 读 `<appData>/cogito/jwt` 输出令牌后立即退出，不拉起 Tauri。
    if run_token_helper() {
        return;
    }
    thinking::app::bootstrap::Bootstrap::run();
}

/// goose 的命令鉴权 helper：stdout 输出 trim 后的令牌（goose 会拼成 `Bearer <token>`），
/// 文件缺失/为空/读失败则写 stderr 并以非零码退出。返回 `true` 表示「本次就是 helper 调用」。
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

    let Some(file) = file else {
        eprintln!("i-thinking-token: missing --file <path>");
        std::process::exit(1);
    };

    let token = match std::fs::read_to_string(&file) {
        Ok(content) => content.trim().to_string(),
        Err(error) => {
            eprintln!("i-thinking-token: read {file}: {error}");
            std::process::exit(1);
        }
    };
    if token.is_empty() {
        eprintln!("i-thinking-token: {file} is empty");
        std::process::exit(1);
    }

    let mut stdout = std::io::stdout().lock();
    if stdout.write_all(token.as_bytes()).is_err() || stdout.flush().is_err() {
        std::process::exit(1);
    }
    true
}
