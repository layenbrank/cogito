//! compute（Python 计算车间）内部调用客户端。
//!
//! 契约在 `spec/internal.yaml`：路径模板与它一字不差（`pnpm arch` 的 R11 会比对），
//! 想加路径先去改契约。这个客户端是 cogito 唯一允许出站调 `/internal/**` 的地方。
//!
//! 调用约定（与契约一致）：
//! - `X-Internal-Token`：共享令牌，来自 `compute.token`；
//! - `Idempotency-Key`：由编排实例 id + 步骤派生，重试不会产生重复副作用；
//! - `traceparent`：有活跃 OTel span 时用真实上下文，否则由上游链路 + 步骤**确定性**派生，
//!   重放时下游看到同一条链路。
//!
//! 错误分类（`is_retryable`）决定编排是重试还是直接判失败，分类必须在这里定：
//! 429 与 5xx/超时/传输失败可重试，其它 4xx 是「请求本身有问题」，重试只会重复失败。

use anyhow::{Context, Result};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;

use crate::configures::configure::Configure;
use crate::middlewares::trace::TraceContext;
use crate::utils::telemetry;

/// 契约路径模板（占位符具名，与 `spec/internal.yaml` 完全一致）
pub const HEALTH_PATH: &str = "/internal/v1/health";
/// 抽取文本并分块（返回块数与块集 id，不回传正文）
pub const CHUNK_OBJECT_PATH: &str = "/internal/v1/assets/{assetID}/chunks";
/// 为一组块算嵌入
pub const EMBED_RANGE_PATH: &str = "/internal/v1/assets/{assetID}/embeddings";
/// 把块集落进检索索引
pub const UPSERT_INDEX_PATH: &str = "/internal/v1/assets/{assetID}/index";
/// 按查询文本检索本租户已索引的块（只读）
pub const RAG_SEARCH_PATH: &str = "/internal/v1/rag/search";
/// 服务端 agent 的一步（无状态：一次推理 + 至多一轮工具）
pub const AGENT_STEP_PATH: &str = "/internal/v1/agents/steps";
/// 执行一次**已获人工批准**的工具调用（审批通道的执行半边）
pub const AGENT_TOOL_EXECUTION_PATH: &str = "/internal/v1/agents/tool-executions";
/// 同步执行一次**不需要审批**的工具调用（MCP `tools/call` 的直通通道）
pub const AGENT_TOOL_INVOCATION_PATH: &str = "/internal/v1/agents/tool-invocations";
/// 记下一次任务的最终结论（长期记忆）
pub const AGENT_REMEMBER_PATH: &str = "/internal/v1/agents/memories";

/// 内部契约版本（`schemaVersion`）。契约不兼容变更时才 +1。
pub const INTERNAL_SCHEMA_VERSION: i32 = 1;

const TOKEN_HEADER: &str = "X-Internal-Token";
const IDEMPOTENCY_HEADER: &str = "Idempotency-Key";
const TRACEPARENT_HEADER: &str = "traceparent";

#[derive(Debug, thiserror::Error)]
pub enum ComputeError {
    /// 4xx（429 除外）：载荷/令牌有问题，重试没有意义。
    #[error("compute 拒绝请求（{status}）: {body}")]
    Rejected { status: u16, body: String },
    /// 429：限流，退避后可重试。
    #[error("compute 限流")]
    RateLimited,
    /// 5xx / 其它非 2xx：下游暂不可用，可重试。
    #[error("compute 不可用（{status}）: {body}")]
    Unavailable { status: u16, body: String },
    #[error("compute 调用超时")]
    Timeout,
    #[error("compute 传输失败: {0}")]
    Transport(String),
    #[error("compute 响应无法解析: {0}")]
    Decode(String),
}

impl ComputeError {
    /// 是否值得重试。编排据此决定「退避后重来」还是「立刻判失败」。
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            Self::RateLimited | Self::Unavailable { .. } | Self::Timeout | Self::Transport(_)
        )
    }
}

/// 一次内部调用的元信息：幂等键与上游链路。
#[derive(Debug, Clone)]
pub struct CallMeta {
    /// 幂等键，惯例 `<编排实例 id>:<步骤>`。
    pub idempotency_key: String,
    /// 上游 `traceparent`（编排输入带进来的那条）；缺省时按幂等键派生根链路。
    pub traceparent: Option<String>,
}

