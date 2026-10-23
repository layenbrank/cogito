#![allow(dead_code)]

//! P4d 集成测试脚手架：compute 桩 + 编排库工具。
//!
//! 桩是一个最小 HTTP/1.1 服务端（只用 tokio，不引额外依赖），按路径路由、逐条记录到达的
//! 请求，并且可以把指定的第 n 次调用**按住不放**（不回调、连接也不关）：编排因此卡在
//! 「上一步刚提交、这一步正在飞」的状态上，测试可以慢慢读进度——这比「睡一会儿再回包」可靠，
//! 因为不存在读进度时错过窗口的竞争。放行用 [`StubCompute::release`]。
//! 请求一到达就记录，所以「第 n 次调用」也可以直接当栅栏用。

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use durable::{Client, DurableSettings, InstanceStatus};
use serde_json::{Value, json};
use cogito::clients::compute::INTERNAL_SCHEMA_VERSION;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use uuid::Uuid;

/// 桩回给 cogito 的长期记忆 id（真实实现按 (租户, 任务) 派生，这里固定一个即可）。
pub const MEMORY_ID: &str = "6f1d1f2a-0b7c-5c8f-9b0e-2c3d4e5f6a7b";

/// 桩收到的一条请求（头的**名字**已小写，便于按名字查；值保持原样）。
#[derive(Debug, Clone)]
pub struct Recorded {
    pub method: String,
    pub path: String,
    pub body: String,
    head: String,
}

impl Recorded {
    fn parse(raw: &str) -> Self {
        let (head, body) = raw.split_once("\r\n\r\n").unwrap_or((raw, ""));
        let mut lines = head.lines();
        let request_line = lines.next().unwrap_or_default();
        let mut parts = request_line.split_whitespace();

        Self {
            method: parts.next().unwrap_or_default().to_ascii_uppercase(),
            path: parts.next().unwrap_or_default().to_string(),
            body: body.to_string(),
            head: lower_header_names(head),
        }
    }

    /// 请求头（大小写不敏感）。
    pub fn header(&self, name: &str) -> Option<String> {
        let prefix = format!("{}:", name.to_ascii_lowercase());

        self.head
            .lines()
            .find_map(|line| line.strip_prefix(&prefix))
            .map(|value| value.trim().to_string())
    }

    /// 幂等键；缺头直接失败（三个内部头都是契约要求的）。
    pub fn idempotency_key(&self) -> String {
        self.header("idempotency-key")
            .unwrap_or_else(|| panic!("请求缺 Idempotency-Key：{}", self.path))
    }

    pub fn traceparent(&self) -> String {
        self.header("traceparent")
            .unwrap_or_else(|| panic!("请求缺 traceparent：{}", self.path))
    }

    pub fn internal_token(&self) -> String {
        self.header("x-internal-token")
            .unwrap_or_else(|| panic!("请求缺 X-Internal-Token：{}", self.path))
    }

    pub fn json(&self) -> Value {
        serde_json::from_str(&self.body)
            .unwrap_or_else(|error| panic!("请求体不是 JSON（{error}）：{}", self.body))
    }
}

/// 头名字小写化，值原样保留：`Authorization` 这类值本身大小写敏感（`ACS3-HMAC-SHA256`），
/// 整段小写会把「签名算法没写对」这类断言变成假阴性。请求行不参与小写化。
fn lower_header_names(head: &str) -> String {
    let mut out = String::with_capacity(head.len());
    for (index, line) in head.split("\r\n").enumerate() {
        if index > 0 {
            out.push_str("\r\n");
        }
        match line.split_once(':') {
            Some((name, value)) if index > 0 => {
                out.push_str(&name.to_ascii_lowercase());
                out.push(':');
                out.push_str(value);
            }
            _ => out.push_str(line),
        }
    }

    out
}

