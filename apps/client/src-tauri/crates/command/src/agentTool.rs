#![allow(non_snake_case)]

//! Agent 工具卡热路径：行级 diff / 输出规范化，从 WebView 主线程卸到 Rust。

use cogito_core::CommandResult;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use similar::{Algorithm, ChangeTag, TextDiff};

use crate::git::{LARGE_CHANGE_LINES, LARGE_DIFF_BYTES};
use crate::terminalText::{strip_ansi, tail_chars};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiffLineKind {
    Context,
    Added,
    Removed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: DiffLineKind,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineDiffR {
    pub lines: Vec<DiffLine>,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineDiffP {
    pub old_text: String,
    pub new_text: String,
}

fn split_lines(text: &str) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }
    let normalized = text.replace("\r\n", "\n");
    let trimmed = normalized.strip_suffix('\n').unwrap_or(normalized.as_str());
    if trimmed.is_empty() {
        return Vec::new();
    }
    trimmed.split('\n').map(str::to_string).collect()
}

fn whole_replace(old_lines: &[String], new_lines: &[String]) -> LineDiffR {
    let mut lines = Vec::with_capacity(old_lines.len() + new_lines.len());
    for text in old_lines {
        lines.push(DiffLine {
            kind: DiffLineKind::Removed,
            text: text.clone(),
        });
    }
    for text in new_lines {
        lines.push(DiffLine {
            kind: DiffLineKind::Added,
            text: text.clone(),
        });
    }
    LineDiffR {
        additions: new_lines.len() as u32,
        deletions: old_lines.len() as u32,
        lines,
    }
}

fn build_line_diff(old_text: &str, new_text: &str) -> LineDiffR {
    if old_text == new_text {
        let lines = split_lines(old_text)
            .into_iter()
            .map(|text| DiffLine {
                kind: DiffLineKind::Context,
                text,
            })
            .collect();
        return LineDiffR {
            lines,
            additions: 0,
            deletions: 0,
        };
    }

    let old_lines = split_lines(old_text);
    let new_lines = split_lines(new_text);

    if old_lines.is_empty() {
        return LineDiffR {
            lines: new_lines
                .iter()
                .cloned()
                .map(|text| DiffLine {
                    kind: DiffLineKind::Added,
                    text,
                })
                .collect(),
            additions: new_lines.len() as u32,
            deletions: 0,
        };
    }
    if new_lines.is_empty() {
        return LineDiffR {
            lines: old_lines
                .iter()
                .cloned()
                .map(|text| DiffLine {
                    kind: DiffLineKind::Removed,
                    text,
                })
                .collect(),
            additions: 0,
            deletions: old_lines.len() as u32,
        };
    }

    let total_bytes = old_text.len().saturating_add(new_text.len());
    let total_lines = (old_lines.len() as u32).saturating_add(new_lines.len() as u32);
    if total_bytes >= LARGE_DIFF_BYTES || total_lines >= LARGE_CHANGE_LINES {
        return whole_replace(&old_lines, &new_lines);
    }

    let old_joined = old_lines.join("\n");
    let new_joined = new_lines.join("\n");
    // 末尾补换行：similar 按行切分时与「无尾换行的整文件」对齐更稳
    let old_src = if old_joined.ends_with('\n') {
        old_joined
    } else {
        format!("{old_joined}\n")
    };
    let new_src = if new_joined.ends_with('\n') {
        new_joined
    } else {
        format!("{new_joined}\n")
    };
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Myers)
        .diff_lines(&old_src, &new_src);

    let mut lines = Vec::new();
    let mut additions = 0_u32;
    let mut deletions = 0_u32;

    for change in diff.iter_all_changes() {
        let text = change.value().trim_end_matches('\n').to_string();
        match change.tag() {
            ChangeTag::Equal => lines.push(DiffLine {
                kind: DiffLineKind::Context,
                text,
            }),
            ChangeTag::Delete => {
                deletions = deletions.saturating_add(1);
                lines.push(DiffLine {
                    kind: DiffLineKind::Removed,
                    text,
                });
            }
            ChangeTag::Insert => {
                additions = additions.saturating_add(1);
                lines.push(DiffLine {
                    kind: DiffLineKind::Added,
                    text,
                });
            }
        }
    }

    LineDiffR {
        lines,
        additions,
        deletions,
    }
}