impl CallMeta {
    pub fn new(idempotency_key: impl Into<String>, traceparent: Option<String>) -> Self {
        Self {
            idempotency_key: idempotency_key.into(),
            traceparent,
        }
    }
}

#[derive(Clone)]
pub struct ComputeClient {
    http: Client,
    base_url: String,
    token: String,
}

impl ComputeClient {
    pub fn new(config: &Configure) -> Result<Self> {
        Self::from_parts(
            &config.compute.base_url,
            &config.compute.token,
            config.compute.timeout_ms,
            config.compute.use_system_proxy,
        )
    }

    pub fn from_parts(
        base_url: &str,
        token: &str,
        timeout_ms: u64,
        use_system_proxy: bool,
    ) -> Result<Self> {
        if base_url.trim().is_empty() {
            anyhow::bail!("compute.base_url 不能为空");
        }

        let mut builder = Client::builder().timeout(Duration::from_millis(timeout_ms.max(1)));
        if !use_system_proxy {
            // 内部端点按内网直连处理：禁用代理，否则请求会被本机系统代理
            // （如 127.0.0.1:7892）拦截并回 502。仅作用于本客户端。
            builder = builder.no_proxy();
        }

        Ok(Self {
            http: builder
                .build()
                .context("failed to build compute http client")?,
            base_url: trim_trailing_slash(base_url),
            token: token.to_string(),
        })
    }

    /// 健康与能力自述（cogito 的 readiness 用，P7 接）。
    pub async fn health(&self) -> Result<HealthResponse, ComputeError> {
        let response = self
            .http
            .get(format!("{}{}", self.base_url, HEALTH_PATH))
            .send()
            .await
            .map_err(map_reqwest_error)?;

        read_json(response).await
    }

    /// 抽取文本并分块（长任务的第一步）。
    pub async fn chunk_object(
        &self,
        asset_id: &str,
        request: &ChunkRequest,
        meta: &CallMeta,
    ) -> Result<ChunkResponse, ComputeError> {
        self.post_json(CHUNK_OBJECT_PATH, "{assetID}", asset_id, request, meta)
            .await
    }

    /// 为一组块算嵌入（长任务的中间步，可分批）。
    pub async fn embed_range(
        &self,
        asset_id: &str,
        request: &EmbedRequest,
        meta: &CallMeta,
    ) -> Result<EmbedResponse, ComputeError> {
        self.post_json(EMBED_RANGE_PATH, "{assetID}", asset_id, request, meta)
            .await
    }

    /// 把块集落进检索索引（长任务的最后一步）。
    pub async fn upsert_index(
        &self,
        asset_id: &str,
        request: &IndexRequest,
        meta: &CallMeta,
    ) -> Result<IndexResponse, ComputeError> {
        let url = self.url(UPSERT_INDEX_PATH, "{assetID}", asset_id);
        let response = self
            .headers(self.http.put(url), meta)
            .json(request)
            .send()
            .await
            .map_err(map_reqwest_error)?;

        read_json(response).await
    }

    /// 按查询文本检索（只读）：结果直接给客户端展示，不在服务端做融合。
    ///
    /// 幂等键只是头的占位：compute 的检索端点**不进幂等账本**，重发同一个查询不会写账。
    /// 这里按「租户 + 模型 + 查询 + 资产集」派一个确定性的键，重试时下游看到的仍是同一次请求。
    pub async fn rag_search(
        &self,
        request: &SearchRequest,
        meta: &CallMeta,
    ) -> Result<SearchResponse, ComputeError> {
        let url = format!("{}{}", self.base_url, RAG_SEARCH_PATH);
        self.post_json_url(&url, request, meta).await
    }

    /// 走一步 agent：一次推理 + 至多一轮工具。    ///
    /// 路径没有占位符（租户与目标都在请求体里），所以不走 `post_json` 的占位符填充。
    pub async fn agent_step(
        &self,
        request: &AgentStepRequest,
        meta: &CallMeta,
    ) -> Result<AgentStepResponse, ComputeError> {
        let url = format!("{}{}", self.base_url, AGENT_STEP_PATH);
        self.post_json_url(&url, request, meta).await
    }

