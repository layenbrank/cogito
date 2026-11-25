//! 最小 YAML frontmatter：只认「键: 值」与 `[a, b]` / `- a` 列表。
//!
//! 不引入完整 YAML 解析器：frontmatter 由本应用生成，形状受控；
//! 把用户手写的怪语法塞进严格解析器，只会制造难以解释的失败。
//!
//! 解析失败一律「降级成正文」而不是报错：任何 Markdown 都必须能打开。

/// frontmatter 的一个值。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FmValue {
    Scalar(String),
    List(Vec<String>),
}

/// 有序键值对：渲染顺序稳定，同一页重复发布不会产生无意义 diff。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FrontMatter {
    entries: Vec<(String, FmValue)>,
}

impl FrontMatter {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    #[must_use]
    pub fn scalar(&self, key: &str) -> Option<&str> {
        self.entries
            .iter()
            .find(|(name, _)| name == key)
            .and_then(|(_, value)| match value {
                FmValue::Scalar(text) => Some(text.as_str()),
                FmValue::List(_) => None,
            })
    }

    pub fn set_scalar(&mut self, key: &str, value: impl Into<String>) {
        self.put(key, FmValue::Scalar(value.into()));
    }

    pub fn set_list(&mut self, key: &str, values: Vec<String>) {
        self.put(key, FmValue::List(values));
    }

    fn put(&mut self, key: &str, value: FmValue) {
        if let Some(slot) = self.entries.iter_mut().find(|(name, _)| name == key) {
            slot.1 = value;
            return;
        }
        self.entries.push((key.to_string(), value));
    }