/// 桩的行为脚本。
#[derive(Debug, Clone)]
pub struct Script {
    chunk_count: i32,
    dimensions: i32,
    collection: String,
    chunk_set_id: String,
    /// 路径片段 -> 第几次调用（1 起）按住不放。
    /// 请求体已经读完才开始按，所以「第 n 次调用」这级栅栏仍然成立：测试能在下游一直不回包
    /// 的状态下继续观察编排进度。永不调用 [`StubCompute::release`] 就是「下游卡死」。
    hangs: Vec<(String, usize)>,
    /// 单步 agent 的预设响应，按到达顺序取；用完之后一直复用最后一条。
    /// 与 `chunks` / `embeddings` 不同：这一步的产出不是从请求里推出来的，只能预设。
    agent_steps: Vec<Value>,
    /// 路由名 -> 状态码覆盖（默认 200）。用来演练「下游明确拒绝」这类**不可重试**的失败。
    statuses: Vec<(String, u16)>,
}

impl Script {
    pub fn new(chunk_count: i32, dimensions: i32) -> Self {
        Self {
            chunk_count,
            dimensions,
            collection: "stub_chunks".to_owned(),
            chunk_set_id: "chunk-set-0001".to_owned(),
            hangs: Vec::new(),
            agent_steps: Vec::new(),
            statuses: Vec::new(),
        }
    }

    /// 只跑 agent 的脚本：不分块、不嵌入，按顺序回预设的单步结果。
    pub fn agent(steps: Vec<Value>) -> Self {
        Self {
            agent_steps: steps,
            ..Self::new(0, 0)
        }
    }

    /// 按住该路径的第 `nth` 次调用（1 起）；测试读完成进后再放行。
    pub fn hang(mut self, fragment: &str, nth: usize) -> Self {
        self.hangs.push((fragment.to_owned(), nth));
        self
    }

    pub fn collection(mut self, collection: &str) -> Self {
        self.collection = collection.to_owned();
        self
    }

    pub fn chunk_set_id(mut self, chunk_set_id: &str) -> Self {
        self.chunk_set_id = chunk_set_id.to_owned();
        self
    }

    /// 该路径的第 `ordinal` 次调用是否要按住不放；返回命中的片段（放行时用它做键）。
    fn hang_of(&self, path: &str, ordinal: usize) -> Option<&str> {
        self.hangs
            .iter()
            .find(|(fragment, nth)| path.contains(fragment.as_str()) && *nth == ordinal)
            .map(|(fragment, _)| fragment.as_str())
    }

    /// 覆盖某条路由的状态码（默认 200）。**不可重试**的失败（4xx 里除 429 之外，或
    /// 5xx 之外的业务错）用这个演练，比按路径「构造不认识的端点」更直白。
    pub fn status(mut self, route: &str, status: u16) -> Self {
        self.statuses.push((route.to_owned(), status));
        self
    }

    fn status_for(&self, route: &str) -> u16 {
        self.statuses
            .iter()
            .find(|(name, _)| name == route)
            .map(|(_, status)| *status)
            .unwrap_or(200)
    }