    /// 把一个已收尾任务的结论写进长期记忆。
    ///
    /// 幂等由 **compute 侧的确定性 memoryID** 保证（同一任务的摘要永远同一个 id），
    /// 所以这里即便换了幂等键重投也只会写一行——调用方可以放心地 best-effort 重试。
    pub async fn agent_remember(
        &self,
        request: &AgentMemoryRequest,
        meta: &CallMeta,
    ) -> Result<AgentMemoryResponse, ComputeError> {
        let url = format!("{}{}", self.base_url, AGENT_REMEMBER_PATH);
        self.post_json_url(&url, request, meta).await
    }

    /// 执行一次**已经过人工批准**的工具调用（审批通道的执行半边）。
    ///
    /// `/agents/steps` 遇到需要审批的工具只留占位结果，真正干活的是这里：所以「执行」永远
    /// 只有一个入口，被拒或超时根本不会走到这一段（那两种情况由编排自己合成结果）。
    pub async fn agent_tool_execution(
        &self,
        request: &AgentToolExecutionRequest,
        meta: &CallMeta,
    ) -> Result<AgentToolExecutionResponse, ComputeError> {
        let url = format!("{}{}", self.base_url, AGENT_TOOL_EXECUTION_PATH);
        self.post_json_url(&url, request, meta).await
    }

    /// 同步执行一次**不需要审批**的工具调用（MCP `tools/call` 的直通通道）。
    ///
    /// 与 `agent_tool_execution` 是对称的两条路：那条只收需要审批的写工具，这条只收
    /// 不需要审批的只读工具。写工具从这里进去会被下游 400（`ComputeError::Rejected`）。
    pub async fn agent_tool_invocation(
        &self,
        request: &AgentToolInvocationRequest,
        meta: &CallMeta,
    ) -> Result<AgentToolInvocationResponse, ComputeError> {
        let url = format!("{}{}", self.base_url, AGENT_TOOL_INVOCATION_PATH);
        self.post_json_url(&url, request, meta).await
    }

    async fn post_json<Req, Res>(
        &self,
        template: &str,
        placeholder: &str,
        asset_id: &str,
        request: &Req,
        meta: &CallMeta,
    ) -> Result<Res, ComputeError>
    where
        Req: Serialize + ?Sized,
        Res: for<'de> Deserialize<'de>,
    {
        let url = self.url(template, placeholder, asset_id);
        self.post_json_url(&url, request, meta).await
    }

    async fn post_json_url<Req, Res>(
        &self,
        url: &str,
        request: &Req,
        meta: &CallMeta,
    ) -> Result<Res, ComputeError>
    where
        Req: Serialize + ?Sized,
        Res: for<'de> Deserialize<'de>,
    {
        let response = self
            .headers(self.http.post(url), meta)
            .json(request)
            .send()
            .await
            .map_err(map_reqwest_error)?;

        read_json(response).await
    }

    fn url(&self, template: &str, placeholder: &str, asset_id: &str) -> String {
        format!(
            "{}{}",
            self.base_url,
            fill_path(template, placeholder, asset_id)
        )
    }

    /// 三个头是所有内部调用共有的：令牌、幂等键、链路。
    fn headers(
        &self,
        request: reqwest::RequestBuilder,
        meta: &CallMeta,
    ) -> reqwest::RequestBuilder {
        request
            .header(TOKEN_HEADER, &self.token)
            .header(IDEMPOTENCY_HEADER, &meta.idempotency_key)
            .header(
                TRACEPARENT_HEADER,
                // 有活跃 span（OTel 开启）时用真实上下文，让下游挂到当前 span 上；
                // 否则退回确定性派生，重放同一个步骤时下游仍看到同一条链路
                telemetry::current_traceparent().unwrap_or_else(|| {
                    step_traceparent(meta.traceparent.as_deref(), &meta.idempotency_key)
                }),
            )
    }
}

/// 把契约里的具名占位符换成实际值。
fn fill_path(template: &str, placeholder: &str, value: &str) -> String {
    template.replace(placeholder, value)
}

/// 本步的 `traceparent`：沿用上游 trace-id（缺省则按幂等键派生一条根链路），
/// span-id 由幂等键确定性派生 —— 编排重放同一个步骤时下游看到同一对 id，
/// 日志不会因为重跑而分裂成两条链路。
fn step_traceparent(parent: Option<&str>, idempotency_key: &str) -> String {
    let trace_id = parent
        .and_then(TraceContext::parse)
        .map(|ctx| ctx.trace_id)
        .unwrap_or_else(|| hex(&format!("trace:{idempotency_key}"), 32));

    format!(
        "00-{trace_id}-{}-01",
        hex(&format!("span:{idempotency_key}"), 16)
    )
}

