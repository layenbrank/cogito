//! Wiki 页规范化：type → 目录、frontmatter 补齐、标题与路径推导。
//!
//! **唯一实现**。staging 写入、发布、存量归位、lint 都走这里；
//! 前端规范文本（`wiki-templates.ts`）与类型表通过 `knowledge:wikiContract` 对齐，
//! 不要在别处再写一套映射。

use chrono::Utc;
use serde::Serialize;

use super::front_matter::{Document, FrontMatter};
use super::text::slugify;
use crate::exception::Exception;

/// 一个内容页类型及其落点目录（相对库根）。
#[derive(Debug, Clone, Copy)]
pub struct WikiType {
    pub name: &'static str,
    pub dir: &'static str,
    pub label: &'static str,
}

/// 内置页面类型。
///
/// 前 7 个是通用类型；后 8 个来自场景模板（主题阅读 / 商业团队），
/// 放进枚举是为了「模板推荐的目录」与「发布时的校验」用同一张表 ——
/// 否则模板一启用就会全线 type-dir-mismatch。新增模板类型时三处一起改：
/// 这里、前端 `wiki-type-dirs.ts`、模板 schema 文本。
pub const WIKI_TYPES: [WikiType; 15] = [
    WikiType {
        name: "entity",
        dir: "wiki/entities",
        label: "实体",
    },
    WikiType {
        name: "concept",
        dir: "wiki/concepts",
        label: "概念",
    },
    WikiType {
        name: "source",
        dir: "wiki/sources",
        label: "资料",
    },
    WikiType {
        name: "query",
        dir: "wiki/queries",
        label: "开放问题",
    },
    WikiType {
        name: "comparison",
        dir: "wiki/comparisons",
        label: "对照",
    },
    WikiType {
        name: "synthesis",
        dir: "wiki/synthesis",
        label: "综合",
    },
    WikiType {
        name: "note",
        dir: "wiki/notes",
        label: "笔记",
    },
    WikiType {
        name: "character",
        dir: "wiki/characters",
        label: "人物",
    },
    WikiType {
        name: "theme",
        dir: "wiki/themes",
        label: "主题",
    },
    WikiType {
        name: "plot-thread",
        dir: "wiki/plot-threads",
        label: "情节线",
    },
    WikiType {
        name: "chapter",
        dir: "wiki/chapters",
        label: "章节笔记",
    },
    WikiType {
        name: "meeting",
        dir: "wiki/meetings",
        label: "会议",
    },
    WikiType {
        name: "decision",
        dir: "wiki/decisions",
        label: "决策",
    },
    WikiType {
        name: "project",
        dir: "wiki/projects",
        label: "项目",
    },
    WikiType {
        name: "stakeholder",
        dir: "wiki/stakeholders",
        label: "干系人",
    },
];

/// 应用维护、模型不得写入的类型。
pub const RESERVED_TYPES: [&str; 3] = ["index", "log", "overview"];

/// 模型没给 type 时的默认落点（编辑器新建的普通笔记）。
pub const DEFAULT_TYPE: &str = "note";

/// 聚合页：应用维护，禁止模型生成。
pub const AGGREGATE_PATHS: [&str; 3] = ["wiki/index.md", "wiki/log.md", "wiki/overview.md"];

/// 前端用的规范契约（`knowledge:wikiContract`）：类型表与必填项只在这里定义一次。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiContractType {
    pub name: &'static str,
    pub dir: &'static str,
    pub label: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiContract {
    pub types: Vec<WikiContractType>,
    pub default_type: &'static str,
    pub required_front_matter: [&'static str; 6],
    pub aggregate_paths: [&'static str; 3],
    pub naming: &'static str,
}

#[must_use]
pub fn contract() -> WikiContract {
    WikiContract {
        types: WIKI_TYPES
            .iter()
            .map(|item| WikiContractType {
                name: item.name,
                dir: item.dir,
                label: item.label,
            })
            .collect(),
        default_type: DEFAULT_TYPE,
        required_front_matter: ["type", "title", "tags", "related", "created", "updated"],
        aggregate_paths: AGGREGATE_PATHS,
        naming: "kebab-case.md（可用中文短横线，如 本地优先.md）",
    }
}

#[must_use]
pub fn find_wiki_type(raw: &str) -> Option<&'static WikiType> {
    let needle = raw.trim();
    WIKI_TYPES
        .iter()
        .find(|item| item.name.eq_ignore_ascii_case(needle))
}

#[must_use]
pub fn is_reserved_type(raw: &str) -> bool {
    let needle = raw.trim();
    RESERVED_TYPES
        .iter()
        .any(|name| name.eq_ignore_ascii_case(needle))
}

#[must_use]
pub fn is_aggregate_path(rel_path: &str) -> bool {
    let normalized = rel_path.replace('\\', "/").to_ascii_lowercase();
    AGGREGATE_PATHS.contains(&normalized.as_str())
}

/// `wiki/<dir>/<slug>.md`
#[must_use]
pub fn to_rel_path(page_type: &WikiType, title: &str) -> String {
    format!("{}/{}.md", page_type.dir, slugify(title, 60))
}

/// 规范化输入：所有字段都可缺省，函数负责把缺的补齐。
pub struct PageInput<'a> {
    /// 文件名/标题回退（工具面的 `name`）
    pub name: &'a str,
    pub content: &'a str,
    /// 显式 type 优先于 frontmatter
    pub type_hint: Option<&'a str>,
    /// 显式标题优先于 frontmatter
    pub title_hint: Option<&'a str>,
}