    fn body_for(&self, fragment: &str, request: &Recorded, ordinal: usize) -> Value {
        match fragment {
            "chunks" => json!({
                "chunkSetID": self.chunk_set_id,
                "chunkCount": self.chunk_count,
                "textSha": "0".repeat(64),
            }),
            "embeddings" => {
                // 区间必须原样回给编排（它拿返回值校验请求区间），所以从请求体里取。
                let payload = request.json();
                let from = payload["from"].as_i64().unwrap_or_default();
                let to = payload["to"].as_i64().unwrap_or_default();

                json!({
                    "from": from,
                    "to": to,
                    "embedded": to - from,
                    "dimensions": self.dimensions,
                })
            }
            "index" => json!({
                "indexed": self.chunk_count,
                "collection": self.collection,
            }),
            // 第 n 轮到第 n 条预设；用完之后一直复用最后一条（「模型不再改口」）。
            // 忘了预设时不 panic：回一条能被看见的错误体，失败会落在客户端的解析上。
            "steps" => self
                .agent_steps
                .get(ordinal.saturating_sub(1))
                .or_else(|| self.agent_steps.last())
                .cloned()
                .unwrap_or_else(|| json!({ "error": "脚本没有预设 agent 单步响应" })),
            // 审批通过后真的去执行：结果必须对齐**请求里那一次调用**（编排会核对
            // `toolCallID`），所以从请求体回填，不能自己造一个 id。
            "tool-executions" => {
                let payload = request.json();
                let call = &payload["toolCall"];
                let call_id = call["id"].as_str().unwrap_or("unknown-call");
                let name = call["name"].as_str().unwrap_or("unknown-tool");

                json!({
                    "schemaVersion": INTERNAL_SCHEMA_VERSION,
                    "toolResult": {
                        "toolCallID": call_id,
                        "name": name,
                        "ok": true,
                        "content": format!("{name} 执行完成（桩）"),
                    },
                })
            }
            // 直通通道（MCP tools/call 的落地）：形状与 tool-executions 一样，请求里没有
            // taskID / approvalID，响应仍是 schemaVersion + toolResult。
            "tool-invocations" => {
                let payload = request.json();
                let call = &payload["toolCall"];
                let call_id = call["id"].as_str().unwrap_or("unknown-call");
                let name = call["name"].as_str().unwrap_or("unknown-tool");

                json!({
                    "schemaVersion": INTERNAL_SCHEMA_VERSION,
                    "toolResult": {
                        "toolCallID": call_id,
                        "name": name,
                        "ok": true,
                        "content": format!("{name} 直通执行完成（桩）"),
                    },
                })
            }
            // 长期记忆写入：诚实回一个 uuid + `created`。真实实现按 (租户, 任务) 派生确定性
            // id，桩里固定一个常量就够——cogito 只把它当字符串带进台账。
            "memories" => json!({
                "schemaVersion": INTERNAL_SCHEMA_VERSION,
                "memoryID": MEMORY_ID,
                "created": true,
            }),
            _ => json!({
                "status": "ok",
                "version": "0.0.0-stub",
                "capabilities": ["chunk", "embed", "index"],
            }),
        }
    }
}

/// 桩：`start()` 之后用 `base_url()` 装配 `ComputeClient`。
pub struct StubCompute {
    base_url: String,
    script: Arc<Script>,
    requests: Arc<Mutex<Vec<Recorded>>>,
    released: Arc<Mutex<HashSet<(String, usize)>>>,
    _accept: tokio::task::JoinHandle<()>,
}

impl StubCompute {
    pub async fn start(script: Script) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("绑定 compute 桩端口失败");
        let address = listener.local_addr().expect("取桩端口失败");

        let script = Arc::new(script);
        let requests: Arc<Mutex<Vec<Recorded>>> = Arc::new(Mutex::new(Vec::new()));
        let released: Arc<Mutex<HashSet<(String, usize)>>> = Arc::new(Mutex::new(HashSet::new()));

        let accept_script = Arc::clone(&script);
        let accept_requests = Arc::clone(&requests);
        let accept_released = Arc::clone(&released);
        let accept = tokio::spawn(async move {
            loop {
                let Ok((socket, _)) = listener.accept().await else {
                    return;
                };
                let script = Arc::clone(&accept_script);
                let requests = Arc::clone(&accept_requests);
                let released = Arc::clone(&accept_released);
                // 一条连接一个任务：被按住的连接不能挡住后面的请求。
                tokio::spawn(async move { serve(socket, script, requests, released).await });
            }
        });