/// sha256 前 `len` 个十六进制字符。
fn hex(seed: &str, len: usize) -> String {
    let digest = Sha256::digest(seed.as_bytes());
    let mut out = String::with_capacity(64);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out.truncate(len);
    out
}

async fn read_json<Res>(response: reqwest::Response) -> Result<Res, ComputeError>
where
    Res: for<'de> Deserialize<'de>,
{
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| ComputeError::Transport(e.to_string()))?;

    if !status.is_success() {
        return Err(classify_status(status, &body));
    }

    serde_json::from_str(&body)
        .map_err(|e| ComputeError::Decode(format!("{e}; body={}", truncate(&body, 256))))
}

fn classify_status(status: StatusCode, body: &str) -> ComputeError {
    if status == StatusCode::TOO_MANY_REQUESTS {
        return ComputeError::RateLimited;
    }
    let body = truncate(body, 256);
    if status.is_server_error() {
        ComputeError::Unavailable {
            status: status.as_u16(),
            body,
        }
    } else if status.is_client_error() {
        ComputeError::Rejected {
            status: status.as_u16(),
            body,
        }
    } else {
        // 3xx/1xx 不该出现在这条路径上（重定向已由 http 客户端跟随），
        // 归到「暂时不可用」比归到「请求有错」更安全。
        ComputeError::Unavailable {
            status: status.as_u16(),
            body,
        }
    }
}

fn map_reqwest_error(err: reqwest::Error) -> ComputeError {
    if err.is_timeout() {
        ComputeError::Timeout
    } else {
        ComputeError::Transport(err.to_string())
    }
}

fn trim_trailing_slash(url: &str) -> String {
    url.trim_end_matches('/').to_string()
}

fn truncate(value: &str, max: usize) -> String {
    if value.len() <= max {
        return value.to_string();
    }
    // 错误体是下游返回的任意文本：按字符边界裁，别切坏多字节字符。
    let end = (0..=max)
        .rev()
        .find(|index| value.is_char_boundary(*index))
        .unwrap_or(0);

    format!("{}...", &value[..end])
}

/// 分块请求：只说「租户 + 资产 + 类型」，**不带对象存储键**。
///
/// 正文由 compute 自己回打 cogito 的 `GET /api/v1/service/assets/{assetID}/content`
/// （先换 `scope=asset-read` 的服务身份令牌）取，CAS 布局不外泄给叶子服务。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkRequest {
    pub schema_version: i32,
    #[serde(rename = "tenantID")]
    pub tenant_id: String,
    pub mime: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunk_size: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunk_overlap: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkResponse {
    #[serde(rename = "chunkSetID")]
    pub chunk_set_id: String,
    pub chunk_count: i32,
    #[serde(default)]
    pub text_sha: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbedRequest {
    pub schema_version: i32,
    #[serde(rename = "tenantID")]
    pub tenant_id: String,
    #[serde(rename = "chunkSetID")]
    pub chunk_set_id: String,
    pub model: String,
    pub from: i32,
    pub to: i32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbedResponse {
    pub from: i32,
    pub to: i32,
    pub embedded: i32,
    pub dimensions: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexRequest {
    pub schema_version: i32,
    #[serde(rename = "tenantID")]
    pub tenant_id: String,
    #[serde(rename = "chunkSetID")]
    pub chunk_set_id: String,
    pub chunk_count: i32,
    pub model: String,
    pub dimensions: i32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexResponse {
    pub indexed: i32,
    pub collection: String,
}

/// 检索请求（只读）。`assetIDs` 缺省 = 本租户全部；空数组 = 没有可查的资产。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub schema_version: i32,
    #[serde(rename = "tenantID")]
    pub tenant_id: String,
    pub model: String,
    pub query: String,
    #[serde(rename = "topK", skip_serializing_if = "Option::is_none")]
    pub top_k: Option<i32>,
    #[serde(rename = "assetIDs", skip_serializing_if = "Option::is_none")]
    pub asset_ids: Option<Vec<String>>,
}

/// 一块命中。`score` 是余弦相似度（越大越相近）。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    #[serde(rename = "assetID")]
    pub asset_id: String,
    pub ordinal: i32,
    pub score: f64,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub hits: Vec<SearchHit>,
}

/// 单步 agent 的请求：目标 + **到目前为止的历史** + 本步可用工具 + 剩余轮次。
///
/// `history` 由 cogito 攒（上一轮的 assistant 消息 + 每条工具结果翻成 `role=tool` 的消息）：
/// compute 侧是无状态的，它不知道任务走到哪一步了。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStepRequest {
    pub schema_version: i32,
    #[serde(rename = "tenantID")]
    pub tenant_id: String,
    pub objective: String,
    pub model: String,
    /// 检索用的嵌入模型：必须与 `rag.index` 落库时用的模型一致，这是 cogito 的责任。
    #[serde(rename = "embedModel")]
    pub embed_model: String,
    /// 空数组与缺失同义（第一步）。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub history: Vec<AgentMessage>,
    /// 空数组 = 不给工具（显式发出去：这是「要一条结论」的意图，不是一个可省的默认值）。
    #[serde(rename = "allowedTools", default)]
    pub allowed_tools: Vec<String>,
    /// 还剩几步（含本步）；`<= 1` 时下游不再提供工具。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining_steps: Option<i32>,
}

/// 一条对话消息（契约形状：工具调用**扁平**在消息里，参数是 JSON 字符串）。
///
/// 刻意不做成枚举：cogito 只构造 `assistant`（回灌上一轮）与 `tool`（回灌工具结果）两种，
/// 从不对角色做分支判断，多一层类型只是多一个要维护的映射。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    /// `system` / `user` / `assistant` / `tool`。cogito 只发前两者之外的两种。
    pub role: String,
    /// 要求了工具的 assistant 消息可以没有正文。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    /// 只有 assistant 会有。`None`（缺席）与 `Some(vec![])` 是两个意思：前者「与工具无关」，
    /// 后者「这一步没有再要工具」——合并它们会让下游误解出「重复调用同一个工具」。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<AgentToolCall>>,
    /// 只有 `role=tool` 会有：指回它所回应的那次调用。
    #[serde(
        rename = "toolCallID",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub tool_call_id: Option<String>,
}

