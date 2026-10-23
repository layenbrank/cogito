use duroxide::ClientError;

/// 可靠执行端口的错误。
#[derive(Debug, thiserror::Error)]
pub enum DurableError {
    /// 存储不可用：连接串错、schema 建不出来、`auto_migrate = false` 但迁移没跑过等。
    #[error("可靠执行存储不可用: {0}")]
    Store(String),

    /// 实例操作失败。`retryable` 原样转发 provider 的判定（超时与连接类错误为真）。
    #[error("实例 {instance} 的{operation}失败: {message}")]
    Client {
        instance: String,
        operation: &'static str,
        retryable: bool,
        message: String,
    },

    /// 实例输入不是合法 JSON。
    #[error("实例 {instance} 的输入无法序列化成 JSON: {source}")]
    Input {
        instance: String,
        #[source]
        source: serde_json::Error,
    },

    /// 运行时参数不合法：启动前自检拦下来的（例如租约时长与 session 空闲超时冲突）。
    #[error("可靠执行运行时参数不合法: {0}")]
    Config(String),

    /// 处理器注册表有问题：重名、用了保留名字等。启动即失败，不带病运行。
    #[error("{kind}注册失败: {message}")]
    Registration { kind: &'static str, message: String },
}

impl DurableError {
    /// 是否值得重试（只有实例操作会给出「可重试」的判定）。
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            Self::Client {
                retryable: true,
                ..
            }
        )
    }

    pub(crate) fn client(instance: &str, operation: &'static str, error: ClientError) -> Self {
        Self::Client {
            instance: instance.to_string(),
            operation,
            retryable: error.is_retryable(),
            message: error.to_string(),
        }
    }
}