/// 规范化结果：可以直接写盘的一页。
#[derive(Debug, Clone)]
pub struct WikiPage {
    /// 含 frontmatter 的完整正文
    pub content: String,
    pub title: String,
    pub page_type: String,
    pub dir: String,
    pub slug: String,
    pub rel_path: String,
}

/// 把一篇「模型/用户产物」规范成 wiki 页：
/// - type 决定目录（未知 / 保留类型直接报错，不猜）；
/// - title 写进 frontmatter，正文与 title 重复的 H1 去掉，其余 H1 降为 H2；
/// - `created` 只在缺失时补，`updated` 每次都刷新。
pub fn normalize(input: PageInput<'_>) -> Result<WikiPage, Exception> {
    let mut document = Document::parse(input.content);
    let mut front = document.front_matter.take().unwrap_or_default();

    let page_type = resolve_type(input.type_hint, &front)?;
    let title = resolve_title(input.title_hint, &front, &document.body, input.name);
    let body = to_body(&document.body, &title);
    if body.trim().is_empty() {
        return Err(Exception::Validation(
            "正文为空：只有标题的页面不会写进 wiki".to_string(),
        ));
    }

    front.set_scalar("type", page_type.name);
    front.set_scalar("title", title.as_str());
    let today = Utc::now().format("%Y-%m-%d").to_string();
    if front.scalar("created").is_none() {
        front.set_scalar("created", today.as_str());
    }
    front.set_scalar("updated", today.as_str());

    let content = Document {
        front_matter: Some(front),
        body,
    }
    .render();
    let slug = slugify(&title, 60);
    let rel_path = to_rel_path(page_type, &title);

    Ok(WikiPage {
        content,
        title,
        page_type: page_type.name.to_string(),
        dir: page_type.dir.to_string(),
        slug,
        rel_path,
    })
}

/// 读 staging 草稿的展示元信息：`(type, title)`。
#[must_use]
pub fn to_read_meta(content: &str) -> (Option<String>, Option<String>) {
    let document = Document::parse(content);
    let Some(front) = document.front_matter else {
        return (None, find_h1(&document.body));
    };
    let page_type = front
        .scalar("type")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);
    let title = front
        .scalar("title")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| find_h1(&document.body));
    (page_type, title)
}

fn resolve_type(hint: Option<&str>, front: &FrontMatter) -> Result<&'static WikiType, Exception> {
    let raw = hint
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            front
                .scalar("type")
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .unwrap_or(DEFAULT_TYPE);

    if is_reserved_type(raw) {
        return Err(Exception::Validation(format!(
            "{raw} 由应用维护（index / log / overview），不能作为内容页写入"
        )));
    }
    find_wiki_type(raw).ok_or_else(|| {
        let names: Vec<&str> = WIKI_TYPES.iter().map(|item| item.name).collect();
        Exception::Validation(format!(
            "未知页面类型：{raw}；可用：{}",
            names.join(" / ")
        ))
    })
}

fn resolve_title(hint: Option<&str>, front: &FrontMatter, body: &str, name: &str) -> String {
    let candidates: [Option<String>; 4] = [
        hint.map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        front
            .scalar("title")
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        find_h1(body),
        Some(name.trim().to_string()).filter(|value| !value.is_empty()),
    ];
    let title = candidates
        .into_iter()
        .flatten()
        .next()
        .unwrap_or_else(|| "未命名".to_string());
    title.chars().take(120).collect()
}

