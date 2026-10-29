use std::path::Path;

use cogito_core::{CommandResult, Exception};
use tokio::process::Command;

use super::path::path_for_safe_directory;

async fn spawn_git(cwd: &Path, args: &[String]) -> CommandResult<std::process::Output> {
    // 用户显式打开的工作区视为可信：对齐 VS Code「信任工作区」后可操作 Git。
    let safe = path_for_safe_directory(cwd);
    let mut full_args = Vec::with_capacity(args.len() + 2);
    full_args.push("-c".to_string());
    full_args.push(format!("safe.directory={safe}"));
    full_args.extend(args.iter().cloned());

    let mut command = Command::new("git");
    command.args(&full_args).current_dir(cwd);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
        .output()
        .await
        .map_err(|err| Exception::Internal(format!("无法执行 git：{err}")))
}

pub async fn run_git_args(cwd: &Path, args: &[String]) -> CommandResult<(bool, String, String)> {
    let output = spawn_git(cwd, args).await?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Ok((output.status.success(), stdout, stderr))
}

/// 读取 blob / 文件内容：不能 trim，否则会吃掉文件首尾空白与末尾换行。
pub async fn run_git_bytes(cwd: &Path, args: &[String]) -> CommandResult<(bool, Vec<u8>, String)> {
    let output = spawn_git(cwd, args).await?;
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Ok((output.status.success(), output.stdout, stderr))
}

pub async fn run_git(cwd: &Path, args: &[&str]) -> CommandResult<(bool, String, String)> {
    let owned: Vec<String> = args.iter().map(|item| (*item).to_string()).collect();
    run_git_args(cwd, &owned).await
}
