use std::path::Path;

use cogito_core::CommandResult;

/// 统一成 LF，避免 HEAD(LF) ↔ 工作区(CRLF) 被当成「每一行都改过」。
pub fn normalize_eol(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'\r' => {
                if index + 1 < bytes.len() && bytes[index + 1] == b'\n' {
                    index += 2;
                } else {
                    index += 1;
                }
                out.push(b'\n');
            }
            other => {
                out.push(other);
                index += 1;
            }
        }
    }
    out
}

pub fn decode_text(bytes: Vec<u8>) -> String {
    match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(error) => String::from_utf8_lossy(&error.into_bytes()).into_owned(),
    }
}

pub fn count_lines(text: &str) -> u32 {
    if text.is_empty() {
        return 0;
    }
    let mut count = 1_u32;
    for byte in text.bytes() {
        if byte == b'\n' {
            count = count.saturating_add(1);
        }
    }
    count
}

pub fn looks_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8 * 1024).any(|byte| *byte == 0)
}

pub fn prepare_side(bytes: Vec<u8>) -> (String, u32) {
    let text = decode_text(normalize_eol(&bytes));
    let lines = count_lines(&text);
    (text, lines)
}

/// 从 HEAD 树读取文件内容；文件不在 HEAD 时返回空。
pub fn read_head_bytes(repo: &gix::Repository, relative: &str) -> CommandResult<Vec<u8>> {
    let relative = relative.replace('\\', "/");
    if relative.is_empty() {
        return Ok(Vec::new());
    }
    let spec = format!("HEAD:{relative}");
    match repo.rev_parse_single(spec.as_str()) {
        Ok(id) => match id.object() {
            Ok(object) => Ok(object.data.clone()),
            Err(_) => Ok(Vec::new()),
        },
        Err(_) => Ok(Vec::new()),
    }
}

pub fn read_worktree_bytes(cwd: &Path, relative: &str) -> Vec<u8> {
    let absolute = cwd.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
    std::fs::read(absolute).unwrap_or_default()
}

/// 工作区文件指纹：size + mtime nanos（用于短路，不必读全文）。
pub fn worktree_fingerprint(cwd: &Path, relative: &str) -> Option<(u64, u64)> {
    let absolute = cwd.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
    let meta = std::fs::metadata(absolute).ok()?;
    let modified = meta
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_nanos() as u64;
    Some((meta.len(), modified))
}
