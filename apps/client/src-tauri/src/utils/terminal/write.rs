//! 把一条命令安全送进 shell：就绪等待 → 单次写入（正文 + 回车）→ 回显核对 → 整条重发。
//!
//! 为什么单独成文件：父模块 `terminal.rs` 还要管 PTY 会话、字型、进程树，命令写入的
//! 时序逻辑是这里唯一高频变动的部分。拆出来既能单测纯函数 [`compose_submit`]，也避免
//! 把父文件继续撑大。
//!
//! 两条现场踩出来的硬约束：
//! - **正文前不许塞 Ctrl-U（`0x15`）**：Windows 版 pwsh 的 PSReadLine 在默认编辑模式
//!   下并没有绑 Ctrl-U，这个字节会被原样插进输入行（回显成 `^U`）并粘在第一个 token
//!   前面 —— `echo hi` 于是变成 `\x15echo hi`，PowerShell 报「The term 'echo' is not
//!   recognized」，连 `$env:PATH`、`C:\Windows\System32\cmd.exe` 这种写法也一起失效
//!   （现场：agent 下发的每条命令都「not recognized」，看起来像终端坏了）。
//!   要清掉悬着的半行只能用 Ctrl+C（`\x03`），也就是 [`submit_command`] 重发前那一步。
//! - **不逐字符敲**：一条命令拆成几十次 write 会放大 ConPTY 的 burst 时序问题，终端里
//!   看到的就是「命令被反复重打」。
//!
//! 正文前只垫**一个空格**：跨 shell（pwsh / bash）语义上是 no-op，又正好接住「burst
//! 吞掉第一个字节」的现场（`node` → `ode`）；回显核对走 [`crate::utils::terminal::squeeze`]
//! 抹掉空白，所以这个空格不干扰比对。

use std::time::{Duration, Instant};

use super::{
    CANCEL_SETTLE_MS, ECHO_ATTEMPTS, ECHO_MAX_MS, READY_POLL_MS, TerminalHub, echo_confirmed,
    progress, read_since, wait_until_ready, write_raw,
};

/// 超过这个长度的命令不做回显核对：回滚窗口会截掉头部，核不准就会白重发一遍。
const VERIFY_MAX_CHARS: usize = 2_000;

/// 单次写入的载荷：一个前导空格 + 正文 + `\r`。
///
/// 前导空格只做两件事：接住 ConPTY 偶尔吞掉的首字节、在 `HISTCONTROL=ignorespace` 的
/// bash 里顺带不记历史。它**不是**清行手段 —— 清行靠 `\x03`，见 [`submit_command`]。
pub fn compose_submit(command: &str) -> Vec<u8> {
    let mut payload = Vec::with_capacity(command.len() + 2);
    payload.push(b' ');
    payload.extend_from_slice(command.as_bytes());
    payload.push(b'\r');
    payload
}

/// 就绪等待：等 shell 画出第一帧提示符、或上一条命令安静下来再写
/// （提示符重绘期间塞进去的字符会被吞掉）。
///
/// 早先这里还会发一条 `echo <nonce>` 哨兵，实测「行编辑器能不能收输入」。已删除：
/// 它每跑一条命令就在用户终端里留一行 `echo __cogito_ready_…__` 垃圾，而且依赖 `echo`
/// 这个别名 —— 别名/模块没加载时探针自己就报「not recognized」，反而把终端刷满红字。
/// 吞字节改由 [`submit_command`] 的回显核对 + 整条重发兜底。
pub async fn probe_ready(hub: &TerminalHub, id: &str) -> Result<(), String> {
    wait_until_ready(hub, id).await
}

/// 下发一条命令（调用方负责在此之前完成 `probe_ready`）。
///
/// 单次写入、正文与回车同批；回显核对不通过时用 Ctrl+C 丢掉整行再**整条重发**，
/// 最多 `ECHO_ATTEMPTS` 轮。不补字符、不逐字符敲。
pub async fn submit_command(hub: &TerminalHub, id: &str, command: &str) -> Result<(), String> {
    let verifiable = command.chars().count() <= VERIFY_MAX_CHARS;
    for attempt in 1..=ECHO_ATTEMPTS {
        if attempt > 1 {
            // 上一轮没核对上：Ctrl+C 丢掉整行（半行、还没被读取的缓冲输入都清得掉）
            write_raw(hub, id, b"\x03")?;
            tokio::time::sleep(Duration::from_millis(CANCEL_SETTLE_MS)).await;
        }
        let (cursor, _) = progress(hub, id)?;
        let payload = compose_submit(command);
        write_raw(hub, id, payload.as_slice())?;
        if !verifiable {
            return Ok(());
        }
        if await_echo_confirmed(hub, id, cursor, command).await? {
            return Ok(());
        }
    }
    // 始终核对不过：命令已经发出去了，再重发只会重复执行；把真实回显留给调用方
    Ok(())
}