impl AgentMessage {
    /// 回灌上一轮的助手消息（正文与工具调用原样带过去）。
    #[must_use]
    pub fn assistant(message: &AgentStepResponse) -> Self {
        Self {
            role: "assistant".to_owned(),
            content: message.message.content.clone(),
            tool_calls: message.message.tool_calls.clone(),
            tool_call_id: None,
        }
    }

    /// 回灌一条工具结果（`error` 不进历史：它是给日志与审计看的机器码，不是给模型看的白话）。
    #[must_use]
    pub fn tool(result: &AgentToolResult) -> Self {
        Self {
            role: "tool".to_owned(),
            content: Some(result.content.clone()),
            tool_calls: None,
            tool_call_id: Some(result.tool_call_id.clone()),
        }
    }
}

/// 模型要求调用的一次工具。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolCall {
    /// 模型给的调用 id（回灌结果时按它对齐）。
    pub id: String,
    pub name: String,
    /// 参数对象的 **JSON 字符串**：保持线格式，cogito 不必反序列化再序列化一遍。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arguments: Option<String>,
    /// 上游字段 `type`（固定 `function`），照抄不改写。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_type: Option<String>,
}

/// 单步 agent 的产出。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStepResponse {
    pub schema_version: i32,
    /// 当且仅当 `message.tool_calls` 为空时为 true。
    pub finished: bool,
    pub message: AgentMessage,
    /// 与 `message.tool_calls` 同序一一对应。
    #[serde(rename = "toolResults")]
    pub tool_results: Vec<AgentToolResult>,
    pub usage: AgentUsage,
}

/// 一次工具调用的结果。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolResult {
    #[serde(rename = "toolCallID")]
    pub tool_call_id: String,
    pub name: String,
    /// false 也是**正常结果**（模型会读到 `content` 里的原因并自己纠正）。
    pub ok: bool,
    /// 交给模型读的文本（失败时是失败原因），已由下游按配置截断。
    pub content: String,
    /// 失败时的稳定机器码：只进日志与审计，**不喂模型**。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// 这次调用**没有执行**、正在等人工审批（占位结果）。
    ///
    /// 缺省或 `false` 表示「这一段语义下游不认识」，按普通结果处理；只有下游主动说
    /// `true` 才走审批通道——审批是 cogito 的编排能力，不是下游开关。
    #[serde(
        rename = "awaitingApproval",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub awaiting_approval: Option<bool>,
}

