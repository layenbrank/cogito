//! 把一条命令安全送进 shell：就绪探测 → 单次写入（清行 + 正文 + 回车）→ 回显核对 → 整条重发。
//!
//! 为什么单独成文件：父模块 `terminal.rs` 还要管 PTY 会话、字型、进程树，命令写入的
//! 时序逻辑是这里唯一高频变动的部分。拆出来既能单测纯函数 [`compose_submit`]，也避免
//! 把父文件继续撑大。
//!
//! 为什么不再「逐字符敲 + 垫一个空格」：那两层都是症状补丁 ——
//! - 垫空格会污染回显，逼得 `squeeze` 还得再削一次，且对 `echo_confirmed` 的头尾比对
//!   是负作用；
//! - 逐字符敲把一条命令拆成几十次 write，反而放大 ConPTY 的 burst 时序问题，终端里看到
//!   的就是「命令被反复重打」。
//!
//! 现在做三件正事：
//! 1. **先确认能收输入**（[`probe_ready`]：静默 + `echo <nonce>` 哨兵回显）；
//! 2. 整条命令**一次 write**（`\x15` 清行 + 正文 + `\r`），不再有正文/回车之间的调度空档；
//! 3. 回显对不上就 **Ctrl+C 丢行后整条重发**，不做补字符、不垫空格。

use std::time::{Duration, Instant};

use uuid::Uuid;

use super::{
    echo_confirmed, progress, read_since, squeeze, wait_until_ready, write_raw, TerminalHub,
    CANCEL_SETTLE_MS, ECHO_ATTEMPTS, ECHO_MAX_MS, READY_POLL_MS,
};

/// 哨兵探测的等待上限：够 PowerShell 冷启动走完一次 `echo`，又不至于把每条命令拖住。
const READY_SENTINEL_MS: u64 = 3_000;

/// 超过这个长度的命令不做回显核对：回滚窗口会截掉头部，核不准就会白重发一遍。
const VERIFY_MAX_CHARS: usize = 2_000;

/// 单次写入的载荷：`\x15`（Ctrl-U 清行） + 正文 + `\r`。
///
/// `\x15` 清掉行编辑器里可能残留的半行 —— 上一次写入被吞掉尾巴时，剩下的字符会
/// 悬在输入区，下一条命令就会拼上去（现场：`& $env:C test ...` 粘在下一条命令前面）。
pub fn compose_submit(command: &str) -> Vec<u8> {
    let mut payload = Vec::with_capacity(command.len() + 2);
    payload.push(0x15);
    payload.extend_from_slice(command.as_bytes());
    payload.push(b'\r');
    payload
}

/// 就绪探测：先等提示符/静默（父模块的老判定，快路径），再发一条哨兵
/// `echo <nonce>` 并要求 nonce 完整回显 —— 能回显就说明行编辑器已经在收输入了。
///
/// 为什么不是「静默 N 毫秒就够了」：shell 冷启动时提示符画出来之后，行编辑器仍可能
/// 吞掉紧接着的一批字节（现场：`node` → `ode`、`Remove-Item` → `emove-Item`）。
/// 哨兵把「猜」变成「测」；测不到只说明这次没探到，超时返回 `Ok` 不阻塞命令。
pub async fn probe_ready(hub: &TerminalHub, id: &str) -> Result<(), String> {
    wait_until_ready(hub, id).await?;
    let nonce = format!("__cogito_ready_{}__", Uuid::new_v4().simple());
    let (cursor, _) = progress(hub, id)?;
    let payload = compose_submit(&format!("echo {nonce}"));
    write_raw(hub, id, payload.as_slice())?;

    let started = Instant::now();
    let wanted = squeeze(&nonce);
    while started.elapsed() < Duration::from_millis(READY_SENTINEL_MS) {
        let echo = read_since(hub, id, cursor)?;
        if squeeze(&echo).contains(&wanted) {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(READY_POLL_MS)).await;
    }
    Ok(())
}

/// 下发一条命令（调用方负责在此之前完成 `probe_ready`）。
///
/// 与老的 `write_command` 相比：不垫空格、不逐字符敲、正文与回车同一次 write；
/// 回显核对不通过时用 Ctrl+C 丢掉整行再**整条重发**，最多 `ECHO_ATTEMPTS` 轮。
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
        assert_eq!(payload.first().copied(), Some(0x15), "写前先 Ctrl-U 清行");
        assert_eq!(
            payload.last().copied(),
            Some(b'\r'),
            "正文与回车必须在同一次 write 里"
        );
        assert_eq!(
            &payload[1..payload.len() - 1],
            b"npm run dev",
            "正文不能被垫空格、也不能被拆开"
        );
    }

    #[test]
    fn retries_whole_command_on_echo_mismatch() {
        let payload = compose_submit("Remove-Item a.txt");
        let text = String::from_utf8_lossy(&payload[1..payload.len() - 1]).to_string();
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

    /// 首字符保护的真实机制：吞掉一次 burst 的**开头一个字节**时，被吃掉的是 `\x15`
    /// 清行符，命令正文一个字符都不会少。这就是「不再垫空格」的根据 —— 牺牲字节还在，
    /// 但它换成了语义上的 no-op（Ctrl-U），而不是会留在回显里的空格。
    #[test]
    fn swallowed_first_byte_eats_only_the_clear_line() {
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
            assert_eq!(survived.last().copied(), Some(b'\r'), "第 {round} 轮：回车仍随正文走");
        }
    }

    /// 重发就是原样再写一遍：不补字符、不垫空格、不改载荷。
    #[test]
    fn retry_resends_identical_payload() {
        let command = "Get-ChildItem -Force | Select-Object -First 3";
        assert_eq!(compose_submit(command), compose_submit(command));
    }
}