/// 等回显落定：有回显且首尾特征串都在就立刻返回，否则等到 `ECHO_MAX_MS` 判否。
async fn await_echo_confirmed(
    hub: &TerminalHub,
    id: &str,
    cursor: u64,
    command: &str,
) -> Result<bool, String> {
    let started = Instant::now();
    loop {
        let echo = read_since(hub, id, cursor)?;
        if echo_confirmed(&echo, command) {
            return Ok(true);
        }
        if started.elapsed() >= Duration::from_millis(ECHO_MAX_MS) {
            return Ok(false);
        }
        tokio::time::sleep(Duration::from_millis(READY_POLL_MS)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_command_single_write() {
        let payload = compose_submit("npm run dev");
        assert_eq!(payload.first().copied(), Some(b' '), "正文前只垫一个空格");
        assert_eq!(
            payload.last().copied(),
            Some(b'\r'),
            "正文与回车必须在同一次 write 里"
        );
        assert_eq!(
            &payload[1..payload.len() - 1],
            b"npm run dev",
            "正文不能被拆开、也不能多垫字符"
        );
    }

    /// 回归守卫：0x15 会让 pwsh 把命令当成未知命令（`\x15echo hi` → not recognized）。
    #[test]
    fn never_prefixes_ctrl_u() {
        for command in [
            "echo hi",
            "$env:PATH",
            "Test-Path C:\\x",
            "git status --porcelain=v1",
        ] {
            let payload = compose_submit(command);
            assert!(
                !payload.contains(&0x15),
                "载荷里不许出现 Ctrl-U（0x15）：{command}"
            );
            assert!(
                !payload[1..payload.len() - 1]
                    .iter()
                    .any(|byte| *byte < 0x20 && *byte != b'\t'),
                "命令正文里不许夹控制字符：{command}"
            );
        }
    }

    #[test]
    fn retries_whole_command_on_echo_mismatch() {
        let text = String::from_utf8_lossy(&compose_submit("Remove-Item a.txt")[1..]).to_string();
        let text = text.trim_end_matches('\r').to_string();
        assert!(
            !echo_confirmed("emove-Item a.txt", &text),
            "吞掉首字符的回显不能算确认（否则就不会触发整条重发）"
        );
        assert!(
            echo_confirmed(&format!("PS C:\\> {text}\r\n"), &text),
            "完整回显才算确认"
        );
    }

    #[test]
    fn compose_submit_keeps_command_verbatim() {
        let payload = compose_submit("echo 中文 && echo done");
        let body = String::from_utf8(payload[1..payload.len() - 1].to_vec()).expect("utf8");
        assert_eq!(body, "echo 中文 && echo done");
    }

    /// 首字符保护的真实机制：吞掉一次 burst 的**开头一个字节**时，被吃掉的是前导空格，
    /// 命令正文一个字符都不会少。这就是「垫空格」而不是「垫 Ctrl-U」的根据 ——
    /// 空格在 echo 里被 `squeeze` 抹掉，Ctrl-U 却会被 PowerShell 当成命令名的一部分。
    #[test]
    fn swallowed_first_byte_eats_only_the_leading_space() {
        for round in 0..20 {
            let command = format!("npm --version # round-{round}");
            let payload = compose_submit(&command);
            let survived = &payload[1..];
            assert_eq!(
                survived.first().copied(),
                Some(b'n'),
                "第 {round} 轮：吞掉首字节后正文首字符必须还在"
            );
            let text = String::from_utf8_lossy(&survived[..survived.len() - 1]).to_string();
            assert_eq!(text, command, "第 {round} 轮：正文必须逐字完好");
            assert_eq!(
                survived.last().copied(),
                Some(b'\r'),
                "第 {round} 轮：回车仍随正文走"
            );
        }
    }

    /// 重发就是原样再写一遍：不补字符、不垫额外字符、不改载荷。
    #[test]
    fn retry_resends_identical_payload() {
        let command = "Get-ChildItem -Force | Select-Object -First 3";
        assert_eq!(compose_submit(command), compose_submit(command));
    }
}
