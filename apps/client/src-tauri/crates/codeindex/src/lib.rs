//! 代码索引（S12）：tree-sitter 解析 → 符号 + 边。
//!
//! 只读、可重算：索引是**派生数据**（删了能重建），所以不进库、也不参与任何写路径。
//! 上层（`cogito_core::tools::code`）拿到 `Index` 后只在内存里缓存，
//! 进程重启就重算一遍 —— 对本地几万个符号来说，这比重建两张表加迁移便宜得多。
//!
//! 做到什么程度、没做什么，写在 README 里（避免下一个人以为 `Call` 边是精确调用图）：
//! - **符号**：函数 / 方法 / 类 / 接口 / 结构体 / 枚举 / trait / impl / 类型 / 常量 / 模块
//! - **边**：`Import`（模块说明符）与 `Call`（被调用的名字）
//! - 不做类型解析、不做跨文件名字消解：`Call` 边按**名字**连，重名的会连成一片。
//!   这是有意的取舍 —— 精确调用图要 LSP/编译器级信息，超出「给 Agent 一张地图」的范围。

use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tree_sitter::{Language as TsLanguage, Node, Parser};

/// 单次索引最多扫这么多文件：再多的仓库也不该让一次工具调用跑成几分钟。
pub const MAX_FILES: usize = 2000;
/// 单文件上限：超过这个体积的多是生成物 / 压缩产物，索引它们没意义。
pub const MAX_FILE_BYTES: u64 = 512 * 1024;
/// 目录递归上限。
pub const MAX_DEPTH: usize = 12;

/// 不扫的目录：依赖、构建产物、版本库内部。
const SKIP_DIRS: [&str; 8] = [
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    "vendor",
];

/// 支持的语言。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    TypeScript,
    Tsx,
    JavaScript,
    Rust,
}

impl Lang {
    /// 按扩展名判语言；判不出来返回 `None`（调用方跳过该文件）。
    #[must_use]
    pub fn for_path(path: &str) -> Option<Self> {
        let lower = path.to_ascii_lowercase();
        if lower.ends_with(".tsx") {
            return Some(Self::Tsx);
        }
        if lower.ends_with(".ts") || lower.ends_with(".mts") || lower.ends_with(".cts") {
            return Some(Self::TypeScript);
        }
        if lower.ends_with(".js")
            || lower.ends_with(".mjs")
            || lower.ends_with(".cjs")
            || lower.ends_with(".jsx")
        {
            return Some(Self::JavaScript);
        }
        if lower.ends_with(".rs") {
            return Some(Self::Rust);
        }
        None
    }

    fn grammar(self) -> TsLanguage {
        match self {
            // JS 用 TS 文法解析：TS 是 JS 的超集，能看懂 .js 里的一切
            Self::TypeScript | Self::JavaScript => {
                tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()
            }
            Self::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
            Self::Rust => tree_sitter_rust::LANGUAGE.into(),
        }
    }

    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TypeScript => "typescript",
            Self::Tsx => "tsx",
            Self::JavaScript => "javascript",
            Self::Rust => "rust",
        }
    }
}

/// 这个路径是否属于受支持的语言（工具面在索引前先用它给出可读错误）。
#[must_use]
pub fn lang_supported(path: &str) -> bool {
    Lang::for_path(path).is_some()
}

/// 符号种类。字符串值直接进 JSON（工具面可见），改动等于改契约。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SymbolKind {
    Function,
    Method,
    Class,
    Interface,
    Enum,
    Struct,
    Trait,
    Impl,
    Type,
    Const,
    Module,
    Variable,
}

/// 一个符号。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Symbol {
    pub name: String,
    pub kind: SymbolKind,
    /// 相对索引根的路径（正斜杠），跨平台一致
    pub path: String,
    /// 1 起算的行号（tree-sitter 的 row 是 0 起算）
    pub line: u32,
    pub end_line: u32,
    /// 直接外层符号名（方法 → 类名）；顶层符号为 `None`
    pub parent: Option<String>,
    /// TS/JS：处在 `export` 语句里；Rust：带 `pub`
    pub exported: bool,
}

/// 边的种类。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EdgeKind {
    /// 文件 → 模块说明符（`./x`、`@/y`、`crate::z`）
    Import,
    /// 文件 → 被调用的名字（按名字连，不做消解）
    Call,
}

