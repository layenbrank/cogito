//! PTY 原始字节 → 纯文本：去 ANSI 转义、归一换行、按字符截尾。
//!
//! agent 要读的是「命令跑了什么」，不是终端渲染效果；把颜色 / 光标控制码原样塞给模型
//! 只会白烧 token，也不便于它判断成败，所以这里统一清掉。

/// 去掉 CSI（`ESC [ ... 终止字节`）、OSC / DCS（`ESC ] ... BEL|ST`）等转义序列，
/// `\r\n` 归一成 `\n`，单独的 `\r`（行内重绘）也当换行。
#[must_use]
pub fn strip_ansi(bytes: &[u8]) -> String {
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        let byte = bytes[index];

        if byte == 0x1b {
            index += 1;
            match bytes.get(index) {
                // CSI：参数到 0x40..=0x7e 的终止字节为止
                Some(b'[') => {
                    index += 1;
                    while index < bytes.len() && !(0x40..=0x7e).contains(&bytes[index]) {
                        index += 1;
                    }
                    if index < bytes.len() {
                        index += 1;
                    }
                }
                // OSC / DCS / APC / PM：吃到 BEL 或 ST（`ESC \`）
                Some(b']' | b'P' | b'_' | b'^') => {
                    index += 1;
                    while index < bytes.len() {
                        if bytes[index] == 0x07 {
                            index += 1;
                            break;
                        }
                        if bytes[index] == 0x1b && bytes.get(index + 1) == Some(&b'\\') {
                            index += 2;
                            break;
                        }
                        index += 1;
                    }
                }
                // 单字节转义（如 `ESC c` 重置）
                Some(_) => index += 1,
                None => {}
            }
            continue;
        }

        match byte {
            b'\r' => {
                // CRLF 只留一个换行；孤立的 CR 是行内重绘，按换行处理更可读
                if bytes.get(index + 1) != Some(&b'\n') {
                    out.push(b'\n');
                }
                index += 1;
            }
            // 退格：被删掉的字符不该出现在给模型看的文本里
            0x08 => index += 1,
            b'\t' | b'\n' => {
                out.push(byte);
                index += 1;
            }
            // 其余控制字符（响铃 / 光标开关等）一律丢弃
            0x00..=0x1f => index += 1,
            _ => {
                out.push(byte);
                index += 1;
            }
        }
    }

    String::from_utf8_lossy(&out).into_owned()
}

/// 只保留最后 `max_chars` 个字符；截断时在开头留一行说明，模型才知道前面还有内容。
#[must_use]
pub fn tail_chars(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim_end();
    if max_chars == 0 {
        return String::new();
    }
    let total = trimmed.chars().count();
    if total <= max_chars {
        return trimmed.to_string();
    }
    let skipped = total - max_chars;
    let tail: String = trimmed.chars().skip(skipped).collect();
    format!("…（前面省略 {skipped} 个字符）\n{tail}")
}

#[cfg(test)]
mod tests {
    use super::{strip_ansi, tail_chars};

    #[test]
    fn strips_color_and_cursor_sequences() {
        let raw = b"\x1b[32mok\x1b[0m\r\n\x1b[?25ldone\x1b[?25h";
        assert_eq!(strip_ansi(raw), "ok\ndone");
    }

    #[test]
    fn strips_osc_title_and_bel() {
        let raw = b"\x1b]0;pwsh\x07PS C:\\tmp> ";
        assert_eq!(strip_ansi(raw), "PS C:\\tmp> ");
    }

    #[test]
    fn normalizes_newlines_and_drops_backspace() {
        assert_eq!(strip_ansi(b"a\r\nb\rc"), "a\nb\nc");
        assert_eq!(strip_ansi(b"ab\x08c"), "abc");
    }

    #[test]
    fn keeps_utf8_text_intact() {
        // 末尾换行保留（截尾交给 tail_chars），只验证多字节字符没被切碎
        let raw = "构建完成 ✓\r\n".as_bytes();
        assert_eq!(strip_ansi(raw), "构建完成 ✓\n");
    }

    #[test]
    fn tail_marks_truncation() {
        assert_eq!(tail_chars("abcdef", 3), "…（前面省略 3 个字符）\ndef");
        assert_eq!(tail_chars("abc", 10), "abc");
        assert_eq!(tail_chars("abc", 0), "");
    }

    #[test]
    fn tail_counts_chars_not_bytes() {
        assert_eq!(tail_chars("中文内容", 2), "…（前面省略 2 个字符）\n内容");
    }
}
