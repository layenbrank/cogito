//! goose 的 `permission.yaml`：读出来给用户看，并提供「重置手动偏好」。
//!
//! ## 为什么要碰这个文件
//!
//! goose 的 `PermissionInspector::inspect` 在 `Approve` / `SmartApprove` 档下**先查
//! `user` 段**，命中就按它执行，压根不看 `smart_approve`：
//!
//! ```text
//! 1. user 段命中 → Allow / Deny / RequireApproval（就此结束）
//! 2. 只读 annotation
//! 3. manage_extensions 特例
//! 4. smart_approve 段（goose 自己的 LLM 判定缓存）
//! 5. 默认要求审批
//! ```
//!
//! 于是 `user` 段一旦攒下 `write: always_allow`，cogito 的审批卡就再也不会出现 ——
//! 而用户没有任何入口能看到、更别说改回来。本模块补的就是这个缺口。
//!
//! ## 为什么只做「删除」不做「改写」
//!
//! `user` 段是**精确字符串匹配**（`Vec::contains`，不支持通配符）。看似无害的
//! 逐条改写其实做不对：老版本留下的 `cogito__app_*` 这类通配条目必须整条丢弃，
//! 而 `write` / `edit` 得挪到别处 —— 一旦写错格式，goose 启动时会
//! `panic!("Corrupted permission config")`，整个应用起不来。
//!
//! 所以重置 = **备份后删掉整个文件**：goose 在文件缺失时按空表启动
//! （`PermissionManager::new` 里 `HashMap::new()`），自己会重建。代价只是
//! `smart_approve` 的 LLM 判定缓存一起清空，下一轮重新判定 —— 行为仍然正确。
//!
//! ## 读的时候为什么手写解析
//!
//! 读只用于展示，解析失败降级成「空表 + 解析失败标志」即可，不存在写坏文件的风险。
//! 而为了读它去引一个 YAML 依赖（`serde_yaml` 已 deprecated，fork 也不在锁里）
//! 不划算。解析器只覆盖 goose 自己 `serde_yaml::to_string` 的输出格式：
//!
//! ```yaml
//! user:
//!   always_allow:
//!   - foo
//!   ask_before: []
//!   never_allow:
//!   - bar
//! ```
//!
//! 注意 `serde_yaml` 的列表项缩进是 **2 空格**（与键同级），不是 4 —— 早期手写
//! 样板里写成 4 空格会漏读。流式 `[a, b]` 与空 `[]` 两种写法都要认。

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::utils::agentd;

/// 文件名（goose `crate::config::permission::PERMISSION_FILE`）。
const PERMISSION_FILE: &str = "permission.yaml";

/// 一级分组名（goose 的 `USER_PERMISSION` / `SMART_APPROVE_PERMISSION`）。
const USER_SECTION: &str = "user";
const SMART_APPROVE_SECTION: &str = "smart_approve";

/// 三个权限桶。
///
/// 字段名走 camelCase：IPC 契约与仓库其它命令一致（见 `shared/ipc/audit.ts` 的约定），
/// Tauri 只对 command 参数做驼峰转换，返回体是自己的 `serde` 序列化，得显式声明。
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionBuckets {
    pub always_allow: Vec<String>,
    pub ask_before: Vec<String>,
    pub never_allow: Vec<String>,
}

impl PermissionBuckets {
    fn all(&self) -> impl Iterator<Item = &String> {
        self.always_allow
            .iter()
            .chain(self.ask_before.iter())
            .chain(self.never_allow.iter())
    }
}

/// 读给前端看的快照。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoosePermissions {
    /// 文件绝对路径（展示用；用户想手动改也照着这个找）。
    pub path: String,
    /// 文件是否存在。`false` 时所有桶都是空的。
    pub exists: bool,
    /// 解析失败。前端应显示「文件无法解析，建议重置」而不是「没有偏好」。
    pub unreadable: bool,
    /// `user` 段：用户手动记下的（「总是允许 / 从不允许」点出来的），**优先级最高**。
    pub user: PermissionBuckets,
    /// `smart_approve` 段：goose 的 LLM 判定缓存，不是用户偏好。
    pub smart_approve: PermissionBuckets,
}

impl GoosePermissions {
    /// `user` 段实际生效的条目数（0 表示没有手动偏好压着审批）。
    pub fn user_len(&self) -> usize {
        self.user.all().count()
    }
}