/// 去掉与 title 重复的 H1；其余 H1 降为 H2（一页只有一个标题，写在 frontmatter）。
fn to_body(body: &str, title: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut dropped = false;
    for line in body.lines() {
        if let Some(heading) = line.trim_start().strip_prefix("# ") {
            let text = heading.trim();
            if !dropped && text.eq_ignore_ascii_case(title) {
                dropped = true;
                continue;
            }
            out.push(format!("## {text}"));
            continue;
        }
        out.push(line.to_string());
    }
    out.join("\n").trim_matches('\n').to_string()
}

fn find_h1(body: &str) -> Option<String> {
    body.lines().find_map(|line| {
        line.trim_start()
            .strip_prefix("# ")
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(name: &str, content: &str, page_type: Option<&str>) -> WikiPage {
        normalize(PageInput {
            name,
            content,
            type_hint: page_type,
            title_hint: None,
        })
        .expect("normalize")
    }

    #[test]
    fn front_matter_type_decides_directory() {
        let page = page(
            "ignored",
            "---\ntype: concept\ntitle: 本地优先\n---\n\n正文",
            None,
        );
        assert_eq!(page.page_type, "concept");
        assert_eq!(page.rel_path, "wiki/concepts/本地优先.md");
        assert!(page.content.starts_with("---\ntype: concept\ntitle: 本地优先"));
        assert!(page.content.contains("created: "));
    }

    #[test]
    fn hint_overrides_front_matter() {
        let page = page(
            "x",
            "---\ntype: concept\ntitle: 甲的页面\n---\n\n正文",
            Some("entity"),
        );
        assert_eq!(page.rel_path, "wiki/entities/甲的页面.md");
    }

    #[test]
    fn title_comes_from_h1_and_is_not_repeated_in_body() {
        let page = page("x", "# 甲\n\n正文", None);
        assert_eq!(page.title, "甲");
        assert_eq!(page.page_type, "note");
        assert!(!page.content.contains("# 甲"));
        assert!(page.content.contains("title: 甲"));
    }

    #[test]
    fn extra_h1_is_demoted() {
        let page = page("x", "---\ntitle: 甲\n---\n\n# 乙\n\n正文", None);
        assert_eq!(page.page_type, "note");
        assert!(page.content.contains("## 乙"));
    }

    #[test]
    fn template_types_land_in_their_dirs() {
        let chapter = page("x", "# 第一章\n\n正文", Some("chapter"));
        assert_eq!(chapter.page_type, "chapter");
        assert_eq!(chapter.rel_path, "wiki/chapters/第一章.md");

        let meeting = page("周会", "## 结论\n\n正文", Some("meeting"));
        assert_eq!(meeting.rel_path, "wiki/meetings/周会.md");
    }

    #[test]
    fn unknown_type_is_rejected() {
        let error = normalize(PageInput {
            name: "x",
            content: "---\ntype: claim\n---\n\n正文",
            type_hint: None,
            title_hint: None,
        })
        .expect_err("claim 不在规范里");
        assert!(error.to_string().contains("未知页面类型"));
    }

    #[test]
    fn aggregate_type_is_rejected() {
        let error = normalize(PageInput {
            name: "x",
            content: "正文",
            type_hint: Some("overview"),
            title_hint: None,
        })
        .expect_err("overview 由应用维护");
        assert!(error.to_string().contains("由应用维护"));
    }

    #[test]
    fn empty_body_is_rejected() {
        let error = normalize(PageInput {
            name: "x",
            content: "# 甲\n",
            type_hint: None,
            title_hint: None,
        })
        .expect_err("只有标题");
        assert!(error.to_string().contains("正文为空"));
    }

    #[test]
    fn normalize_is_idempotent() {
        let once = page("x", "# 甲\n\n正文", Some("note"));
        let twice = page("x", &once.content, Some("note"));
        assert_eq!(once.content, twice.content);
        assert_eq!(once.rel_path, twice.rel_path);
    }

    #[test]
    fn reads_meta_from_front_matter() {
        let (page_type, title) = to_read_meta("---\ntype: entity\ntitle: OpenAI\n---\n\n正文");
        assert_eq!(page_type.as_deref(), Some("entity"));
        assert_eq!(title.as_deref(), Some("OpenAI"));
    }
}
