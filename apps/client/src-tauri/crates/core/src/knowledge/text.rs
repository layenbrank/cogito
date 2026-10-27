//! 纯文本工具：slug、正文指纹、标题抽取、字数统计。
//!
//! 这些函数不碰 IO，方便直接单测（它们决定了文件名、去重与检索质量）。

/// 正文指纹：长度 + FNV-1a 64。
///
/// 只用于本地判断「文件是否被外部改过」，不参与跨端比较，也不做密码学用途。
#[must_use]
pub fn hash_content(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{:x}-{hash:016x}", bytes.len())
}

/// 目录名 / 文件名用的 slug：保留字母数字（含 CJK），其余压成 `-`。
///
/// 空结果回退 `untitled`：调用方不必再判空。
#[must_use]
pub fn slugify(name: &str, max_chars: usize) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in name.chars() {
        let keep = ch.is_alphanumeric();
        if keep {
            for lower in ch.to_lowercase() {
                out.push(lower);
            }
            last_dash = false;
            continue;
        }
        if !last_dash && !out.is_empty() {
            out.push('-');
            last_dash = true;
        }
        if out.chars().count() >= max_chars {
            break;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "untitled".to_string()
    } else {
        trimmed.chars().take(max_chars).collect()
    }
}

/// 标题：优先一级标题，其次首个非空行，最后回退文件名。
#[must_use]
pub fn find_title(content: &str, fallback: &str) -> String {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(heading) = trimmed.strip_prefix("# ") {
            let title = heading.trim();
            if !title.is_empty() {
                return title.chars().take(120).collect();
            }
        }
        return trimmed.chars().take(120).collect();
    }
    fallback.to_string()
}

/// 字数：非空白字符数（中文按字计，英文按字符计）。
///
/// 不按空格切词：中文整段没有空格，切出来永远是 1。
#[must_use]
pub fn count_words(content: &str) -> i64 {
    content.chars().filter(|ch| !ch.is_whitespace()).count() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_keeps_cjk_and_collapses_separators() {
        assert_eq!(slugify("周报 / 2026 Q4", 60), "周报-2026-q4");
        assert_eq!(slugify("  ../etc/passwd  ", 60), "etc-passwd");
        assert_eq!(slugify("***", 60), "untitled");
        assert_eq!(slugify("a".repeat(80).as_str(), 10).chars().count(), 10);
    }

    #[test]
    fn hash_changes_with_content() {
        assert_eq!(hash_content(b"abc"), hash_content(b"abc"));
        assert_ne!(hash_content(b"abc"), hash_content(b"abd"));
        assert!(hash_content(b"abc").starts_with("3-"));
    }

    #[test]
    fn title_prefers_heading_then_first_line() {
        assert_eq!(find_title("# 标题\n正文", "file"), "标题");
        assert_eq!(find_title("\n\n第一行\n第二行", "file"), "第一行");
        assert_eq!(find_title("   \n\t", "file"), "file");
    }

    #[test]
    fn word_count_counts_non_whitespace_chars() {
        assert_eq!(count_words("知识 库\nabc"), 6);
    }
}