    #[must_use]
    pub fn render(&self) -> String {
        self.entries
            .iter()
            .map(|(key, value)| match value {
                FmValue::Scalar(text) => format!("{key}: {}", render_scalar(text)),
                FmValue::List(items) => format!("{key}: {}", render_list(items)),
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

/// 一篇文章：可选 frontmatter + 正文（都不含 `---` 分隔符本身）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Document {
    pub front_matter: Option<FrontMatter>,
    pub body: String,
}

impl Document {
    #[must_use]
    pub fn parse(content: &str) -> Self {
        let content = content.trim_start_matches('\u{feff}');
        let Some((block, body)) = split(content) else {
            return Self {
                front_matter: None,
                body: content.trim_end().to_string(),
            };
        };
        Self {
            front_matter: Some(parse_block(block)),
            body: body.trim_start_matches('\n').trim_end().to_string(),
        }
    }

    #[must_use]
    pub fn render(&self) -> String {
        let body = self.body.trim_end();
        match &self.front_matter {
            Some(front) if !front.is_empty() => {
                format!("---\n{}\n---\n\n{body}\n", front.render())
            }
            _ => format!("{body}\n"),
        }
    }
}

/// 切出 frontmatter 块与正文。开头没有 `---` 或没有闭合 → 整篇都是正文。
fn split(content: &str) -> Option<(&str, &str)> {
    let offset = content.len() - content.trim_start().len();
    let trimmed = &content[offset..];
    let mut lines = trimmed.split_inclusive('\n');
    let first = lines.next()?;
    if first.trim() != "---" {
        return None;
    }
    let block_start = first.len();
    let mut consumed = first.len();
    for line in lines {
        let marker = line.trim();
        if marker == "---" || marker == "..." {
            let block = &trimmed[block_start..consumed];
            let body = trimmed.get(consumed + line.len()..).unwrap_or("");
            return Some((block, body));
        }
        consumed += line.len();
    }
    None
}

fn parse_block(block: &str) -> FrontMatter {
    let mut front = FrontMatter::new();
    let mut pending: Option<(String, Vec<String>)> = None;

    for raw in block.lines() {
        let line = raw.trim_end();
        if line.trim().is_empty() {
            continue;
        }

        // `- item`：接上一个空值键，组成列表
        if let Some(item) = line.trim_start().strip_prefix("- ")
            && let Some((key, mut items)) = pending.take()
        {
            items.push(unquote(item));
            pending = Some((key, items));
            continue;
        }

        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim();
        if name.is_empty() || name.chars().any(char::is_whitespace) {
            continue;
        }

        flush(&mut pending, &mut front);
        let value = value.trim();
        if value.is_empty() {
            pending = Some((name.to_string(), Vec::new()));
        } else if let Some(inner) = value
            .strip_prefix('[')
            .and_then(|rest| rest.strip_suffix(']'))
        {
            let items = inner
                .split(',')
                .map(unquote)
                .filter(|item| !item.is_empty())
                .collect();
            front.set_list(name, items);
        } else {
            let text = unquote(value);
            if is_list_key(name) && has_separator(&text) {
                let items = text
                    .split([',', '，', '、'])
                    .map(str::trim)
                    .filter(|item| !item.is_empty())
                    .map(str::to_string)
                    .collect();
                front.set_list(name, items);
            } else {
                front.set_scalar(name, text);
            }
        }
    }

    flush(&mut pending, &mut front);
    front
}

fn flush(pending: &mut Option<(String, Vec<String>)>, front: &mut FrontMatter) {
    if let Some((key, items)) = pending.take() {
        front.set_list(&key, items);
    }
}

fn is_list_key(key: &str) -> bool {
    matches!(key, "tags" | "related" | "sources" | "authors")
}

fn has_separator(text: &str) -> bool {
    text.contains([',', '，', '、'])
}

fn unquote(raw: &str) -> String {
    let text = raw.trim();
    for quote in ['"', '\''] {
        if let Some(inner) = text
            .strip_prefix(quote)
            .and_then(|rest| rest.strip_suffix(quote))
        {
            return inner.replace("\\\"", "\"").replace("\\'", "'");
        }
    }
    text.to_string()
}

fn render_scalar(value: &str) -> String {
    let first = value.chars().next();
    let needs_quote = value.is_empty()
        || value != value.trim()
        || value.contains(": ")
        || value.contains(" #")
        || value.contains('\n')
        || value.starts_with("- ")
        || first.is_some_and(|ch| {
            matches!(
                ch,
                '[' | ']' | '{' | '}' | '*' | '&' | '!' | '|' | '>' | '\'' | '"' | '@' | '`' | '#'
            )
        });
    if needs_quote {
        format!("\"{}\"", value.replace('"', "\\\""))
    } else {
        value.to_string()
    }
}

fn render_list(items: &[String]) -> String {
    if items.is_empty() {
        return "[]".to_string();
    }
    let parts: Vec<String> = items.iter().map(|item| render_scalar(item)).collect();
    format!("[{}]", parts.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_front_matter_and_body() {
        let document = Document::parse("---\ntype: concept\ntitle: 本地优先\ntags: [架构]\n---\n\n正文\n");
        let front = document.front_matter.expect("front matter");
        assert_eq!(front.scalar("type"), Some("concept"));
        assert_eq!(front.scalar("title"), Some("本地优先"));
        assert_eq!(document.body, "正文");
    }

    #[test]
    fn without_front_matter_keeps_whole_content() {
        let document = Document::parse("# 标题\n\n正文\n");
        assert!(document.front_matter.is_none());
        assert_eq!(document.body, "# 标题\n\n正文");
    }

    #[test]
    fn unclosed_front_matter_is_body() {
        let document = Document::parse("---\ntitle: x\n");
        assert!(document.front_matter.is_none());
    }

    #[test]
    fn renders_stable_order_and_quoting() {
        let mut front = FrontMatter::new();
        front.set_scalar("type", "concept");
        front.set_scalar("title", "A: B");
        front.set_list("tags", vec!["架构".to_string(), "本地".to_string()]);
        assert_eq!(
            front.render(),
            "type: concept\ntitle: \"A: B\"\ntags: [架构, 本地]"
        );
    }

    #[test]
    fn block_sequence_becomes_list() {
        let document = Document::parse("---\ntags:\n  - 架构\n  - 本地\n---\n正文");
        let front = document.front_matter.expect("front matter");
        assert_eq!(front.render(), "tags: [架构, 本地]");
    }

    #[test]
    fn inline_comma_separated_tags_become_list() {
        let document = Document::parse("---\ntags: 架构, 本地\n---\n正文");
        let front = document.front_matter.expect("front matter");
        assert_eq!(front.render(), "tags: [架构, 本地]");
    }

    #[test]
    fn round_trip_is_idempotent() {
        let mut front = FrontMatter::new();
        front.set_scalar("type", "note");
        front.set_scalar("title", "标题");
        let document = Document {
            front_matter: Some(front),
            body: "## 小节\n\n正文".to_string(),
        };
        let rendered = document.render();
        let again = Document::parse(&rendered);
        assert_eq!(again.body, "## 小节\n\n正文");
        assert_eq!(again.render(), rendered);
    }
}