        Self {
            base_url: format!("http://{address}"),
            script,
            requests,
            released,
            _accept: accept,
        }
    }

    pub fn base_url(&self) -> String {
        self.base_url.clone()
    }

    /// 到目前为止收到的全部请求（按到达顺序）。
    pub fn requests(&self) -> Vec<Recorded> {
        self.requests.lock().expect("请求日志锁").clone()
    }

    /// 路径里含该片段的请求，例如 `matching("/embeddings")`。
    pub fn matching(&self, fragment: &str) -> Vec<Recorded> {
        self.requests()
            .into_iter()
            .filter(|request| request.path.contains(fragment))
            .collect()
    }

    pub fn count(&self, fragment: &str) -> usize {
        self.matching(fragment).len()
    }

    /// 幂等键序列（按到达顺序），用来证明重跑拿到的是同一个键。
    pub fn idempotency_keys(&self, fragment: &str) -> Vec<String> {
        self.matching(fragment)
            .iter()
            .map(Recorded::idempotency_key)
            .collect()
    }

    /// 放行被按住的那一次调用：参数与 [`Script::hang`] 一致（片段 + 第几次）。
    pub fn release(&self, fragment: &str, nth: usize) {
        self.released
            .lock()
            .expect("放行表锁")
            .insert((fragment.to_owned(), nth));
    }

    /// 等到该路径至少被调用 `count` 次；超时把已收到的请求打出来。
    pub async fn wait_for(&self, fragment: &str, count: usize, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        loop {
            if self.count(fragment) >= count {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "等 {fragment} 的第 {count} 次调用超时；已收到的请求：{:#?}",
                self.requests()
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
}

/// 通用 HTTP 桩：按「第几次请求」回预设响应，并把收到的请求原样记下来。
///
/// 与 [`StubCompute`] 的分工：那个是 compute 的**语义**桩（按路径造业务 JSON），
/// 这个只回调用方写好的响应，用来验证**协议**细节（请求落位、签名头、错误分支）。
/// 只懂 HTTP/1.1 的一部分（不含 chunked 请求体），够验签与表单/查询参数用。
pub struct StubHttp {
    base_url: String,
    script: Arc<Vec<StubResponse>>,
    requests: Arc<Mutex<Vec<Recorded>>>,
    _accept: tokio::task::JoinHandle<()>,
}

/// 一条预设响应。
#[derive(Debug, Clone)]
pub struct StubResponse {
    status: u16,
    content_type: String,
    body: Vec<u8>,
}

impl StubResponse {
    pub fn json(status: u16, body: Value) -> Self {
        Self {
            status,
            content_type: "application/json".to_owned(),
            body: body.to_string().into_bytes(),
        }
    }

    pub fn text(status: u16, body: impl Into<String>) -> Self {
        Self {
            status,
            content_type: "text/plain; charset=utf-8".to_owned(),
            body: body.into().into_bytes(),
        }
    }

    pub fn bytes(status: u16, content_type: &str, body: impl Into<Vec<u8>>) -> Self {
        Self {
            status,
            content_type: content_type.to_owned(),
            body: body.into(),
        }
    }
}

impl StubHttp {
    /// 按顺序回 `script`；请求数超出脚本长度时**一直回最后一条**（轮询/重试用例省事）。
    pub async fn start(script: Vec<StubResponse>) -> Self {
        assert!(!script.is_empty(), "HTTP 桩至少要有一条响应");
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("绑定 HTTP 桩端口失败");
        let address = listener.local_addr().expect("取桩端口失败");

        let script = Arc::new(script);
        let requests: Arc<Mutex<Vec<Recorded>>> = Arc::new(Mutex::new(Vec::new()));

        let accept_script = Arc::clone(&script);
        let accept_requests = Arc::clone(&requests);
        let accept = tokio::spawn(async move {
            loop {
                let Ok((socket, _)) = listener.accept().await else {
                    return;
                };
                let script = Arc::clone(&accept_script);
                let requests = Arc::clone(&accept_requests);
                tokio::spawn(async move { serve_stub_http(socket, script, requests).await });
            }
        });

        Self {
            base_url: format!("http://{address}"),
            script,
            requests,
            _accept: accept,
        }
    }

    /// 桩地址（不含路径）：直接填进 `aliyun.*.endpoint`。
    pub fn base_url(&self) -> String {
        self.base_url.clone()
    }

    pub fn requests(&self) -> Vec<Recorded> {
        self.requests.lock().expect("请求日志锁").clone()
    }

    /// 只收到一条请求时取它；多于/少于一条都失败（用来确认「没有重试」）。
    pub fn only(&self) -> Recorded {
        let requests = self.requests();
        assert_eq!(
            requests.len(),
            1,
            "期望恰好一条请求，实际 {}：{requests:#?}",
            requests.len()
        );

        requests.into_iter().next().expect("已断言非空")
    }

    pub fn script_len(&self) -> usize {
        self.script.len()
    }
}

async fn serve_stub_http(
    mut socket: TcpStream,
    script: Arc<Vec<StubResponse>>,
    requests: Arc<Mutex<Vec<Recorded>>>,
) {
    let raw = read_request(&mut socket).await;
    let request = Recorded::parse(&raw);
    let index = {
        let mut log = requests.lock().expect("请求日志锁");
        let index = log.len();
        log.push(request);
        index
    };

    let response = script
        .get(index)
        .or_else(|| script.last())
        .expect("脚本非空");
    let head = format!(
        "HTTP/1.1 {} OK\r\ncontent-type: {}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        response.status,
        response.content_type,
        response.body.len()
    );
    let mut raw = head.into_bytes();
    raw.extend_from_slice(&response.body);
    let _ = socket.write_all(&raw).await;
}

/// 桩的一轮处理：记录 → 判断是否按住 → 回包。
async fn serve(
    mut socket: TcpStream,
    script: Arc<Script>,
    requests: Arc<Mutex<Vec<Recorded>>>,
    released: Arc<Mutex<HashSet<(String, usize)>>>,
) {
    let raw = read_request(&mut socket).await;
    let request = Recorded::parse(&raw);
    let matched = route(&request.path);

    let ordinal = {
        let mut log = requests.lock().expect("请求日志锁");
        let ordinal = log
            .iter()
            .filter(|seen| route(&seen.path) == matched)
            .count()
            + 1;
        log.push(request.clone());
        ordinal
    };

    let Some(route_name) = matched else {
        let body = json!({ "error": "桩不认识这条路径" });
        let _ = write_json(&mut socket, 404, &body).await;
        return;
    };

    if let Some(fragment) = script.hang_of(&request.path, ordinal) {
        let key = (fragment.to_owned(), ordinal);
        loop {
            if released.lock().expect("放行表锁").contains(&key) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    let status = script.status_for(route_name);
    let body = if status == 200 {
        script.body_for(route_name, &request, ordinal)
    } else {
        // 非 200 一律回 compute 的错误信封：分类依据是状态码，但报文形状也要像真的，
        // 免得「用错形状的桩验出了对的分类」。
        json!({ "error": { "code": "invalid_request", "message": "桩拒绝了这次调用" } })
    };
    let _ = write_json(&mut socket, status, &body).await;
}

/// 路径 → 路由名；不认识的路径回 `None`。
fn route(path: &str) -> Option<&'static str> {
    for (suffix, name) in [
        ("/agents/steps", "steps"),
        ("/agents/tool-executions", "tool-executions"),
        ("/agents/tool-invocations", "tool-invocations"),
        ("/agents/memories", "memories"),
        ("/chunks", "chunks"),
        ("/embeddings", "embeddings"),
        ("/index", "index"),
        ("/health", "health"),
    ] {
        if path.ends_with(suffix) {
            return Some(name);
        }
    }

    None
}

async fn write_json(socket: &mut TcpStream, status: u16, body: &Value) -> std::io::Result<()> {
    let body = body.to_string();
    let response = format!(
        "HTTP/1.1 {status} STUB\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    );

    socket.write_all(response.as_bytes()).await
}

/// 读一条 HTTP 请求（先头后体，按 `content-length`）。
async fn read_request(socket: &mut TcpStream) -> String {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 2048];
    let head_end = loop {
        if let Some(index) = find_head_end(&buffer) {
            break index;
        }
        let read = socket.read(&mut chunk).await.unwrap_or(0);
        if read == 0 {
            return String::from_utf8_lossy(&buffer).into_owned();
        }
        buffer.extend_from_slice(&chunk[..read]);
    };

    let head = String::from_utf8_lossy(&buffer[..head_end]).to_ascii_lowercase();
    let length = content_length(&head);
    while buffer.len() - head_end - 4 < length {
        let read = socket.read(&mut chunk).await.unwrap_or(0);
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
    }

    String::from_utf8_lossy(&buffer).into_owned()
}

fn find_head_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn content_length(head: &str) -> usize {
    head.lines()
        .find_map(|line| line.strip_prefix("content-length:"))
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or(0)
}

/// 读取测试库地址；未配置或库名不合法时返回 `None`（调用方直接跳过）。
/// 让本地桩免遭本机代理劫持。
///
/// Windows 桌面代理（Clash 之类）会把发往 `127.0.0.1:桩端口` 的请求也代理走，于是桩收到
/// 0 个请求、客户端拿到 502。`reqwest`（以及 `opendal` 底下的 reqwest）只认 `NO_PROXY`
/// 环境变量，不看注册表 `ProxyOverride`。只写这一个常量值、且在每个 HTTP 客户端构造之前
/// 完成，所以并发测试之间没有可观察的竞态。
pub fn bypass_proxy_for_local_stubs() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        for name in ["NO_PROXY", "no_proxy"] {
            // SAFETY: 见上文；值恒定，写在任何客户端构造之前。
            unsafe { std::env::set_var(name, "127.0.0.1,localhost") };
        }
    });
}