/// 一次**已获人工批准**的工具调用（审批通道的执行半边，见 `spec/internal.yaml`）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolExecutionRequest {
    pub schema_version: i32,
    #[serde(rename = "tenantID")]
    pub tenant_id: String,
    #[serde(rename = "taskID")]
    pub task_id: String,
    /// cogito 的审批标识（`<taskID>:<步骤>:<第几次调用>`），只用于幂等键与日志。
    #[serde(rename = "approvalID")]
    pub approval_id: String,
    /// 与 `/agents/steps` 同义：需要写长期记忆的工具用它算向量。
    #[serde(rename = "embedModel")]
    pub embed_model: String,
    /// 本步的工具白名单（下游还会再核一遍名字在不在里面）。
    #[serde(rename = "allowedTools", default)]
    pub allowed_tools: Vec<String>,
    pub tool_call: AgentToolCall,
}

/// 执行结果：就一条工具结果（成功与「工具自己失败」都是 200）。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolExecutionResponse {
    pub schema_version: i32,
    #[serde(rename = "toolResult")]
    pub tool_result: AgentToolResult,
}

/// 直通通道请求：同步执行一次不需要审批的工具（MCP `tools/call` 的落地，见 `spec/internal.yaml`）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolInvocationRequest {
    pub schema_version: i32,
    #[serde(rename = "tenantID")]
    pub tenant_id: String,
    /// 检索/召回的向量边界（与 `/agents/steps` 同义）。
    #[serde(rename = "embedModel")]
    pub embed_model: String,
    /// 本步的工具白名单（下游还会再核一遍名字在不在里面）。
    #[serde(rename = "allowedTools", default)]
    pub allowed_tools: Vec<String>,
    pub tool_call: AgentToolCall,
}

/// 直通通道结果：就一条工具结果（成功与「工具自己失败」都是 200）。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolInvocationResponse {
    pub schema_version: i32,
    #[serde(rename = "toolResult")]
    pub tool_result: AgentToolResult,
}

/// 上游给的 token 用量。用 `i64` 而不是 `i32`：上游的计数没有上界承诺。
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsage {
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
}

impl AgentUsage {
    /// 累加一轮用量（编排跨多步统计总量）。
    pub fn add(&mut self, other: &Self) {
        self.prompt_tokens += other.prompt_tokens;
        self.completion_tokens += other.completion_tokens;
        self.total_tokens += other.total_tokens;
    }
}

/// 把一次任务的结论写进长期记忆（收尾活动用）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemoryRequest {
    pub schema_version: i32,
    #[serde(rename = "tenantID")]
    pub tenant_id: String,
    #[serde(rename = "taskID")]
    pub task_id: String,
    pub objective: String,
    pub answer: String,
    pub steps: i32,
    #[serde(rename = "toolCalls")]
    pub tool_calls: i32,
    /// 嵌入模型（不是对话模型），必须与召回时一致。
    #[serde(rename = "embedModel")]
    pub embed_model: String,
}