/// goose 配置根下的 `permission.yaml` 路径。
fn permission_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let root = agentd::goose_path_root(app)?;
    Ok(Path::new(&root).join("config").join(PERMISSION_FILE))
}

/// 去掉 YAML 标量的包裹（单/双引号）。
fn unquote(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.len() >= 2 {
        let bytes = trimmed.as_bytes();
        let first = bytes[0];
        let last = bytes[bytes.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return trimmed[1..trimmed.len() - 1].to_string();
        }
    }
    trimmed.to_string()
}

/// 解析 `[a, b]` / `[]` 这种流式列表；不是流式就返回 `None`。
fn parse_flow_list(raw: &str) -> Option<Vec<String>> {
    let trimmed = raw.trim();
    if !trimmed.starts_with('[') || !trimmed.ends_with(']') {
        return None;
    }
    let inner = &trimmed[1..trimmed.len() - 1];
    if inner.trim().is_empty() {
        return Some(Vec::new());
    }
    Some(
        inner
            .split(',')
            .map(unquote)
            .filter(|item| !item.is_empty())
            .collect(),
    )
}

/// 解析 goose 写出的 `permission.yaml`。
///
/// 返回 `(user, smart_approve)`；顶部出现无法识别的结构时返回 `None`（前端提示重置）。
fn parse_permission_yaml(text: &str) -> Option<(PermissionBuckets, PermissionBuckets)> {
    let mut user = PermissionBuckets::default();
    let mut smart_approve = PermissionBuckets::default();

    /// 当前生效的解析位置。`None` = 还没进任何分组（文件头注释之类）。
    struct Cursor {
        section: Option<String>,
        bucket: Option<String>,
    }

    fn bucket_mut<'a>(
        buckets: &'a mut PermissionBuckets,
        name: &str,
    ) -> Option<&'a mut Vec<String>> {
        match name {
            "always_allow" => Some(&mut buckets.always_allow),
            "ask_before" => Some(&mut buckets.ask_before),
            "never_allow" => Some(&mut buckets.never_allow),
            _ => None,
        }
    }

    let mut cursor = Cursor {
        section: None,
        bucket: None,
    };

    for line in text.lines() {
        let content = line.trim_end();
        if content.trim().is_empty() || content.trim_start().starts_with('#') {
            continue;
        }
        let indent = content.len() - content.trim_start().len();
        let body = content.trim_start();

        // 列表项：`- item`（缩进在 serde_yaml 下可能是 2 或 4，都认）
        if let Some(item) = body.strip_prefix("- ") {
            let (Some(section), Some(bucket)) = (cursor.section.as_deref(), cursor.bucket.as_deref())
            else {
                return None;
            };
            let target = match section {
                USER_SECTION => bucket_mut(&mut user, bucket),
                SMART_APPROVE_SECTION => bucket_mut(&mut smart_approve, bucket),
                _ => return None,
            }?;
            let value = unquote(item);
            if !value.is_empty() {
                target.push(value);
            }
            continue;
        }

        // 键：`key:` 或 `key: value`
        let (key, rest) = body.split_once(':')?;
        let key = key.trim();
        let rest = rest.trim();

        if indent == 0 {
            // 顶层分组
            match key {
                USER_SECTION | SMART_APPROVE_SECTION if rest.is_empty() => {
                    cursor.section = Some(key.to_string());
                    cursor.bucket = None;
                }
                _ => return None,
            }
            continue;
        }

        // 二级：三个桶
        let (Some(section), true) = (cursor.section.as_deref(), rest.is_empty() || rest.starts_with('['))
        else {
            return None;
        };
        let target = match section {
            USER_SECTION => bucket_mut(&mut user, key),
            SMART_APPROVE_SECTION => bucket_mut(&mut smart_approve, key),
            _ => None,
        };
        let Some(target) = target else {
            return None;
        };
        if rest.is_empty() {
            cursor.bucket = Some(key.to_string());
        } else {
            // 流式写法：整表已在这一行写完，且之后不再接 `-` 项
            let mut values = parse_flow_list(rest)?;
            target.append(&mut values);
            cursor.bucket = None;
        }
    }

    Some((user, smart_approve))
}