/// 一条边：`from` 是相对路径，`to` 是说明符或名字。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    pub from: String,
    pub to: String,
    pub kind: EdgeKind,
    pub line: u32,
}

/// 单个文件的索引结果。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIndex {
    pub symbols: Vec<Symbol>,
    pub edges: Vec<Edge>,
}

impl FileIndex {
    /// 把单文件结果包成一个索引（测试与「只索引一个文件」的场景共用）。
    #[must_use]
    pub fn into_index(self, root: &str) -> Index {
        Index {
            root: root.to_string(),
            files: 1,
            skipped: 0,
            symbols: self.symbols,
            edges: self.edges,
        }
    }
}

/// 整个仓库的索引结果。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Index {
    pub root: String,
    /// 实际解析成功的文件数
    pub files: usize,
    /// 因为超过 `MAX_FILES` 没扫的文件数（0 = 完整索引）
    pub skipped: usize,
    pub symbols: Vec<Symbol>,
    pub edges: Vec<Edge>,
}

impl Index {
    /// 按名字找符号（子串、大小写不敏感）。
    #[must_use]
    pub fn search(&self, needle: &str, limit: usize) -> Vec<&Symbol> {
        let needle = needle.trim().to_ascii_lowercase();
        if needle.is_empty() {
            return Vec::new();
        }
        self.symbols
            .iter()
            .filter(|symbol| symbol.name.to_ascii_lowercase().contains(&needle))
            .take(limit)
            .collect()
    }

    /// 某个文件里的符号（按行号升序）。
    #[must_use]
    pub fn outline(&self, path: &str) -> Vec<&Symbol> {
        let normalized = normalize_path(path);
        let mut rows: Vec<&Symbol> = self
            .symbols
            .iter()
            .filter(|symbol| symbol.path == normalized)
            .collect();
        rows.sort_by_key(|symbol| symbol.line);
        rows
    }

    /// 指向某个名字 / 说明符的边（谁引用了它）。
    #[must_use]
    pub fn refs(&self, target: &str, limit: usize) -> Vec<&Edge> {
        let needle = target.trim();
        if needle.is_empty() {
            return Vec::new();
        }
        self.edges
            .iter()
            .filter(|edge| edge_matches(edge, needle))
            .take(limit)
            .collect()
    }

    /// 影响面：谁（传递地）引用了这个名字。按广度优先展开，结果去重。
    ///
    /// 说明符与文件名互相认一下（`./session` → `session.ts`），否则从 import 边
    /// 走到下一层就断了 —— 这是本索引唯一做的一点「消解」。
    #[must_use]
    pub fn impact(&self, target: &str, depth: usize, limit: usize) -> Vec<String> {
        let mut seen: Vec<String> = Vec::new();
        let mut frontier: Vec<String> = vec![target.trim().to_string()];
        for _ in 0..depth {
            let mut next: Vec<String> = Vec::new();
            for needle in &frontier {
                for edge in self.edges.iter().filter(|edge| edge_matches(edge, needle)) {
                    if seen.contains(&edge.from) || next.contains(&edge.from) {
                        continue;
                    }
                    next.push(edge.from.clone());
                    if seen.len() + next.len() >= limit {
                        break;
                    }
                }
            }
            if next.is_empty() {
                break;
            }
            seen.extend(next.iter().cloned());
            frontier = next;
            if seen.len() >= limit {
                break;
            }
        }
        seen.truncate(limit);
        seen
    }
}

fn edge_matches(edge: &Edge, needle: &str) -> bool {
    if edge.to == needle {
        return true;
    }
    // `./session` 与 `@/features/agent/acp/session` 都应命中 `session.ts`
    let last = edge.to.rsplit(['/', ':']).next().unwrap_or(&edge.to);
    if last.is_empty() {
        return false;
    }
    let stem = needle
        .rsplit('/')
        .next()
        .unwrap_or(needle)
        .trim_end_matches(".ts")
        .trim_end_matches(".tsx")
        .trim_end_matches(".js")
        .trim_end_matches(".rs");
    !stem.is_empty() && (last == stem || last == needle)
}