pub fn test_database_url() -> Option<String> {
    let uri = std::env::var("TEST_DATABASE_URL").ok()?;
    let uri = uri.trim().to_owned();
    if uri.is_empty() {
        return None;
    }
    let database = uri
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .split('?')
        .next()
        .unwrap_or_default();
    assert!(
        database.contains("test"),
        "TEST_DATABASE_URL 指向的库名必须含 `test`（当前：{database}）"
    );

    Some(uri)
}

/// 每个用例独占 schema，避免用例之间互相看到对方的实例。
pub fn test_schema() -> String {
    format!("durable_test_{}", Uuid::new_v4().simple())
}

pub fn settings(uri: &str, schema: &str) -> DurableSettings {
    DurableSettings::new(uri, schema, true)
}

/// 轮询状态直到编排写到自己要等的那个进度串（或超时、或提前终态）。
///
/// 只该在「编排被桩按住不动」的时候调用：否则读到的进度可能已经翻到下一档，栅栏失效。
pub async fn wait_for_custom_status(client: &Client, instance: &str, want: &str) -> InstanceStatus {
    let deadline = Instant::now() + Duration::from_secs(30);
    // 记住看过的每一档，失败时一并打出来——能一眼看出是「没写过这一档」还是「读晚了」。
    let mut seen: Vec<String> = Vec::new();

    loop {
        let status = client.status(instance).await.expect("查询实例状态");
        if let InstanceStatus::Running { custom_status } = &status {
            let current = custom_status.clone().unwrap_or_else(|| "(无)".to_owned());
            if seen.last() != Some(&current) {
                seen.push(current);
            }
            if custom_status.as_deref() == Some(want) {
                return status;
            }
        }
        assert!(
            !status.is_terminal(),
            "实例在等到 {want} 之前已经终态：{status:?}（看过的进度：{seen:?}）"
        );
        assert!(
            Instant::now() < deadline,
            "等待自定义进度 {want} 超时，当前状态：{status:?}（看过的进度：{seen:?}）"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}