/// 读当前偏好。
pub fn read(app: &tauri::AppHandle) -> Result<GoosePermissions, String> {
    let path = permission_path(app)?;
    let display = path.to_string_lossy().into_owned();
    if !path.exists() {
        return Ok(GoosePermissions {
            path: display,
            exists: false,
            unreadable: false,
            user: PermissionBuckets::default(),
            smart_approve: PermissionBuckets::default(),
        });
    }
    let text = fs::read_to_string(&path)
        .map_err(|error| format!("读取 {display} 失败: {error}"))?;
    match parse_permission_yaml(&text) {
        Some((user, smart_approve)) => Ok(GoosePermissions {
            path: display,
            exists: true,
            unreadable: false,
            user,
            smart_approve,
        }),
        None => Ok(GoosePermissions {
            path: display,
            exists: true,
            unreadable: true,
            user: PermissionBuckets::default(),
            smart_approve: PermissionBuckets::default(),
        }),
    }
}

/// 重置：备份后删掉 `permission.yaml`，goose 会按空表重建。
///
/// 返回备份文件的路径；文件本来就不存在时返回 `None`。
///
/// **调用方必须重启 goose**：`PermissionManager` 在进程内缓存 `permission_map`，
/// 删文件不会影响已经跑起来的进程。
pub fn reset(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    let path = permission_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("取时间戳失败: {error}"))?
        .as_secs();
    let backup = path.with_file_name(format!("{PERMISSION_FILE}.bak-{stamp}"));
    fs::rename(&path, &backup).map_err(|error| {
        format!(
            "备份 {} → {} 失败: {error}",
            path.to_string_lossy(),
            backup.to_string_lossy()
        )
    })?;
    Ok(Some(backup.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// goose 真实写出的形状（`serde_yaml::to_string`，列表项与键**同缩进**）。
    const GOOSE_SHAPED: &str = "\
user:
  always_allow:
  - analyze
  - write
  ask_before: []
  never_allow:
  - shell
  - execute_javascript
smart_approve:
  always_allow: []
  ask_before:
  - recipe__final_output
  never_allow: []
";

    #[test]
    fn parses_goose_output() {
        let (user, smart) = parse_permission_yaml(GOOSE_SHAPED).expect("应能解析");
        assert_eq!(user.always_allow, vec!["analyze", "write"]);
        assert!(user.ask_before.is_empty());
        assert_eq!(user.never_allow, vec!["shell", "execute_javascript"]);
        assert!(smart.always_allow.is_empty());
        assert_eq!(smart.ask_before, vec!["recipe__final_output"]);
        assert!(smart.never_allow.is_empty());
    }

    #[test]
    fn parses_flow_style_and_quotes() {
        let text = "\
user:
  always_allow: [a, \"b c\", 'd']
  ask_before: []
  never_allow: []
";
        let (user, _) = parse_permission_yaml(text).expect("应能解析流式列表");
        assert_eq!(user.always_allow, vec!["a", "b c", "d"]);
    }

    #[test]
    fn empty_file_is_empty_not_unreadable() {
        let (user, smart) = parse_permission_yaml("").expect("空文件应解析为空表");
        assert_eq!(user.all().count(), 0);
        assert_eq!(smart.all().count(), 0);
    }

    #[test]
    fn rejects_unknown_top_level_key() {
        // 顶层出现陌生分组时不能猜：宁可让前端提示「无法解析，建议重置」
        assert!(parse_permission_yaml("other:\n  always_allow:\n  - x\n").is_none());
    }

    #[test]
    fn rejects_bucket_under_unknown_section() {
        assert!(parse_permission_yaml("user:\n  mystery: []\n").is_none());
    }

    #[test]
    fn parses_four_space_indent_too() {
        // 手工编辑过的文件常写成 4 空格；列表项缩进不参与分组判断，照样读出来
        let text = "\
user:
    always_allow:
        - write
    ask_before: []
    never_allow: []
";
        let (user, _) = parse_permission_yaml(text).expect("应能解析");
        assert_eq!(user.always_allow, vec!["write"]);
    }

    #[test]
    fn user_len_counts_all_buckets() {
        let perms = GoosePermissions {
            path: "x".into(),
            exists: true,
            unreadable: false,
            user: PermissionBuckets {
                always_allow: vec!["a".into()],
                ask_before: vec!["b".into()],
                never_allow: vec!["c".into()],
            },
            smart_approve: PermissionBuckets::default(),
        };
        assert_eq!(perms.user_len(), 3);
    }
}
