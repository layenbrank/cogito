//! 系统 git 的唯一 spawn 点（S5 加固）。
//!
//! 为什么集中在这里：`git` 会执行仓库配置里指定的**任意程序**——`core.fsmonitor`
//! 的钩子进程、`diff.external` / `textconv` 的外部命令、`core.hooksPath` 里的
//! pre-commit、`ext::` 传输协议。工作区是用户从磁盘上打开的东西，可能来自 clone 别人
//! 的仓库，`git status` 一次就能把它带起来。所以：
//!
//! 1. 所有调用都带同一组 `-c` 降权配置（`core.fsmonitor=false` / `core.pager=cat` /
//!    `core.hooksPath=<空目录>`）；
//! 2. 所有调用都带同一组 env（`GIT_CONFIG_NOSYSTEM=1` / `GIT_TERMINAL_PROMPT=0` /
//!    `GIT_OPTIONAL_LOCKS=0` / `GIT_EXTERNAL_DIFF` 置空 / `GIT_ALLOW_PROTOCOL` 白名单）；
//! 3. `diff` / `log` / `show` / `whatchanged` 一律追加 `--no-ext-diff`，默认还追加
//!    `--no-textconv`（要看 textconv 结果得显式 `COGITO_GIT_ALLOW_TEXTCONV=1`）。
//!
//! 例外只有一个：`safe.directory` 由调用方决定（用户显式打开的工作区视为可信，
//! 对齐 VS Code「信任工作区」之后的 Git 行为）。

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use cogito_core::{CommandResult, Exception};
use tokio::process::Command;

use super::path::path_for_safe_directory;

/// 带外部程序执行面的子命令：必须关掉 `diff.external` / `textconv`
const DIFF_LIKE: [&str; 4] = ["diff", "log", "show", "whatchanged"];

/// 关掉「每次调用都可能顺手跑一个进程」的配置项
const HARDENED_CONFIGS: [(&str, &str); 2] = [
    // fsmonitor 钩子会在每次 status 时被拉起；仓库配置里写什么就执行什么
    ("core.fsmonitor", "false"),
    // GUI 里不该出现分页器
    ("core.pager", "cat"),
];

const HARDENED_ENVS: [(&str, &str); 6] = [
    // 不吃系统级 /etc/gitconfig（企业机上可能挂外部过滤器）
    ("GIT_CONFIG_NOSYSTEM", "1"),
    // 没有 TTY，任何要提示的操作（凭据、确认）都直接失败而不是挂住
    ("GIT_TERMINAL_PROMPT", "0"),
    // 只读探询不要抢 index.lock，避免和用户自己的 git 打架
    ("GIT_OPTIONAL_LOCKS", "0"),
    ("GIT_PAGER", "cat"),
    // 空串 = 没有外部 diff 程序
    ("GIT_EXTERNAL_DIFF", ""),
    // 白名单里没有 ext::（ext::sh -c ... 等于任意命令执行）
    ("GIT_ALLOW_PROTOCOL", "file:git:http:https:ssh"),
];

/// 显式放行 textconv 的开关（默认关）。textconv 会在 diff 时执行仓库里配置的程序，
/// 只有用户自己确认要看「渲染后的二进制差异」时才该打开。
const TEXTCONV_ENV: &str = "COGITO_GIT_ALLOW_TEXTCONV";

/// 空 hooks 目录：把 `core.hooksPath` 指到这里，仓库里的 pre-commit 就不会被 GUI 触发。
///
/// 目录必须在磁盘上存在，否则 git 每次都会打一行 hint。创建失败就退化为「不加这条配置」
/// ——那也比让命令直接失败强。
fn empty_hooks_dir() -> Option<&'static Path> {
    static DIR: OnceLock<Option<PathBuf>> = OnceLock::new();
    DIR.get_or_init(|| {
        let dir = std::env::temp_dir().join("cogito-git-hooks-empty");
        std::fs::create_dir_all(&dir).ok()?;
        Some(dir)
    })
    .as_deref()
}

fn textconv_allowed() -> bool {
    std::env::var(TEXTCONV_ENV)
        .map(|value| {
            let trimmed = value.trim();
            trimmed == "1" || trimmed.eq_ignore_ascii_case("true")
        })
        .unwrap_or(false)
}

/// 找出真正的子命令：跳过 `-c` / `-C` / `--git-dir` / `--work-tree` 这些
/// 「后面跟一个值」的选项，剩下的第一个非 `-` 参数就是子命令。
fn find_subcommand(args: &[String]) -> Option<&str> {
    let mut skip_value = false;
    for arg in args {
        if skip_value {
            skip_value = false;
            continue;
        }
        if matches!(arg.as_str(), "-c" | "-C" | "--git-dir" | "--work-tree") {
            skip_value = true;
            continue;
        }
        if arg.starts_with('-') {
            continue;
        }
        return Some(arg.as_str());
    }
    None
}

