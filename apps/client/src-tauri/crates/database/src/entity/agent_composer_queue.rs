#![allow(non_snake_case)]

//! composer 队列持久化：**一行一条排队消息**，按 `sessionID` 归属会话。
//!
//! 为什么独立成表而不是给 `agent_session` 加列：
//! - 队列是行级增删改（上移/下移/取回编辑），塞进会话整行的 JSON 里每次都要
//!   `UPDATE` 整行，一条写坏整队丢失；
//! - 独立表天然有序（`lane` + `sort`），且能随会话 `ON DELETE CASCADE` 清理；
//! - 零 `ALTER`、不改任何在用表，老库靠 `ensure_composer_queue()` 兜底建表。
//!
//! 不变量：
//! - `text` 是 chip 已 `@` 序列化的线格式文本（与 `serializeDocument` 一致）；
//! - `sort` 是**数组顺序**的唯一真相：`toReplace` 按入参下标重排，不接受调用方乱序；
//! - `lane` 只有 `main`（排队）与 `steer`（立即发）。
use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

fn default_lane() -> String {
    "main".to_string()
}

fn default_attachments() -> String {
    "[]".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "agent_composer_queue")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    #[sea_orm(column_name = "sessionID")]
    pub sessionID: String,
    /// main | steer
    pub lane: String,
    /// 队列内顺序（升序）
    pub sort: i64,
    /// 线格式文本（chip 已 @ 序列化）
    pub text: String,
    /// JSON 数组字符串
    pub attachments: String,
    #[sea_orm(column_name = "createdAt")]
    pub createdAt: i64,
    #[sea_orm(column_name = "updatedAt")]
    pub updatedAt: i64,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Read {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub sessionID: Option<String>,
    #[serde(default)]
    pub lane: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ReadP {
    One(Read),
    Many(Vec<Read>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Write {
    #[serde(default)]
    pub id: Option<String>,
    pub sessionID: String,
    #[serde(default = "default_lane")]
    pub lane: String,
    /// 单条写入时可指定；`toReplace` 会以下标覆盖，保证顺序就是数组顺序。
    #[serde(default)]
    pub sort: Option<i64>,
    pub text: String,
    #[serde(default = "default_attachments")]
    pub attachments: String,
    #[serde(default)]
    pub createdAt: Option<i64>,
    #[serde(default)]
    pub updatedAt: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WriteP {
    One(Write),
    Many(Vec<Write>),
}

/// 部分更新：只列允许改的列（改文本 = 就地编辑，改顺序 = `sort`）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    #[serde(default)]
    pub lane: Option<String>,
    #[serde(default)]
    pub sort: Option<i64>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub attachments: Option<String>,
    #[serde(default)]
    pub updatedAt: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    pub key: String,
    pub change: Change,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum UpdateP {
    One(Update),
    Many(Vec<Update>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RemoveP {
    One(String),
    Many(Vec<String>),
}

/// 整队替换：一个事务里「删旧 + 插新」，避免半截写入。
///
/// `lane` 为 `None` 时按会话整体替换（所有 lane 一起清空），前端默认走这个形态；
/// 只同步某一条 lane 时传 `lane`。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Replace {
    pub sessionID: String,
    #[serde(default)]
    pub lane: Option<String>,
    #[serde(default)]
    pub items: Vec<Write>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ReplaceP {
    One(Replace),
    Many(Vec<Replace>),
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 前端只传 sessionID：其余字段必须能缺省（缺 serde(default) 会报 missing field）
    #[test]
    fn read_params_only_need_session_id() {
        let parsed: ReadP =
            serde_json::from_str(r#"{"sessionID":"s1"}"#).expect("read params");
        match parsed {
            ReadP::One(one) => {
                assert_eq!(one.sessionID.as_deref(), Some("s1"));
                assert!(one.id.is_none());
                assert!(one.lane.is_none());
            }
            ReadP::Many(_) => panic!("应解析为 One"),
        }
    }

    /// toReplace 的最小负载：items 里只给 text，id / sort / 时间戳由服务端补
    #[test]
    fn replace_params_accept_minimal_items() {
        let parsed: ReplaceP = serde_json::from_str(
            r#"{"sessionID":"s1","items":[{"sessionID":"s1","text":"@a.ts"}]}"#,
        )
        .expect("replace params");
        match parsed {
            ReplaceP::One(one) => {
                assert_eq!(one.sessionID, "s1");
                assert!(one.lane.is_none());
                assert_eq!(one.items.len(), 1);
                let item = &one.items[0];
                assert_eq!(item.text, "@a.ts");
                assert_eq!(item.lane, "main");
                assert_eq!(item.attachments, "[]");
                assert!(item.id.is_none());
                assert!(item.sort.is_none());
                assert!(item.createdAt.is_none());
                assert!(item.updatedAt.is_none());
            }
            ReplaceP::Many(_) => panic!("应解析为 One"),
        }
    }
}
