//! 会话同步的领域错误 → [`Exception`]
//!
//! 领域服务返回本枚举而不是 [`Exception`]：状态码与业务码是接口层的知识，写进服务里会让
//! 「同一段校验换一个入口（后台补偿、离线重放）」都得改业务逻辑。映射只在这一处做。

use uuid::Uuid;

use crate::filters::exception::Exception;
use crate::utils::code::{business, external};

/// 会话同步域的领域错误。
#[derive(Debug, thiserror::Error)]
pub enum ChatError {
    /// 批次不合法：标识为空、行数或长度超限、id 不是 uuid、批内 id 重复。
    /// 文案直接给调用方看（这几种都是「请求写错了」，说清楚比分类更有用）。
    #[error("{0}")]
    BatchInvalid(String),
    /// 消息指向了本租户不存在的会话：批次内的次序不对（会话必须排在消息之前）。
    #[error("{0}")]
    SessionMissing(Uuid),
    /// 拉取游标不合法（`since` 为负、`limit` 越界）。
    #[error("{0}")]
    CursorInvalid(String),
    /// 数据库故障。
    #[error("数据库错误：{0}")]
    Database(String),
}

impl From<chat::Error> for ChatError {
    fn from(err: chat::Error) -> Self {
        match err {
            chat::Error::Db(source) => Self::Database(source.to_string()),
            chat::Error::SessionMissing(id) => Self::SessionMissing(id),
        }
    }
}

impl From<ChatError> for Exception {
    fn from(err: ChatError) -> Self {
        match err {
            ChatError::BatchInvalid(msg) => Exception::custom(business::chat::BATCH_INVALID, msg),
            ChatError::SessionMissing(id) => Exception::custom(
                business::chat::SESSION_MISSING,
                format!("消息引用的会话不存在：{id}"),
            ),
            ChatError::CursorInvalid(msg) => Exception::custom(business::chat::CURSOR_INVALID, msg),
            ChatError::Database(msg) => {
                tracing::error!(error = %msg, "会话同步数据库错误");
                Exception::custom(external::DATABASE_ERROR, "数据库错误")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_variant_keeps_its_own_code() {
        let cases = [
            (
                ChatError::BatchInvalid("批次标识为空".to_owned()),
                business::chat::BATCH_INVALID,
            ),
            (
                ChatError::SessionMissing(Uuid::nil()),
                business::chat::SESSION_MISSING,
            ),
            (
                ChatError::CursorInvalid("limit 超出上限".to_owned()),
                business::chat::CURSOR_INVALID,
            ),
            (
                ChatError::Database("boom".to_owned()),
                external::DATABASE_ERROR,
            ),
        ];

        for (err, expected) in cases {
            assert_eq!(Exception::from(err).code, expected);
        }
    }

    #[test]
    fn missing_session_message_names_the_row() {
        let id = Uuid::parse_str("0b0e1e1e-1c1c-4c4c-8c8c-1c1c1c1c1c1c").unwrap();
        let exception = Exception::from(ChatError::SessionMissing(id));
        assert!(exception.msg.contains(&id.to_string()));
    }
}