/// 把调用方的参数拼成「实际要执行的 argv + 要注入的 env」。
///
/// 抽成纯函数是为了能在单测里断言——真起 git 进程测不出「有没有带 `--no-ext-diff`」。
fn assemble(cwd: &Path, args: &[String]) -> (Vec<String>, Vec<(&'static str, &'static str)>) {
    assemble_with(cwd, args, textconv_allowed())
}

fn assemble_with(
    cwd: &Path,
    args: &[String],
    allow_textconv: bool,
) -> (Vec<String>, Vec<(&'static str, &'static str)>) {
    let mut argv: Vec<String> = Vec::with_capacity(args.len() + 8);
    // safe.directory 放在最前面：它是「信任这个工作区」的显式声明
    argv.push("-c".to_string());
    argv.push(format!("safe.directory={}", path_for_safe_directory(cwd)));
    for (key, value) in HARDENED_CONFIGS {
        argv.push("-c".to_string());
        argv.push(format!("{key}={value}"));
    }
    if let Some(dir) = empty_hooks_dir() {
        argv.push("-c".to_string());
        argv.push(format!("core.hooksPath={}", dir.to_string_lossy()));
    }

    let subcommand = find_subcommand(args).unwrap_or_default();
    let mut extras: Vec<&'static str> = Vec::new();
    if DIFF_LIKE.contains(&subcommand) {
        extras.push("--no-ext-diff");
        if !allow_textconv {
            extras.push("--no-textconv");
        }
    }

    let mut inserted = false;
    for arg in args {
        argv.push(arg.clone());
        if !inserted && arg == subcommand {
            for extra in &extras {
                argv.push((*extra).to_string());
            }
            inserted = true;
        }
    }

    (argv, HARDENED_ENVS.to_vec())
}

