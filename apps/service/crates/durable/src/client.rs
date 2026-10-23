use std::time::Duration;

use duroxide::ProviderRef;
use duroxide::runtime::OrchestrationStatus;
use serde::Serialize;

use crate::DurableError;

/// 实例状态（对外词汇：不暴露 provider 的内部结构）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InstanceStatus {
    /// 从来没有起过这个实例（或已被删除）。
    NotFound,
    /// 正在跑（可能卡在某个活动的重试上）。`custom_status` 是编排自己写的进度串。
    Running { custom_status: Option<String> },
    /// 已跑完，`output` 是编排的返回值（通常是 JSON）。
    Completed { output: String },
    /// 已判死：`category` 为 infrastructure / configuration / application / poison 之一，
    /// 分别对应「环境坏了」「编排写错了」「业务逻辑失败重试耗尽」「活动反复毒化实例」。
    Failed { category: String, message: String },
}

impl InstanceStatus {
    /// 稳定的短标签，用于日志与指标。
    pub fn label(&self) -> &'static str {
        match self {
            Self::NotFound => "not_found",
            Self::Running { .. } => "running",
            Self::Completed { .. } => "completed",
            Self::Failed { .. } => "failed",
        }
    }

    /// 是否已经不会再变化（完成或失败）；`NotFound` 不算终态——实例可能还没起。
    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Completed { .. } | Self::Failed { .. })
    }

    /// 完成时的输出。
    pub fn output(&self) -> Option<&str> {
        match self {
            Self::Completed { output } => Some(output),
            _ => None,
        }
    }
}

impl From<OrchestrationStatus> for InstanceStatus {
    fn from(status: OrchestrationStatus) -> Self {
        match status {
            OrchestrationStatus::NotFound => Self::NotFound,
            OrchestrationStatus::Running { custom_status, .. } => Self::Running { custom_status },
            OrchestrationStatus::Completed { output, .. } => Self::Completed { output },
            OrchestrationStatus::Failed { details, .. } => Self::Failed {
                category: details.category().to_string(),
                message: details.display_message(),
            },
        }
    }
}

/// 起实例、查状态、等结果、取消：不需要跑运行时，任何进程都能用。
#[derive(Clone)]
pub struct Client {
    inner: duroxide::Client,
}

impl Client {
    pub(crate) fn new(provider: ProviderRef) -> Self {
        Self {
            inner: duroxide::Client::new(provider),
        }
    }

    /// 起一个实例，输入按 JSON 序列化。
    ///
    /// `instance` 是全局唯一 id，也是活动重试时的幂等键：一个 id 对应一个实例，
    /// 重复用同一个 id 启动会被运行时拒绝（不会起第二个）。续跑不是靠重新启动，
    /// 而是运行时自己按历史恢复（见 [`crate::Runtime`]）。
    pub async fn start<In: Serialize>(
        &self,
        instance: &str,
        orchestration: &str,
        input: &In,
    ) -> Result<(), DurableError> {
        let payload = serde_json::to_string(input).map_err(|source| DurableError::Input {
            instance: instance.to_string(),
            source,
        })?;
        self.start_json(instance, orchestration, &payload).await
    }

    /// 起实例，输入是已经拼好的 JSON 文本。
    ///
    /// 与 [`Self::start`] 的区别只在「谁来序列化」：调用方已有 JSON 时不必再
    /// 反序列化一轮（也就不会把 `"abc"` 这种字符串当成 JSON 字符串字面量送进去）。
    pub async fn start_json(
        &self,
        instance: &str,
        orchestration: &str,
        input_json: &str,
    ) -> Result<(), DurableError> {
        self.inner
            .start_orchestration(instance, orchestration, input_json)
            .await
            .map_err(|e| DurableError::client(instance, "启动", e))
    }

    /// 读当前状态（不发等待、不阻塞）。
    pub async fn status(&self, instance: &str) -> Result<InstanceStatus, DurableError> {
        self.inner
            .get_orchestration_status(instance)
            .await
            .map(InstanceStatus::from)
            .map_err(|e| DurableError::client(instance, "查询状态", e))
    }

    /// 等到终态或等到超时。
    ///
    /// 超时**不是错误**：返回当时的 [`InstanceStatus::Running`]，由调用方决定
    /// 是继续等、还是把「还能等多久」交给上层。
    pub async fn wait(
        &self,
        instance: &str,
        timeout: Duration,
    ) -> Result<InstanceStatus, DurableError> {
        match self.inner.wait_for_orchestration(instance, timeout).await {
            Ok(status) => Ok(InstanceStatus::from(status)),
            Err(duroxide::ClientError::Timeout) => self.status(instance).await,
            Err(e) => Err(DurableError::client(instance, "等待", e)),
        }
    }

    /// 投递一个外部事件，数据按 JSON 序列化。编排里的 `ctx.schedule_wait(name)` 会收到它。
    ///
    /// 事件是**一次性**的（按名字位置匹配）：编排订阅多次就投多次，没人订阅的投递会留在
    /// 该实例的事件队列里。跨进程通知（例如 api 告诉编排「文件已上传完」）走这条路径。
    pub async fn raise_event<D: Serialize>(
        &self,
        instance: &str,
        event: &str,
        data: &D,
    ) -> Result<(), DurableError> {
        let payload = serde_json::to_string(data).map_err(|source| DurableError::Input {
            instance: instance.to_string(),
            source,
        })?;
        self.raise_event_json(instance, event, &payload).await
    }

    /// 投递外部事件，数据是已经拼好的 JSON 文本（理由同 [`Self::start_json`]）。
    pub async fn raise_event_json(
        &self,
        instance: &str,
        event: &str,
        data_json: &str,
    ) -> Result<(), DurableError> {
        self.inner
            .raise_event(instance, event, data_json)
            .await
            .map_err(|e| DurableError::client(instance, "投递事件", e))
    }

    /// 把一条消息投进实例的**邮箱**，编排里的 `ctx.dequeue_event(name)` 按先到先得取走它。
    ///
    /// 与 [`Self::raise_event`] 的差别是**匹配语义**，不是风格：
    /// 事件按位置配对（订阅必须已经绑上，早到的投递没人接），邮箱是缓冲的（早到就存着、
    /// 谁先订阅给谁、跨 `continue_as_new` 存活）。所以「决定什么时候来无法预知、来了必须被
    /// 接住」的通知（人工审批）走这条路径。两者是两条独立通道，不能互换。
    pub async fn enqueue_event<D: Serialize>(
        &self,
        instance: &str,
        queue: &str,
        data: &D,
    ) -> Result<(), DurableError> {
        let payload = serde_json::to_string(data).map_err(|source| DurableError::Input {
            instance: instance.to_string(),
            source,
        })?;
        self.enqueue_event_json(instance, queue, &payload).await
    }

    /// 投进邮箱，数据是已经拼好的 JSON 文本（理由同 [`Self::start_json`]）。
    pub async fn enqueue_event_json(
        &self,
        instance: &str,
        queue: &str,
        data_json: &str,
    ) -> Result<(), DurableError> {
        self.inner
            .enqueue_event(instance, queue, data_json)
            .await
            .map_err(|e| DurableError::client(instance, "投递邮箱消息", e))
    }

    /// 请求取消：正在跑的活动收到取消信号（能否立刻停下由活动自己决定），编排随后判为失败。
    pub async fn cancel(&self, instance: &str, reason: &str) -> Result<(), DurableError> {
        self.inner
            .cancel_instance(instance, reason)
            .await
            .map_err(|e| DurableError::client(instance, "取消", e))
    }
}

impl std::fmt::Debug for Client {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Client")
    }
}