/// 把路径规整成「相对、正斜杠」的形态，让同一文件在 Windows 上也只有一个写法。
#[must_use]
pub fn normalize_path(path: &str) -> String {
    path.replace('\\', "/")
}

/// 解析一份源码。
///
/// 语法错误不报错：tree-sitter 是容错的，能解多少算多少 —— 索引半成品比没有索引有用。
pub fn index_source(lang: Lang, path: &str, source: &str) -> FileIndex {
    let mut parser = Parser::new();
    if parser.set_language(&lang.grammar()).is_err() {
        return FileIndex::default();
    }
    let Some(tree) = parser.parse(source, None) else {
        return FileIndex::default();
    };
    let mut ctx = Ctx {
        lang,
        path: &normalize_path(path),
        source,
        index: FileIndex::default(),
        export_depth: 0,
    };
    ctx.walk(tree.root_node(), None);
    ctx.index
        .symbols
        .sort_by_key(|symbol| (symbol.line, symbol.end_line));
    ctx.index
}

struct Ctx<'a> {
    lang: Lang,
    path: &'a str,
    source: &'a str,
    index: FileIndex,
    /// >0 表示正处在 `export_statement` 里（TS/JS 的导出判定）
    export_depth: u32,
}

impl Ctx<'_> {
    fn text(&self, node: Node<'_>) -> &str {
        self.source.get(node.byte_range()).unwrap_or("")
    }

    fn name_of(&self, node: Node<'_>) -> Option<String> {
        node.child_by_field_name("name")
            .map(|child| self.text(child).trim().to_string())
            .filter(|name| !name.is_empty())
    }

    fn push_symbol(
        &mut self,
        node: Node<'_>,
        name: String,
        kind: SymbolKind,
        parent: Option<&str>,
    ) {
        let exported = if self.lang == Lang::Rust {
            (0..node.child_count()).any(|index| {
                node.child(index)
                    .is_some_and(|child| child.kind() == "visibility_modifier")
            })
        } else {
            self.export_depth > 0
        };
        self.index.symbols.push(Symbol {
            name,
            kind,
            path: self.path.to_string(),
            line: node.start_position().row as u32 + 1,
            end_line: node.end_position().row as u32 + 1,
            parent: parent.map(str::to_string),
            exported,
        });
    }

    fn push_edge(&mut self, node: Node<'_>, to: String, kind: EdgeKind) {
        let target = to.trim().to_string();
        if target.is_empty() {
            return;
        }
        self.index.edges.push(Edge {
            from: self.path.to_string(),
            to: target,
            kind,
            line: node.start_position().row as u32 + 1,
        });
    }

    fn walk(&mut self, node: Node<'_>, parent: Option<&str>) {
        let kind = node.kind();
        match kind {
            "export_statement" => {
                self.export_depth += 1;
                self.walk_children(node, parent);
                self.export_depth -= 1;
                return;
            }
            "import_statement" | "export_statement_import" => {
                if let Some(source) = node.child_by_field_name("source") {
                    let raw = self
                        .text(source)
                        .trim()
                        .trim_matches(['"', '\''])
                        .to_string();
                    self.push_edge(node, raw, EdgeKind::Import);
                }
                self.walk_children(node, parent);
                return;
            }
            "use_declaration" => {
                // Rust: `use crate::x::Y;` —— 整段路径文本就是说明符
                let raw = self
                    .text(node)
                    .trim()
                    .trim_start_matches("use ")
                    .trim_end_matches(';');
                self.push_edge(node, raw.to_string(), EdgeKind::Import);
                self.walk_children(node, parent);
                return;
            }
            "call_expression" => {
                if let Some(callee) = node.child_by_field_name("function") {
                    let name = self.text(callee).trim().to_string();
                    // 只认「看起来是个名字」的被调用方，`(x => x)()` 之类跳过
                    if !name.is_empty()
                        && name.len() <= 120
                        && name
                            .chars()
                            .all(|ch| ch.is_alphanumeric() || "../_:$<>#[]".contains(ch))
                    {
                        self.push_edge(node, name, EdgeKind::Call);
                    }
                }
                self.walk_children(node, parent);
                return;
            }
            _ => {}
        }

        if let Some((symbol_kind, name)) = self.symbol_of(node) {
            self.push_symbol(node, name.clone(), symbol_kind, parent);
            self.walk_children(node, Some(&name));
            return;
        }

        // 变量声明里的箭头函数 / 函数表达式：`const foo = () => {}` 也是一个函数
        if kind == "lexical_declaration" || kind == "variable_declaration" {
            let mut cursor = node.walk();
            for declarator in node.children_by_field_name("declarator", &mut cursor) {
                self.maybe_arrow_function(declarator, parent);
            }
            // 某些文法版本把 declarator 放在匿名子节点里
            let mut child_cursor = node.walk();
            for child in node.named_children(&mut child_cursor) {
                if child.kind() == "variable_declarator" {
                    self.maybe_arrow_function(child, parent);
                }
            }
            return;
        }

        self.walk_children(node, parent);
    }

    fn maybe_arrow_function(&mut self, declarator: Node<'_>, parent: Option<&str>) {
        let Some(name) = self.name_of(declarator) else {
            return;
        };
        let Some(value) = declarator.child_by_field_name("value") else {
            return;
        };
        let kind = if matches!(
            value.kind(),
            "arrow_function" | "function" | "function_expression" | "generator_function"
        ) {
            SymbolKind::Function
        } else {
            SymbolKind::Variable
        };
        self.push_symbol(declarator, name.clone(), kind, parent);
        self.walk_children(value, Some(&name));
    }

    /// 节点本身是不是一个「有名字的符号」。
    fn symbol_of(&self, node: Node<'_>) -> Option<(SymbolKind, String)> {
        let kind = match node.kind() {
            "function_declaration" | "generator_function_declaration" => SymbolKind::Function,
            "function_item" => SymbolKind::Function,
            "method_definition" => SymbolKind::Method,
            "class_declaration" | "abstract_class_declaration" => SymbolKind::Class,
            "interface_declaration" => SymbolKind::Interface,
            "enum_declaration" | "enum_item" => SymbolKind::Enum,
            "struct_item" => SymbolKind::Struct,
            "trait_item" => SymbolKind::Trait,
            "type_alias_declaration" | "type_item" => SymbolKind::Type,
            "const_item" | "static_item" | "const_declaration" => SymbolKind::Const,
            "mod_item" => SymbolKind::Module,
            "impl_item" => SymbolKind::Impl,
            _ => return None,
        };
        let name = if node.kind() == "impl_item" {
            // impl 没有 name 字段：用 `type` 字段（`impl Foo for Bar` 取 Bar）
            node.child_by_field_name("type")
                .map(|child| self.text(child).trim().to_string())
        } else {
            self.name_of(node)
        }?;
        Some((kind, name))
    }

    fn walk_children(&mut self, node: Node<'_>, parent: Option<&str>) {
        let mut cursor = node.walk();
        for child in node.named_children(&mut cursor) {
            self.walk(child, parent);
        }
    }
}