/// 构造一条加固过的 `git` 命令（不执行）。`workspaceFiles` 这类一次性的
/// `rev-parse` / `ls-files` 也走这里，免得两处各写一份 env。
pub(crate) fn command(cwd: &Path, args: &[&str]) -> Command {
    let owned: Vec<String> = args.iter().map(|arg| (*arg).to_string()).collect();
    let (argv, envs) = assemble(cwd, &owned);
    let mut command = Command::new("git");
    command.args(&argv).current_dir(cwd);
    for (key, value) in envs {
        command.env(key, value);
    }
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

async fn spawn_git(cwd: &Path, args: &[String]) -> CommandResult<std::process::Output> {
    command(cwd, &args.iter().map(String::as_str).collect::<Vec<_>>())
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

/// 读取 blob / 文件内容：不要 trim，否则会吃掉文件首尾空白与末尾换行。
pub async fn run_git_bytes(cwd: &Path, args: &[String]) -> CommandResult<(bool, Vec<u8>, String)> {
    let output = spawn_git(cwd, args).await?;
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Ok((output.status.success(), output.stdout, stderr))
}

pub async fn run_git(cwd: &Path, args: &[&str]) -> CommandResult<(bool, String, String)> {
    let owned: Vec<String> = args.iter().map(|item| (*item).to_string()).collect();
    run_git_args(cwd, &owned).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|item| (*item).to_string()).collect()
    }

    fn contains_pair(argv: &[String], key: &str, value: &str) -> bool {
        argv.windows(2)
            .any(|pair| pair[0] == "-c" && pair[1] == format!("{key}={value}"))
    }

    #[test]
    fn diff_like_commands_disable_external_diff_and_textconv() {
        for subcommand in DIFF_LIKE {
            let (argv, _) = assemble_with(
                Path::new("C:/repo"),
                &args(&[subcommand, "--", "a.txt"]),
                false,
            );
            let position = argv
                .iter()
                .position(|arg| arg == subcommand)
                .expect("subcommand");
            assert_eq!(
                argv[position + 1],
                "--no-ext-diff",
                "{subcommand}: {argv:?}"
            );
            assert_eq!(
                argv[position + 2],
                "--no-textconv",
                "{subcommand}: {argv:?}"
            );
        }
    }

    #[test]
    fn textconv_can_be_opted_in_but_ext_diff_stays_off() {
        let (argv, _) = assemble_with(Path::new("C:/repo"), &args(&["diff", "HEAD"]), true);
        assert!(argv.iter().any(|arg| arg == "--no-ext-diff"));
        assert!(!argv.iter().any(|arg| arg == "--no-textconv"));
    }

    #[test]
    fn status_is_not_polluted_with_diff_flags() {
        let (argv, _) = assemble_with(
            Path::new("C:/repo"),
            &args(&["status", "--porcelain=v1", "-z"]),
            false,
        );
        assert!(!argv.iter().any(|arg| arg == "--no-ext-diff"));
        assert!(!argv.iter().any(|arg| arg == "--no-textconv"));
        assert_eq!(argv.last().map(String::as_str), Some("-z"));
    }

    #[test]
    fn hardened_configs_are_always_present() {
        let (argv, envs) = assemble_with(Path::new("C:/repo"), &args(&["status"]), false);
        assert!(contains_pair(&argv, "core.fsmonitor", "false"), "{argv:?}");
        assert!(contains_pair(&argv, "core.pager", "cat"), "{argv:?}");
        // safe.directory 由调用方的工作区决定，这里是它被换成当前 cwd
        assert!(
            argv.windows(2)
                .any(|pair| pair[0] == "-c" && pair[1] == "safe.directory=C:/repo"),
            "{argv:?}"
        );
        // hooksPath 必须指向一个真实存在（且为空）的目录
        if let Some(dir) = empty_hooks_dir() {
            assert!(dir.is_dir(), "{} 不存在", dir.display());
            assert!(contains_pair(
                &argv,
                "core.hooksPath",
                &dir.to_string_lossy()
            ));
        }
        assert!(
            envs.iter()
                .any(|(key, value)| *key == "GIT_CONFIG_NOSYSTEM" && *value == "1")
        );
        assert!(
            envs.iter()
                .any(|(key, value)| *key == "GIT_TERMINAL_PROMPT" && *value == "0")
        );
        assert!(envs.iter().any(|(key, _)| *key == "GIT_EXTERNAL_DIFF"));
        assert!(
            envs.iter()
                .any(|(key, value)| *key == "GIT_ALLOW_PROTOCOL" && !value.contains("ext"))
        );
    }

    #[test]
    #[test]
    fn skip_value_options_do_not_confuse_subcommand_detection() {
        let (argv, _) = assemble_with(
            Path::new("C:/repo"),
            &args(&["-c", "user.name=t", "diff", "--cached"]),
            false,
        );
        let position = argv
            .iter()
            .position(|arg| arg == "diff")
            .expect("subcommand");
        assert_eq!(argv[position + 1], "--no-ext-diff", "{argv:?}");
    }

    #[test]
    fn arguments_after_the_subcommand_keep_their_order() {
        let (argv, _) = assemble_with(
            Path::new("C:/repo"),
            &args(&["log", "--pretty=%H", "-n", "20", "--", "src"]),
            false,
        );
        let tail: Vec<&str> = argv
            .iter()
            .skip_while(|arg| arg.as_str() != "log")
            .map(String::as_str)
            .collect();
        assert_eq!(
            tail,
            vec![
                "log",
                "--no-ext-diff",
                "--no-textconv",
                "--pretty=%H",
                "-n",
                "20",
                "--",
                "src"
            ]
        );
    }

    /// 真起 git，验证「恶意仓库配置也跑不起来外部程序」——
    /// `assemble` 的单测只能断言 argv，这里断言**副作用**（标记文件没被创建）。
    #[tokio::test]
    async fn hostile_repo_config_cannot_execute_external_commands() {
        let root = std::env::temp_dir().join(format!("cogito-git-probe-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("建临时目录");

        run_git(&root, &["init"]).await.expect("git init");
        run_git(&root, &["config", "user.name", "probe"])
            .await
            .expect("user.name");
        run_git(&root, &["config", "user.email", "probe@example.com"])
            .await
            .expect("user.email");
        std::fs::write(root.join("a.txt"), "one\n").expect("写文件");
        run_git(&root, &["add", "a.txt"]).await.expect("git add");
        run_git(&root, &["commit", "-m", "one"])
            .await
            .expect("git commit");

        // 恶意配置：外部 diff、textconv、fsmonitor 全指向「会写标记文件」的命令
        #[cfg(windows)]
        const PROBE: &str = "cmd /c echo pwned>pwned.flag";
        #[cfg(not(windows))]
        const PROBE: &str = "sh -c 'echo pwned>pwned.flag'";
        run_git(&root, &["config", "diff.external", PROBE])
            .await
            .expect("diff.external");
        run_git(&root, &["config", "diff.probe.textconv", PROBE])
            .await
            .expect("diff.probe.textconv");
        run_git(&root, &["config", "core.fsmonitor", PROBE])
            .await
            .expect("core.fsmonitor");
        std::fs::write(root.join(".gitattributes"), "* diff=probe\n").expect("gitattributes");

        let (ok, _out, err) = run_git(&root, &["diff", "HEAD"]).await.expect("git diff");
        assert!(ok, "diff 失败: {err}");
        let (ok, _out, err) = run_git(&root, &["status", "--porcelain"])
            .await
            .expect("git status");
        assert!(ok, "status 失败: {err}");

        let leaked = root.join("pwned.flag").exists();
        let _ = std::fs::remove_dir_all(&root);
        assert!(
            !leaked,
            "仓库配置里的外部程序被执行了（--no-ext-diff / --no-textconv / core.fsmonitor=false 失效）"
        );
    }
}
