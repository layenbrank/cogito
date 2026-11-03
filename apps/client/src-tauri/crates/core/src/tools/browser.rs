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
pub const WAIT: &str = "app_browser_wait";
pub const SCREENSHOT: &str = "app_browser_screenshot";
pub const NETWORK: &str = "app_browser_network";
pub const INTERCEPT: &str = "app_browser_intercept";
pub const DEVICE: &str = "app_browser_device";

const NAMES: [&str; 8] = [OPEN, READ, ACT, WAIT, SCREENSHOT, NETWORK, INTERCEPT, DEVICE];

/// `tab` 的公共属性：省略即当前活动标签页
fn tab_property() -> Value {
    json!({
        "type": "string",
        "description": "标签页 label（形如 browser-<uuid>）；省略表示当前活动的那个；未选中的 tab 也可传"
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
            "在内嵌浏览器里打开一个地址，返回标签页的 label。默认复用同 host+port 的已有标签并激活；需要并列开多页时传 forceNew=true。用户能看到这个页面。",
            Effect::Read,
            json!({
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "要打开的地址，可以省略协议（example.com 会补 https://）" },
                    "forceNew": {
                        "type": "boolean",
                        "description": "true 时强制新建标签页；默认 false，同 host+port 已有标签则复用并激活"
                    }
                },
                "required": ["url"]
            }),
        ),
        spec(
            READ,
            "读取内嵌浏览器的页面：`outline` 返回可交互元素清单（带 selector，可直接喂给 app_browser_act），`text` 返回正文；`assertText` / `assertVisible` 做断言（失败返回 ok:false 与 reason，供重试）。",
            Effect::Read,
            json!({
                "type": "object",
                "properties": {
                    "tab": tab_property(),
                    "mode": {
                        "type": "string",
                        "enum": ["outline", "text", "assertText", "assertVisible"],
                        "description": "默认 outline；assertText 需 value=期望子串；assertVisible 需 selector"
                    },
                    "limit": {
                        "type": "integer",
                        "minimum": 1,
                        "description": "最多返回多少项，默认 60，上限 200"
                    },
                    "selector": { "type": "string", "description": "assertVisible / 可选断言范围" },
                    "value": { "type": "string", "description": "assertText 的期望子串" }
                }
            }),
        ),
        spec(
            ACT,
            "操作内嵌浏览器：点击 / 输入 / 按键 / 滚动 / 悬停 / 刷新 / 选择 native select。selector 用 app_browser_read 返回的那个。",
            Effect::Write,
            json!({
                "type": "object",
                "properties": {
                    "tab": tab_property(),
                    "action": {
                        "type": "string",
                        "enum": ["click", "type", "press", "scroll", "hover", "reload", "select"],
                        "description": "scroll 作用于整个页面（value 为像素），reload 重载当前页（不需要 selector），select 的 value 为 option value 或可见文案，其余作用于 selector"
                    },
                    "selector": { "type": "string", "description": "CSS 选择器；scroll 与 reload 时可省略" },
                    "value": { "type": "string", "description": "type 的输入 / press 的按键 / scroll 像素 / reload=hard / select 的选项" }
                },
                "required": ["action"]
            }),
        ),
        spec(
            WAIT,
            "等待页面条件：selector 出现/可点，或 networkIdle。替代固定 sleep，走通 H5/PC 交互链时优先用它。",
            Effect::Read,
            json!({
                "type": "object",
                "properties": {
                    "tab": tab_property(),
                    "condition": {
                        "type": "string",
                        "enum": ["selector", "visible", "clickable", "networkIdle"],
                        "description": "默认 selector（元素出现在 DOM）；visible=可见；clickable=可见且未 disabled；networkIdle=短窗口无新请求"
                    },
                    "selector": { "type": "string", "description": "CSS 选择器；networkIdle 时可省略" },
                    "timeoutMs": {
                        "type": "integer",
                        "minimum": 100,
                        "description": "超时毫秒，默认 8000，上限 60000"
                    }
                }
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
        spec(
            DEVICE,
            "把内嵌浏览器切换成某个设备（移动端 H5 调试）：设定 CSS 视口尺寸、DPR、移动端 UA、触摸与 `pointer: coarse`，并把预览缩放适配面板。验 H5 移动端效果前先用它切设备，再用 app_browser_read / app_browser_screenshot 看效果；用完传 off=true 复原。",
            Effect::Write,
            json!({
                "type": "object",
                "properties": {
                    "tab": tab_property(),
                    "preset": {
                        "type": "string",
                        "enum": ["iphone-15-pro", "iphone-se", "pixel-8", "ipad-mini", "android", "desktop"],
                        "description": "预设设备（iPhone 15 Pro / iPhone SE / Pixel 8 / iPad Mini / Android / 桌面）；与 width+height 二选一"
                    },
                    "width": { "type": "integer", "minimum": 1, "description": "自定义 CSS 视口宽度" },
                    "height": { "type": "integer", "minimum": 1, "description": "自定义 CSS 视口高度" },
                    "dpr": { "type": "number", "description": "devicePixelRatio；省略 = 跟随系统" },
                    "mobile": { "type": "boolean", "description": "是否按移动端处理（默认 true：触摸合成 + pointer: coarse）" },
                    "userAgent": { "type": "string", "description": "覆盖 UA；省略 = 用预设的，桌面预设则保持桌面 UA" },
                    "off": { "type": "boolean", "description": "传 true 退出模拟，恢复桌面视口与 UA" }
                }
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
    fn write_tools_are_exactly_act_intercept_and_device() {
        for spec in specs() {
            let expected = if matches!(spec.name.as_str(), ACT | INTERCEPT | DEVICE) {
                Effect::Write
            } else {
                Effect::Read
            };
            assert_eq!(spec.effect, expected, "{} 的效果标错了", spec.name);
        }
    }

    #[test]
    fn wait_spec_is_read_and_listed() {
        assert!(NAMES.contains(&WAIT));
        let wait = specs()
            .into_iter()
            .find(|spec| spec.name == WAIT)
            .expect("wait 工具必须在目录里");
        assert_eq!(wait.effect, Effect::Read);
    }

    #[test]
    fn device_spec_covers_profiles_and_off() {
        let device = specs()
            .into_iter()
            .find(|spec| spec.name == DEVICE)
            .expect("设备工具必须在目录里");
        let properties = &device.input_schema["properties"];
        assert!(properties.get("tab").is_some(), "要能指定标签页");
        assert!(properties.get("preset").is_some());
        assert!(properties.get("width").is_some());
        assert!(properties.get("height").is_some());
        assert!(properties.get("dpr").is_some());
        assert!(properties.get("mobile").is_some());
        assert!(properties.get("userAgent").is_some());
        assert!(properties.get("off").is_some(), "退出模拟只能靠 off");
        assert!(
            device.input_schema.get("required").is_none(),
            "全部可选：preset 与 width+height 二选一，由实现校验"
        );
    }
}