/// 索引一棵目录树。
///
/// 顺序稳定（按路径排序），这样两次索引的 JSON 可以直接比对。
pub fn index_root(root: &Path) -> Result<Index, String> {
    let canonical =
        fs::canonicalize(root).map_err(|error| format!("无法访问 {}：{error}", root.display()))?;
    if !canonical.is_dir() {
        return Err(format!("{} 不是目录", canonical.display()));
    }
    let mut files: Vec<PathBuf> = Vec::new();
    let mut skipped = 0usize;
    collect(&canonical, 0, &mut files, &mut skipped)?;
    files.sort();

    let mut index = Index {
        root: normalize_path(&canonical.to_string_lossy()),
        files: 0,
        skipped,
        ..Index::default()
    };
    for file in files {
        let Ok(relative) = file.strip_prefix(&canonical) else {
            continue;
        };
        let relative = normalize_path(&relative.to_string_lossy());
        let Some(lang) = Lang::for_path(&relative) else {
            continue;
        };
        let Ok(metadata) = fs::metadata(&file) else {
            continue;
        };
        if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
            continue;
        }
        let Ok(bytes) = fs::read(&file) else {
            continue;
        };
        let source = String::from_utf8_lossy(&bytes);
        let file_index = index_source(lang, &relative, &source);
        index.files += 1;
        index.symbols.extend(file_index.symbols);
        index.edges.extend(file_index.edges);
    }
    // 全库排序：上层要「按文件 + 行号」稳定输出
    index
        .symbols
        .sort_by(|a, b| a.path.cmp(&b.path).then(a.line.cmp(&b.line)));
    index.edges.sort_by(|a, b| {
        a.from
            .cmp(&b.from)
            .then(a.line.cmp(&b.line))
            .then(a.to.cmp(&b.to))
    });
    Ok(index)
}