#[tauri::command(rename = "agentTool:lineDiff")]
pub fn agentToolLineDiff(params: LineDiffP) -> CommandResult<LineDiffR> {
    Ok(build_line_diff(&params.old_text, &params.new_text))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizeOutputP {
    /// 原始工具输出（字符串或任意 JSON）
    ///
    /// 缺省按 `null` 处理：前端在「结果还没到」时传的是 `{ value: undefined }`，
    /// JSON 序列化会把这个键整个丢掉；没有 default 就会报 `missing field value`。
    #[serde(default)]
    pub value: Value,
    /// 截尾字符上限；缺省不截
    #[serde(default)]
    pub max_chars: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizeOutputR {
    pub text: String,
}

fn unwrap_encoded_blob(text: &str) -> Option<Value> {
    let trimmed = text.trim();
    if trimmed.len() < 2 {
        return None;
    }
    let starts_object = trimmed.starts_with('{') || trimmed.starts_with('[');
    let starts_quoted = trimmed.starts_with('"') && trimmed.ends_with('"');
    if !starts_object && !starts_quoted {
        return None;
    }
    if !starts_quoted && !trimmed.contains('\\') && trimmed.contains('\n') {
        return None;
    }
    serde_json::from_str(trimmed).ok()
}

fn unescape_literal_escapes(text: &str) -> String {
    let has_escaped_breaks = (text.contains("\\n") || text.contains("\\r\\n") || text.contains("\\t"))
        && !text.contains('\n');
    if !has_escaped_breaks {
        return text.replace("\r\n", "\n");
    }
    text.replace("\\r\\n", "\n")
        .replace("\\n", "\n")
        .replace("\\r", "\n")
        .replace("\\t", "\t")
        .replace("\\\"", "\"")
        .replace("\\\\", "\\")
}

fn flatten_text(value: &Value, depth: usize) -> String {
    if depth > 4 {
        return value.to_string();
    }
    match value {
        Value::Null => String::new(),
        Value::String(text) => {
            if let Some(unwrapped) = unwrap_encoded_blob(text) {
                if Value::String(text.clone()) != unwrapped {
                    return flatten_text(&unwrapped, depth + 1);
                }
            }
            unescape_literal_escapes(text)
        }
        Value::Array(items) => {
            let chunks: Vec<String> = items
                .iter()
                .filter_map(|item| {
                    let text = match item {
                        Value::String(s) => Some(unescape_literal_escapes(s)),
                        Value::Object(map) => map
                            .get("text")
                            .and_then(Value::as_str)
                            .map(unescape_literal_escapes)
                            .or_else(|| {
                                map.get("content")
                                    .and_then(Value::as_str)
                                    .map(unescape_literal_escapes)
                            }),
                        _ => None,
                    };
                    text.filter(|chunk| !chunk.is_empty())
                })
                .collect();
            if !chunks.is_empty() {
                return chunks.join("\n");
            }
            items
                .iter()
                .map(|item| flatten_text(item, depth + 1))
                .filter(|chunk| !chunk.is_empty())
                .collect::<Vec<_>>()
                .join("\n")
        }
        Value::Object(map) => {
            let stdout = map.get("stdout").and_then(Value::as_str).unwrap_or("");
            let stderr = map.get("stderr").and_then(Value::as_str).unwrap_or("");
            if !stdout.is_empty() || !stderr.is_empty() {
                let mut parts = Vec::new();
                if !stdout.is_empty() {
                    parts.push(unescape_literal_escapes(stdout));
                }
                if !stderr.is_empty() {
                    parts.push(unescape_literal_escapes(stderr));
                }
                return parts.join("\n");
            }
            for key in [
                "stdout", "stderr", "output", "result", "text", "content", "message", "data",
            ] {
                if let Some(Value::String(text)) = map.get(key) {
                    if !text.trim().is_empty() {
                        return flatten_text(&Value::String(text.clone()), depth + 1);
                    }
                }
            }
            if let Some(content) = map.get("content") {
                return flatten_text(content, depth + 1);
            }
            value.to_string()
        }
        other => other.to_string(),
    }
}

fn normalize_output(value: &Value, max_chars: Option<usize>) -> String {
    let flat = flatten_text(value, 0);
    let stripped = strip_ansi(flat.as_bytes());
    match max_chars {
        Some(limit) => tail_chars(&stripped, limit),
        None => stripped.trim_end().to_string(),
    }
}

#[tauri::command(rename = "agentTool:normalizeOutput")]
pub fn agentToolNormalizeOutput(params: NormalizeOutputP) -> CommandResult<NormalizeOutputR> {
    Ok(NormalizeOutputR {
        text: normalize_output(&params.value, params.max_chars),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn line_diff_marks_simple_change() {
        let diff = build_line_diff("a\nb\n", "a\nc\n");
        assert_eq!(diff.additions, 1);
        assert_eq!(diff.deletions, 1);
        assert!(diff.lines.iter().any(|line| line.kind == DiffLineKind::Removed));
        assert!(diff.lines.iter().any(|line| line.kind == DiffLineKind::Added));
    }

    #[test]
    fn normalize_params_tolerate_missing_value() {
        // 前端在「结果还没到」时会把 value 这个键整个丢掉（JSON 里 undefined 不可序列化），
        // 缺省必须能反序列化成 null，否则每次渲染都会报 `missing field value`。
        let params: NormalizeOutputP = serde_json::from_str("{}").expect("missing value 应可反序列化");
        assert_eq!(normalize_output(&params.value, params.max_chars), "");

        let params: NormalizeOutputP =
            serde_json::from_str("{\"value\":\"x\"}").expect("显式 value 仍可反序列化");
        assert_eq!(normalize_output(&params.value, params.max_chars), "x");
    }

    #[test]
    fn normalize_strips_ansi_and_unwraps_json() {
        let value = json!("\u{1b}[32mok\u{1b}[0m");
        let text = normalize_output(&value, None);
        assert_eq!(text, "ok");

        let nested = json!("{\"stdout\":\"hello\\\\nworld\"}");
        let text = normalize_output(&nested, None);
        assert!(text.contains("hello"));
        assert!(text.contains("world"));
    }
}
