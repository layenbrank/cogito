//! 浏览器工具面（`app_browser_*`）的**目录**。
//!
//! 目录与实现分开是刻意的：`cogito-core` 不能依赖 tauri，也就拿不到 `AppHandle`，
//! 但工具目录必须单点定义（否则 MCP `tools/list` 和前端审批看不到这些工具）。
//! 所以这里只给 `specs()` / `owns()`，真正的执行在 app 侧
//! `src/bridge/app_tools.rs`（走 `browser::agent` 的 CDP 通道）。
//!
//! 这些工具操作的是**用户正在看的那个内嵌浏览器**，不是网络抓取：`tab` 省略时
//! 一律落到当前活动标签页，和浏览器插件的直觉一致。

use serde_json::{Value, json};

use super::{Effect, ToolSpec};

pub const OPEN: &str = "app_browser_open";
pub const READ: &str = "app_browser_read";
pub const ACT: &str = "app_browser_act";
pub const SCREENSHOT: &str = "app_browser_screenshot";
pub const NETWORK: &str = "app_browser_network";
pub const INTERCEPT: &str = "app_browser_intercept";

const NAMES: [&str; 6] = [OPEN, READ, ACT, SCREENSHOT, NETWORK, INTERCEPT];

/// `tab` 的公共属性：省略即当前活动标签页
fn tab_property() -> Value {
    json!({
        "type": "string",
        "description": "标签页 label（形如 browser-1）；省略表示当前活动的那个"
    })
}

fn spec(name: &str, description: &str, effect: Effect, input_schema: Value) -> ToolSpec {
    ToolSpec {
        name: name.to_string(),
        description: description.to_string(),
        input_schema,
        effect,
    }
}

#[must_use]
pub fn specs() -> Vec<ToolSpec> {
    vec![
        spec(
            OPEN,
            "在内嵌浏览器里打开一个地址，返回新标签页的 label。用户能看到这个页面。",
            Effect::Read,
            json!({
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "要打开的地址，可以省略协议（example.com 会补 https://）" }
                },
                "required": ["url"]
            }),
        ),
        spec(
            READ,
            "读取内嵌浏览器的页面：`outline` 返回可交互元素清单（带 selector，可直接喂给 app_browser_act），`text` 返回正文。",
            Effect::Read,
            json!({
                "type": "object",
                "properties": {
                    "tab": tab_property(),
                    "mode": {
                        "type": "string",
                        "enum": ["outline", "text"],
                        "description": "默认 outline；要抓正文用 text"
                    },
                    "limit": {
                        "type": "integer",
                        "minimum": 1,
                        "description": "最多返回多少项，默认 60，上限 200"
                    }
                }
            }),
        ),
        spec(
            ACT,
            "操作内嵌浏览器：点击 / 输入 / 按键 / 滚动。selector 用 app_browser_read 返回的那个。",
            Effect::Write,
            json!({
                "type": "object",
                "properties": {
                    "tab": tab_property(),
                    "action": {
                        "type": "string",
                        "enum": ["click", "type", "press", "scroll", "hover"],
                        "description": "scroll 作用于整个页面（value 为像素），其余作用于 selector"
                    },
                    "selector": { "type": "string", "description": "CSS 选择器；scroll 时可省略" },
                    "value": { "type": "string", "description": "type 的输入内容 / press 的按键名（默认 Enter）/ scroll 的像素（默认 600）" }
                },
                "required": ["action"]
            }),
        ),
        spec(
            SCREENSHOT,
            "对当前标签页截图，返回一张图片。只读 DOM 拿不到视觉信息（配色、间距、字体、布局、图片/图表内容）—— 需要判断页面到底长什么样、样式对不对、有没有错位，或者要看图本身时用它。",
            Effect::Read,
            json!({
                "type": "object",
                "properties": { "tab": tab_property() }
            }),
        ),
        spec(
            NETWORK,
            "列出这个标签页发出的网络请求（方法 / URL / 状态码 / 大小 / 耗时，最新的在前）。只包含开启记录之后发生的请求。",
            Effect::Read,
            json!({
                "type": "object",
                "properties": {
                    "tab": tab_property(),
                    "filter": { "type": "string", "description": "URL 子串过滤，例如 api/ 或某个域名" },
                    "limit": { "type": "integer", "minimum": 1, "description": "最多返回多少条，默认 200" }
                }
            }),
        ),
        spec(
            INTERCEPT,
            "设置请求拦截规则：命中 pattern 的请求可以直接掉断（block）、换成固定响应（mock），或者改地址/改头/改体后再放行（edit，即改参重发）。传空数组关闭拦截。规则在当前标签页内一直生效，用完就清掉。",
            Effect::Write,
            json!({
                "type": "object",
                "properties": {
                    "tab": tab_property(),
                    "rules": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "pattern": { "type": "string", "description": "URL 子串，命中即生效" },
                                "action": { "type": "string", "enum": ["block", "mock", "edit"] },
                                "status": { "type": "integer", "description": "mock 的状态码，默认 200" },
                                "body": { "type": "string", "description": "mock 的响应体原文" },
                                "mime": { "type": "string", "description": "mock 的 Content-Type，默认 application/json" },
                                "url": { "type": "string", "description": "edit：把请求改发到这个地址" },
                                "headers": {
                                    "type": "array",
                                    "description": "edit：覆盖/追加的请求头",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "name": { "type": "string" },
                                            "value": { "type": "string" }
                                        },
                                        "required": ["name", "value"]
                                    }
                                },
                                "postData": { "type": "string", "description": "edit：替换的请求体原文" }
                            },
                            "required": ["pattern", "action"]
                        }
                    }
                },
                "required": ["rules"]
            }),
        ),
    ]
}

/// 这个名字是否归浏览器工具面管（`bridge` 靠它决定交给谁执行）
#[must_use]
pub fn owns(name: &str) -> bool {
    NAMES.contains(&name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_covers_every_owned_name() {
        let names: Vec<String> = specs().into_iter().map(|spec| spec.name).collect();
        for name in NAMES {
            assert!(names.iter().any(|item| item == name), "{name} 缺描述");
        }
    }

    #[test]
    fn every_schema_is_object() {
        for spec in specs() {
            assert_eq!(
                spec.input_schema.get("type").and_then(Value::as_str),
                Some("object"),
                "{} 的 inputSchema 必须是 object",
                spec.name
            );
        }
    }

    #[test]
    fn act_is_the_only_write_tool() {
        for spec in specs() {
            let expected = if spec.name == ACT || spec.name == INTERCEPT {
                Effect::Write
            } else {
                Effect::Read
            };
            assert_eq!(spec.effect, expected, "{} 的效果标错了", spec.name);
        }
    }
}
