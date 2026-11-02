//! 终端工具面（`app_terminal_*`）的**目录**。
//!
//! 与浏览器工具同一个理由：`cogito-core` 不依赖 tauri，拿不到 `AppHandle`，
//! 但工具目录必须单点定义（MCP `tools/list` 与前端审批都看它）。执行在 app 侧
//! `src/bridge/app_tools.rs`，底层是 `utils::terminal` 的 PTY 会话。
//!
//! 这些工具跑的是**用户右栏能看见的那个嵌入式终端**：命令会打进去、输出会留在回滚缓冲里，
//! 用户随时可以接管（直接接着敲），对齐 VS Code 里 agent 用终端的方式。

use serde_json::{Value, json};

use super::{Effect, ToolSpec};

pub const RUN: &str = "app_terminal_run";
pub const READ: &str = "app_terminal_read";
pub const WRITE: &str = "app_terminal_write";
pub const LIST: &str = "app_terminal_list";

const NAMES: [&str; 4] = [RUN, READ, WRITE, LIST];

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
            RUN,
            "在用户看得见的嵌入式终端里执行一条命令，并把这期间输出读回来。适合需要用户围观/接管的命令（构建、测试、dev server）。\
             结束判定是「安静期」：超过 quietMs 没有新输出即视为跑完；持续输出的命令会等到 timeoutMs，\
             返回 isRunning=true 与到目前的部分输出，此时用 app_terminal_read 继续读。命令在同一个 tab 里串行执行，不要并发调用。",
            Effect::Write,
            json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "要执行的命令（单行；需要多条时用 && 或 ; 串联）" },
                    "cwd": { "type": "string", "description": "在哪个目录开终端（绝对路径）；同一目录复用同一个 tab" },
                    "quietMs": { "type": "integer", "minimum": 50, "description": "多久没输出算结束，默认 700" },
                    "timeoutMs": { "type": "integer", "minimum": 500, "description": "单次等待上限，默认 120000" }
                },
                "required": ["command"]
            }),
        ),
        spec(
            READ,
            "读嵌入式终端最近的输出（去 ANSI 后的纯文本）。用于 app_terminal_run 返回 isRunning=true 之后续读，或用户自己在终端里跑过东西时看一眼结果。未选中的 tab 也可读。",
            Effect::Read,
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "终端会话 id；省略表示当前 cwd 派生的那个 agent 会话" },
                    "cwd": { "type": "string", "description": "配合 id 省略时使用：这个目录的 agent 会话" },
                    "maxChars": { "type": "integer", "minimum": 200, "description": "最多返回多少字符，默认 12000" }
                }
            }),
        ),
        spec(
            WRITE,
            "向嵌入式终端会话写入文本（不自动加回车时可自行在 data 末尾加 \\r）。用于 isRunning 后台会话的交互输入（密码提示、确认），不要用来开新命令——开命令用 app_terminal_run。",
            Effect::Write,
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "终端会话 id；省略表示 cwd 派生的 agent 会话" },
                    "cwd": { "type": "string", "description": "配合 id 省略时使用" },
                    "data": { "type": "string", "description": "要写入 PTY 的原始文本" }
                },
                "required": ["data"]
            }),
        ),
        spec(
            LIST,
            "列出当前打开的嵌入式终端会话（id / cwd / pid）。id 可以喂给 app_terminal_read / app_terminal_write。",
            Effect::Read,
            json!({ "type": "object", "properties": {} }),
        ),
    ]
}

/// 这个名字是否归终端工具面管（`bridge` 靠它决定交给谁执行）
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
    fn only_run_and_write_write() {
        for spec in specs() {
            let expected = if spec.name == RUN || spec.name == WRITE {
                Effect::Write
            } else {
                Effect::Read
            };
            assert_eq!(spec.effect, expected, "{} 的效果标错了", spec.name);
        }
    }
}