/// 写入结果。`created == false` 表示这条记忆早就在库里（幂等命中，**不是失败**）。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemoryResponse {
    pub schema_version: i32,
    #[serde(rename = "memoryID")]
    pub memory_id: String,
    pub created: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_templates_use_named_placeholders() {
        assert_eq!(
            fill_path(CHUNK_OBJECT_PATH, "{assetID}", "a-1"),
            "/internal/v1/assets/a-1/chunks"
        );
        assert_eq!(
            fill_path(EMBED_RANGE_PATH, "{assetID}", "a-1"),
            "/internal/v1/assets/a-1/embeddings"
        );
        assert_eq!(
            fill_path(UPSERT_INDEX_PATH, "{assetID}", "a-1"),
            "/internal/v1/assets/a-1/index"
        );
    }

    #[test]
    fn step_traceparent_reuses_upstream_trace_and_is_deterministic() {
        let parent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
        let first = step_traceparent(Some(parent), "instance-1:embed:0-16");
        let second = step_traceparent(Some(parent), "instance-1:embed:0-16");
        assert_eq!(first, second, "重放必须得到同一个 traceparent");
        assert!(first.starts_with("00-4bf92f3577b34da6a3ce929d0e0e4736-"));
        assert!(first.ends_with("-01"));

        let other = step_traceparent(Some(parent), "instance-1:embed:16-32");
        assert_ne!(first, other, "不同步骤要有各自的 span");

        let derived = step_traceparent(None, "instance-1:embed:0-16");
        assert_ne!(derived, first);
        assert!(TraceContext::parse(&derived).is_some(), "派生结果必须合法");
    }

    #[test]
    fn classifies_status_codes() {
        assert!(!classify_status(StatusCode::BAD_REQUEST, "bad").is_retryable());
        assert!(!classify_status(StatusCode::CONFLICT, "conflict").is_retryable());
        assert!(classify_status(StatusCode::TOO_MANY_REQUESTS, "").is_retryable());
        assert!(classify_status(StatusCode::SERVICE_UNAVAILABLE, "down").is_retryable());
        assert!(ComputeError::Timeout.is_retryable());
        assert!(!ComputeError::Decode("x".into()).is_retryable());
    }

    #[test]
    fn from_parts_trims_slash_and_rejects_empty_url() {
        let client =
            ComputeClient::from_parts("http://127.0.0.1:8081/", "t", 5_000, false).expect("client");
        assert_eq!(client.base_url, "http://127.0.0.1:8081");
        assert_eq!(
            client.url(CHUNK_OBJECT_PATH, "{assetID}", "a-1"),
            "http://127.0.0.1:8081/internal/v1/assets/a-1/chunks"
        );

        assert!(ComputeClient::from_parts("  ", "t", 5_000, false).is_err());
    }

    #[test]
    fn parses_chunk_and_index_responses() {
        let chunk: ChunkResponse =
            serde_json::from_str(r#"{"chunkSetID":"cs-1","chunkCount":33,"textSha":"ab"}"#)
                .expect("parse chunk");
        assert_eq!(chunk.chunk_set_id, "cs-1");
        assert_eq!(chunk.chunk_count, 33);

        let index: IndexResponse =
            serde_json::from_str(r#"{"indexed":33,"collection":"rag_v1"}"#).expect("parse index");
        assert_eq!(index.indexed, 33);
        assert_eq!(index.collection, "rag_v1");
    }

    #[test]
    fn serializes_request_with_camel_case_fields() {
        let request = ChunkRequest {
            schema_version: INTERNAL_SCHEMA_VERSION,
            tenant_id: "t-1".into(),
            mime: "text/markdown".into(),
            name: None,
            chunk_size: None,
            chunk_overlap: None,
        };
        let json = serde_json::to_value(&request).expect("serialize");
        assert_eq!(json["schemaVersion"], serde_json::json!(1));
        assert_eq!(json["tenantID"], serde_json::json!("t-1"));
        assert_eq!(json["mime"], serde_json::json!("text/markdown"));
        assert!(json.get("name").is_none());
        assert!(
            json.get("objectKey").is_none(),
            "对象存储键是对外泄漏实现细节，读取走 cogito 的服务身份内容端点"
        );
    }

    #[test]
    fn agent_step_request_uses_the_contract_field_names() {
        let request = AgentStepRequest {
            schema_version: INTERNAL_SCHEMA_VERSION,
            tenant_id: "t-1".into(),
            objective: "总结这批文档".into(),
            model: "deepseek-chat".into(),
            embed_model: "text-embedding-3-small".into(),
            history: vec![],
            allowed_tools: vec!["knowledge_search".into()],
            remaining_steps: Some(6),
        };
        let json = serde_json::to_value(&request).expect("serialize");

        // 通用驼峰转换会给出 `tenantId` / `embedModel` 之外的一堆错拼，契约里是
        // `tenantID` / `toolCallID` 这种写法，所以每个多字母缩写都必须显式对齐。
        assert_eq!(json["tenantID"], serde_json::json!("t-1"));
        assert_eq!(
            json["embedModel"],
            serde_json::json!("text-embedding-3-small")
        );
        assert_eq!(
            json["allowedTools"],
            serde_json::json!(["knowledge_search"])
        );
        assert_eq!(json["remainingSteps"], serde_json::json!(6));
        assert!(
            json.get("history").is_none(),
            "空历史与缺失同义，不必发出去"
        );
        assert!(json.get("tenantId").is_none(), "{json}");

        // 空工具是「要一条结论」的显式意图，不能因为空就被省掉。
        let no_tools = AgentStepRequest {
            allowed_tools: vec![],
            ..request
        };
        let json = serde_json::to_value(&no_tools).expect("serialize");
        assert_eq!(json["allowedTools"], serde_json::json!([]));
    }

    #[test]
    fn agent_step_response_round_trips_through_history() {
        let raw = r#"{
            "schemaVersion": 1,
            "finished": false,
            "message": {
                "role": "assistant",
                "content": null,
                "toolCalls": [
                    {"id": "call-1", "name": "knowledge_search", "arguments": "{\"query\":\"预算\"}"}
                ]
            },
            "toolResults": [
                {"toolCallID": "call-1", "name": "knowledge_search", "ok": true, "content": "段 1"}
            ],
            "usage": {"promptTokens": 120, "completionTokens": 8, "totalTokens": 128}
        }"#;
        let response: AgentStepResponse = serde_json::from_str(raw).expect("parse step");

        assert!(!response.finished);
        assert_eq!(response.tool_results[0].tool_call_id, "call-1");
        assert_eq!(response.usage.total_tokens, 128);
        let call = &response.message.tool_calls.as_ref().expect("calls")[0];
        assert_eq!(
            call.arguments.as_deref(),
            Some(r#"{"query":"预算"}"#),
            "参数必须原样保持 JSON 字符串：反序列化再序列化会漂"
        );

        // 回灌：助手消息 + 每个工具结果翻成一条 tool 消息（下游按 toolCallID 对齐）。
        let history = vec![
            AgentMessage::assistant(&response),
            AgentMessage::tool(&response.tool_results[0]),
        ];
        let json = serde_json::to_value(&history).expect("serialize");
        assert_eq!(json[0]["role"], serde_json::json!("assistant"));
        assert_eq!(json[0]["toolCalls"][0]["id"], serde_json::json!("call-1"));
        assert!(
            json[0].get("content").is_none(),
            "没有正文的助手消息不该发 null"
        );
        assert_eq!(json[1]["role"], serde_json::json!("tool"));
        assert_eq!(json[1]["toolCallID"], serde_json::json!("call-1"));
        assert!(
            json[1].get("toolCalls").is_none(),
            "tool 消息与工具调用无关"
        );
        assert!(
            json[1].get("error").is_none(),
            "机器码只进日志与审计，不喂模型"
        );
        assert!(json[0].get("toolCallId").is_none(), "{json}");
    }

    #[test]
    fn usage_adds_up_across_steps() {
        let mut total = AgentUsage {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        };
        let step = AgentUsage {
            prompt_tokens: 100,
            completion_tokens: 10,
            total_tokens: 110,
        };
        total.add(&step);
        total.add(&step);
        assert_eq!(total.total_tokens, 220);
        assert_eq!(total.prompt_tokens, 200);
    }

    #[test]
    fn agent_memory_request_uses_the_contract_field_names() {
        let request = AgentMemoryRequest {
            schema_version: INTERNAL_SCHEMA_VERSION,
            tenant_id: "t-1".into(),
            task_id: "task-1".into(),
            objective: "总结这批文档".into(),
            answer: "结论".into(),
            steps: 3,
            tool_calls: 2,
            embed_model: "text-embedding-3-small".into(),
        };
        let json = serde_json::to_value(&request).expect("serialize");

        // 与 `AgentStepRequest` 同一个坑：`taskId` / `embedModel` 之类的自动驼峰会写错缩写，
        // 每个多字母缩写都得显式对齐（契约里是 `taskID` / `toolCalls`）。
        assert_eq!(json["tenantID"], serde_json::json!("t-1"));
        assert_eq!(json["taskID"], serde_json::json!("task-1"));
        assert_eq!(json["toolCalls"], serde_json::json!(2));
        assert_eq!(
            json["embedModel"],
            serde_json::json!("text-embedding-3-small")
        );
        assert!(json.get("taskId").is_none(), "{json}");
    }

    #[test]
    fn agent_memory_response_keeps_the_idempotent_hit_visible() {
        let raw = r#"{"schemaVersion":1,"memoryID":"0b0e1e1e-1c1c-4c4c-8c8c-1c1c1c1c1c1c","created":false}"#;
        let response: AgentMemoryResponse = serde_json::from_str(raw).expect("parse memory");

        // `created=false` 是幂等命中，不是失败：解析层不该把它当成缺字段或错误。
        assert!(!response.created);
        assert_eq!(response.memory_id, "0b0e1e1e-1c1c-4c4c-8c8c-1c1c1c1c1c1c");
        assert_eq!(response.schema_version, INTERNAL_SCHEMA_VERSION);
    }
}