fn collect(
    dir: &Path,
    depth: usize,
    files: &mut Vec<PathBuf>,
    skipped: &mut usize,
) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Ok(());
    }
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        // 无权限的目录跳过即可：索引是尽力而为
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            let name = entry.file_name().to_string_lossy().to_string();
            if SKIP_DIRS.contains(&name.as_str()) || name.starts_with('.') {
                continue;
            }
            collect(&path, depth + 1, files, skipped)?;
            continue;
        }
        if files.len() >= MAX_FILES {
            *skipped += 1;
            continue;
        }
        files.push(path);
    }
    Ok(())
}

/// 给工具面用的一句话摘要（诊断 / 日志）。
#[must_use]
pub fn describe(index: &Index) -> String {
    let mut text = String::new();
    let _ = write!(
        text,
        "{} 个文件 / {} 个符号 / {} 条边",
        index.files,
        index.symbols.len(),
        index.edges.len()
    );
    if index.skipped > 0 {
        let _ = write!(text, "（另有 {} 个文件因超过上限未索引）", index.skipped);
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    const TS_SOURCE: &str = r#"
import { join } from 'node:path'
import { helper } from './helper'

export interface Options {
  root: string
}

export class Indexer {
  build(options: Options) {
    return helper(options.root)
  }
}

export function indexRoot(root: string): number {
  const indexer = new Indexer()
  return join(root, indexer.build({ root }))
}

const internal = (value: number) => value + 1
"#;

    const RS_SOURCE: &str = r#"
use std::path::Path;

pub struct Board {
    jobs: usize,
}

impl Board {
    pub fn spawn(&self) -> usize {
        self.jobs + 1
    }
}

fn private_helper() -> usize {
    Board { jobs: 0 }.spawn()
}
"#;

    #[test]
    fn detects_language_by_extension() {
        assert_eq!(Lang::for_path("a/b/c.ts"), Some(Lang::TypeScript));
        assert_eq!(Lang::for_path("a/App.tsx"), Some(Lang::Tsx));
        assert_eq!(Lang::for_path("a/x.rs"), Some(Lang::Rust));
        assert_eq!(Lang::for_path("a/x.py"), None);
    }

    /// 单文件源码 → 可直接查的索引
    fn ts_index() -> Index {
        index_source(Lang::TypeScript, "src/indexer.ts", TS_SOURCE).into_index("src")
    }

    #[test]
    fn typescript_symbols_cover_functions_classes_interfaces() {
        let index = ts_index();
        let names: Vec<&str> = index.symbols.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"Options"), "{names:?}");
        assert!(names.contains(&"Indexer"), "{names:?}");
        assert!(names.contains(&"indexRoot"), "{names:?}");
        // 箭头函数也算函数
        let arrow = index
            .symbols
            .iter()
            .find(|s| s.name == "internal")
            .expect("箭头函数应被索引");
        assert_eq!(arrow.kind, SymbolKind::Function);
        // 方法挂在类下
        let method = index
            .symbols
            .iter()
            .find(|s| s.name == "build")
            .expect("方法应被索引");
        assert_eq!(method.kind, SymbolKind::Method);
        assert_eq!(method.parent.as_deref(), Some("Indexer"));
    }

    #[test]
    fn typescript_export_flag_follows_export_statement() {
        let index = ts_index();
        let exported = |name: &str| {
            index
                .symbols
                .iter()
                .find(|s| s.name == name)
                .map(|s| s.exported)
                .unwrap_or(false)
        };
        assert!(exported("Indexer"));
        assert!(exported("indexRoot"));
        assert!(!exported("internal"), "没有 export 的箭头函数不该标成导出");
    }

    #[test]
    fn typescript_records_import_edges() {
        let index = ts_index();
        let imports: Vec<&str> = index
            .edges
            .iter()
            .filter(|edge| edge.kind == EdgeKind::Import)
            .map(|edge| edge.to.as_str())
            .collect();
        assert!(imports.contains(&"node:path"), "{imports:?}");
        assert!(imports.contains(&"./helper"), "{imports:?}");
        // 调用边按名字连
        assert!(
            index
                .edges
                .iter()
                .any(|edge| edge.kind == EdgeKind::Call && edge.to == "helper"),
            "应记录 helper 调用边"
        );
    }

    #[test]
    fn rust_symbols_and_visibility() {
        let index = index_source(Lang::Rust, "src/board.rs", RS_SOURCE);
        let field = |name: &str| index.symbols.iter().find(|s| s.name == name).cloned();
        assert_eq!(field("Board").expect("struct").kind, SymbolKind::Struct);
        assert!(field("Board").expect("struct").exported);
        assert_eq!(field("Board").expect("struct").kind, SymbolKind::Struct);
        assert!(
            !field("private_helper").expect("fn").exported,
            "没有 pub 的不算导出"
        );
        assert_eq!(field("Board").expect("struct").line, 4);
        let uses: Vec<&str> = index
            .edges
            .iter()
            .filter(|edge| edge.kind == EdgeKind::Import)
            .map(|edge| edge.to.as_str())
            .collect();
        assert!(uses.contains(&"std::path::Path"), "{uses:?}");
    }

    #[test]
    fn outline_and_search_and_refs_work_on_a_real_index() {
        let index = ts_index();
        let outline: Vec<&str> = index
            .outline("src/indexer.ts")
            .iter()
            .map(|s| s.name.as_str())
            .collect();
        assert!(outline.contains(&"Indexer"));
        assert!(
            index
                .search("indexer", 10)
                .iter()
                .any(|s| s.name == "Indexer")
        );
        assert!(index.search("", 10).is_empty(), "空查询不返回全部");
        // 一个说明符会同时命中 import 边与同名的 call 边：refs 是「所有指向它的边」，
        // 精确到种类由调用方自己筛
        let refs: Vec<&Edge> = index.refs("./helper", 10);
        assert_eq!(
            refs.iter()
                .filter(|edge| edge.kind == EdgeKind::Import)
                .count(),
            1
        );
        assert!(
            refs.iter()
                .any(|edge| edge.kind == EdgeKind::Call && edge.to == "helper"),
            "{refs:?}"
        );
    }

    #[test]
    fn impact_follows_importers_transitively() {
        // a.ts → b.ts → c.ts（导入说明符与路径互相认）
        let mut graph = Index::default();
        graph.edges.push(Edge {
            from: "src/b.ts".to_string(),
            to: "./c".to_string(),
            kind: EdgeKind::Import,
            line: 1,
        });
        graph.edges.push(Edge {
            from: "src/a.ts".to_string(),
            to: "./b".to_string(),
            kind: EdgeKind::Import,
            line: 1,
        });
        let impact = graph.impact("c.ts", 4, 10);
        assert_eq!(impact, vec!["src/b.ts".to_string(), "src/a.ts".to_string()]);
    }

    #[test]
    fn index_root_skips_dependencies_and_unknown_extensions() {
        let base = std::env::temp_dir().join(format!("codeindex-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("src")).expect("mkdir src");
        fs::create_dir_all(base.join("node_modules/pkg")).expect("mkdir node_modules");
        fs::write(base.join("src/a.ts"), "export const a = 1\n").expect("write ts");
        fs::write(base.join("src/b.rs"), "pub fn b() {}\n").expect("write rs");
        fs::write(base.join("src/readme.md"), "# hi\n").expect("write md");
        fs::write(base.join("node_modules/pkg/c.ts"), "export const c = 2\n").expect("write dep");

        let index = index_root(&base).expect("index");
        assert_eq!(index.files, 2, "只该扫 src 下的 ts/rs");
        assert!(index.root.contains("codeindex-test-"), "{}", index.root);
        let names: Vec<&str> = index.symbols.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"a") && names.contains(&"b"), "{names:?}");
        assert!(!names.contains(&"c"), "node_modules 不该被索引");
        let _ = fs::remove_dir_all(&base);
    }
}
