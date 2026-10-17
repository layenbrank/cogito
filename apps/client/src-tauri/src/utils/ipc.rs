//! corex-daemon Named Pipe IPC 客户端（v5 Action 协议 + 长连接复用）

use std::ffi::OsStr;
use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter};

/// 默认 Named Pipe 名称（与 corex-daemon 一致）
pub const PIPE_NAME: &str = r"\\.\pipe\corex";

static REQUEST_ID: AtomicU64 = AtomicU64::new(1);

/// 进程内唯一长连接；同连接多行 Invoke，避免每请求 CreateFile 握手风暴。
static SESSION: Mutex<Option<File>> = Mutex::new(None);

/// 前端扁平响应（由 daemon tagged Response 归一）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcResponse {
    pub id: u64,
    pub ok: bool,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub data: Option<Value>,
    pub ms: u64,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RpcErrorBody {
    code: i32,
    message: String,
}

/// daemon → client（`crates/ipc` `Response`）
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum DaemonResponse {
    Pong {
        id: u64,
    },
    Ok {
        id: u64,
        #[serde(default)]
        data: Value,
    },
    Error {
        id: u64,
        error: RpcErrorBody,
    },
    Bye {
        id: u64,
    },
}

/// 短连接 NDJSON 回话（含 stream 中间帧）。
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
#[allow(dead_code)]
enum FreshResponse {
    Pong {
        id: u64,
    },
    Ok {
        id: u64,
        #[serde(default)]
        data: Value,
    },
    Error {
        id: u64,
        error: RpcErrorBody,
    },
    Event {
        id: u64,
        progress: Value,
    },
    Bye {
        id: u64,
    },
}

/// 拼出最终 action id。`action` 不得含 `.`，禁止用完整 id 覆盖 `module` 白名单。
fn parse_action_id(module: &str, action: Option<&str>) -> Result<String, String> {
    match action {
        Some(a) => {
            let trimmed = a.trim();
            if trimmed.is_empty() {
                return Err("action 不能为空".into());
            }
            if trimmed.contains('.') {
                return Err("action 不得包含 '.'".into());
            }
            Ok(format!("{module}.{trimmed}"))
        }
        None => Ok(module.to_string()),
    }
}

/// 解析 auth token，顺序对齐 corex `data_dir` / `find_token`：
/// `COREX_TOKEN` → `<COREX_DATA_DIR>/token` → `<exe 目录>/token` → `%APPDATA%/corex/token`
pub fn auth_token() -> Result<String, String> {
    if let Ok(token) = std::env::var("COREX_TOKEN") {
        let trimmed = token.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    let candidates = token_candidates();
    for path in &candidates {
        if let Ok(text) = std::fs::read_to_string(path) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Ok(trimmed.to_string());
            }
        }
    }
    let hint = candidates
        .iter()
        .map(|p| p.display().to_string())
        .collect::<Vec<_>>()
        .join(" | ");
    Err(format!(
        "缺少 corex auth token：请先启动 corex-daemon，或设置 COREX_TOKEN。已查找: {hint}"
    ))
}

fn token_candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(dir) = std::env::var("COREX_DATA_DIR") {
        let dir = PathBuf::from(dir);
        // endpoint 记录里可能写了绝对 token 路径
        if let Some(from_record) = token_from_endpoint_record(&dir) {
            paths.push(from_record);
        }
        paths.push(dir.join("token"));
    }
    // debug / sidecar：daemon 无 COREX_DATA_DIR 时落在可写 exe 目录（与 corex try_exe_dir 一致）
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("token"));
        }
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        let root = PathBuf::from(&appdata).join("corex");
        paths.push(root.join("token"));
        // 旧错误路径：仍试一次，兼容历史部署
        paths.push(root.join("data").join("token"));
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        paths.push(PathBuf::from(&local).join("corex").join("token"));
    }
    paths
}

fn token_from_endpoint_record(data_dir: &PathBuf) -> Option<PathBuf> {
    let record = data_dir.join("endpoint.json");
    let text = std::fs::read_to_string(record).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    value
        .get("token_file")
        .and_then(Value::as_str)
        .map(PathBuf::from)
}

/// 调用 Action；`module` 可为完整 id，或与 `action` 拼成 `{module}.{action}`
pub fn invoke(module: &str, args: Value) -> Result<IpcResponse, String> {
    invoke_with(module, None, args)
}

/// 指令编排等控制类请求：每次新建 Named Pipe，读到终帧为止。
pub fn call(request_type: &str, fields: Value) -> Result<Value, String> {
    call_with_stream(request_type, fields, false, None::<fn(Value)>)
}

/// 同 [`call`]，但 `stream: true` 且对非 heartbeat 的 `event` 帧调用 `on_progress`。
pub fn call_with_stream<F>(
    request_type: &str,
    fields: Value,
    stream: bool,
    mut on_progress: Option<F>,
) -> Result<Value, String>
where
    F: FnMut(Value),
{
    #[cfg(windows)]
    {
        let id = REQUEST_ID.fetch_add(1, Ordering::Relaxed);
        let token = auth_token()?;
        let mut payload = json!({
            "type": request_type,
            "id": id,
            "auth_token": token,
        });
        if stream {
            payload["stream"] = json!(true);
        }
        merge_fields(&mut payload, fields);
        exchange_fresh(id, &payload.to_string(), &mut on_progress)
    }
    #[cfg(not(windows))]
    {
        let _ = (request_type, fields, stream, on_progress);
        Err("IPC 当前仅支持 Windows Named Pipe".to_string())
    }
}

/// 流式执行：经 Tauri 事件推送进度（过滤 heartbeat）。
///
/// 开始前先发一帧 `{ kind: "started", runId, requestId }`，供前端 `cancel_execution`。
pub fn call_stream(
    app: &AppHandle,
    event_channel: &str,
    run_id: &str,
    request_type: &str,
    fields: Value,
) -> Result<Value, String> {
    #[cfg(windows)]
    {
        let request_id = REQUEST_ID.fetch_add(1, Ordering::Relaxed);
        let token = auth_token()?;
        let mut payload = json!({
            "type": request_type,
            "id": request_id,
            "auth_token": token,
            "stream": true,
        });
        merge_fields(&mut payload, fields);

        let _ = app.emit(
            event_channel,
            json!({
                "kind": "started",
                "runId": run_id,
                "requestId": request_id,
            }),
        );

        let app = app.clone();
        let event_channel = event_channel.to_string();
        let run_id = run_id.to_string();
        let mut on_progress = Some(move |progress: Value| {
            if progress.get("kind").and_then(Value::as_str) == Some("heartbeat") {
                return;
            }
            let mut frame = progress;
            if let Some(obj) = frame.as_object_mut() {
                obj.insert("runId".to_string(), json!(run_id));
            }
            let _ = app.emit(&event_channel, frame);
        });
        exchange_fresh(request_id, &payload.to_string(), &mut on_progress)
    }
    #[cfg(not(windows))]
    {
        let _ = (app, event_channel, run_id, request_type, fields);
        Err("IPC 当前仅支持 Windows Named Pipe".to_string())
    }
}

pub fn invoke_with(module: &str, action: Option<&str>, args: Value) -> Result<IpcResponse, String> {
    let id = REQUEST_ID.fetch_add(1, Ordering::Relaxed);
    let action_id = parse_action_id(module, action)?;
    let token = auth_token()?;
    let payload = json!({
        "type": "invoke",
        "id": id,
        "auth_token": token,
        "action": action_id,
        "params": args,
    });
    exchange(id, &payload.to_string())
}

pub fn has_session() -> bool {
    SESSION.lock().map(|guard| guard.is_some()).unwrap_or(false)
}

pub fn is_ready() -> bool {
    #[cfg(windows)]
    {
        let Ok(mut guard) = SESSION.lock() else {
            return false;
        };
        if guard.is_some() {
            return true;
        }
        match open_pipe(PIPE_NAME) {
            Ok(file) => {
                *guard = Some(file);
                true
            }
            Err(_) => false,
        }
    }
    #[cfg(not(windows))]
    {
        false
    }
}

pub fn is_listening() -> bool {
    #[cfg(windows)]
    {
        open_pipe(PIPE_NAME).is_ok()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

pub fn drop_session() {
    if let Ok(mut guard) = SESSION.lock() {
        *guard = None;
    }
}

pub fn shutdown() -> Result<(), String> {
    #[cfg(windows)]
    {
        let id = REQUEST_ID.fetch_add(1, Ordering::Relaxed);
        let token = auth_token().unwrap_or_default();
        let payload = json!({
            "type": "shutdown",
            "id": id,
            "auth_token": token,
        });
        let mut guard = SESSION.lock().map_err(|e| format!("IPC 锁失败: {e}"))?;
        let file = match guard.as_mut() {
            Some(file) => file,
            None => {
                let file = open_pipe(PIPE_NAME)?;
                *guard = Some(file);
                guard.as_mut().expect("刚写入会话")
            }
        };
        let write_result = (|| -> Result<(), String> {
            file.write_all(payload.to_string().as_bytes())
                .map_err(|e| e.to_string())?;
            file.write_all(b"\n").map_err(|e| e.to_string())?;
            file.flush().map_err(|e| e.to_string())?;
            Ok(())
        })();
        *guard = None;
        write_result
    }
    #[cfg(not(windows))]
    {
        Err("IPC 当前仅支持 Windows Named Pipe".to_string())
    }
}

fn exchange(request_id: u64, request_json: &str) -> Result<IpcResponse, String> {
    #[cfg(windows)]
    {
        match exchange_once(request_id, request_json) {
            Ok(response) => Ok(response),
            Err(first) => {
                drop_session();
                exchange_once(request_id, request_json)
                    .map_err(|second| format!("IPC 失败（重连后仍失败）: {second}；首次: {first}"))
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (request_id, request_json);
        Err("IPC 当前仅支持 Windows Named Pipe".to_string())
    }
}

fn merge_fields(payload: &mut Value, fields: Value) {
    let Some(extra) = fields.as_object() else {
        return;
    };
    let Some(target) = payload.as_object_mut() else {
        return;
    };
    for (key, value) in extra {
        target.insert(key.clone(), value.clone());
    }
}

fn parse_fresh_terminal(raw: &str, request_id: u64) -> Result<Value, String> {
    let frame: FreshResponse =
        serde_json::from_str(raw).map_err(|e| format!("解析 IPC 响应失败: {e}"))?;
    match frame {
        FreshResponse::Ok { id, data } => {
            if id != request_id {
                return Err(format!("IPC 响应 id 不匹配: 期望 {request_id}, 收到 {id}"));
            }
            Ok(data)
        }
        FreshResponse::Error { id, error } => {
            if id != request_id {
                return Err(format!("IPC 响应 id 不匹配: 期望 {request_id}, 收到 {id}"));
            }
            Err(format!("[{}] {}", error.code, error.message))
        }
        FreshResponse::Pong { id } => {
            if id != request_id {
                return Err(format!("IPC 响应 id 不匹配: 期望 {request_id}, 收到 {id}"));
            }
            Ok(json!({ "pong": true }))
        }
        FreshResponse::Bye { id } => {
            if id != request_id {
                return Err(format!("IPC 响应 id 不匹配: 期望 {request_id}, 收到 {id}"));
            }
            Ok(Value::Null)
        }
        FreshResponse::Event { .. } => Err("parse_fresh_terminal 收到 event 帧".into()),
    }
}

#[cfg(windows)]
fn exchange_fresh<F>(
    request_id: u64,
    request_json: &str,
    on_progress: &mut Option<F>,
) -> Result<Value, String>
where
    F: FnMut(Value),
{
    let mut file = open_pipe(PIPE_NAME)?;
    file.write_all(request_json.as_bytes())
        .map_err(|e| e.to_string())?;
    file.write_all(b"\n").map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())?;

    let mut reader = BufReader::new(file);
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).map_err(|e| e.to_string())?;
        if line.is_empty() {
            return Err("IPC 响应为空（连接可能已关闭）".to_string());
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let peek: FreshResponse =
            serde_json::from_str(trimmed).map_err(|e| format!("解析 IPC 响应失败: {e}"))?;
        match peek {
            FreshResponse::Event { progress, .. } => {
                if let Some(handler) = on_progress.as_mut() {
                    handler(progress);
                }
            }
            FreshResponse::Ok { .. }
            | FreshResponse::Error { .. }
            | FreshResponse::Pong { .. }
            | FreshResponse::Bye { .. } => {
                return parse_fresh_terminal(trimmed, request_id);
            }
        }
    }
}

fn parse_daemon_response(raw: &str, request_id: u64) -> Result<IpcResponse, String> {
    let daemon: DaemonResponse =
        serde_json::from_str(raw).map_err(|e| format!("解析 IPC 响应失败: {e}"))?;
    match daemon {
        DaemonResponse::Ok { id, data } => {
            if id != request_id {
                return Err(format!("IPC 响应 id 不匹配: 期望 {request_id}, 收到 {id}"));
            }
            let path = data
                .as_object()
                .and_then(|m| m.get("path"))
                .and_then(|v| v.as_str())
                .map(str::to_string);
            Ok(IpcResponse {
                id,
                ok: true,
                path,
                data: Some(data),
                ms: 0,
                error: None,
            })
        }
        DaemonResponse::Error { id, error } => {
            if id != request_id {
                return Err(format!("IPC 响应 id 不匹配: 期望 {request_id}, 收到 {id}"));
            }
            Ok(IpcResponse {
                id,
                ok: false,
                path: None,
                data: None,
                ms: 0,
                error: Some(format!("[{}] {}", error.code, error.message)),
            })
        }
        DaemonResponse::Pong { id } | DaemonResponse::Bye { id } => Ok(IpcResponse {
            id,
            ok: true,
            path: None,
            data: None,
            ms: 0,
            error: None,
        }),
    }
}

#[cfg(windows)]
fn exchange_once(request_id: u64, request_json: &str) -> Result<IpcResponse, String> {
    let mut guard = SESSION.lock().map_err(|e| format!("IPC 锁失败: {e}"))?;
    if guard.is_none() {
        *guard = Some(open_pipe(PIPE_NAME)?);
    }
    let file = guard.as_mut().ok_or_else(|| "IPC 会话丢失".to_string())?;

    let result = (|| -> Result<IpcResponse, String> {
        file.write_all(request_json.as_bytes())
            .map_err(|e| e.to_string())?;
        file.write_all(b"\n").map_err(|e| e.to_string())?;
        file.flush().map_err(|e| e.to_string())?;

        let mut reader = BufReader::new(&*file);
        let mut line = String::new();
        reader.read_line(&mut line).map_err(|e| e.to_string())?;
        if line.is_empty() {
            return Err("IPC 响应为空（连接可能已关闭）".to_string());
        }
        parse_daemon_response(line.trim(), request_id)
    })();

    if result.is_err() {
        *guard = None;
    }
    result
}

#[cfg(windows)]
const PIPE_BUSY_WAIT_MS: u32 = 60_000;

#[cfg(windows)]
const PIPE_OPEN_RETRIES: u32 = 32;

/// 串行化新建管道连接，避免 initialize 并发 `CreateFile` 撞满实例。
#[cfg(windows)]
static PIPE_CONNECT_LOCK: Mutex<()> = Mutex::new(());

#[cfg(windows)]
fn open_pipe(pipe_name: &str) -> Result<File, String> {
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::FromRawHandle;
    use std::thread;
    use std::time::Duration;

    use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_PIPE_BUSY};
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_GENERIC_READ, FILE_GENERIC_WRITE, FILE_SHARE_NONE,
        OPEN_EXISTING,
    };
    use windows::Win32::System::Pipes::WaitNamedPipeW;
    use windows::core::{HRESULT, PCWSTR};

    let _guard = PIPE_CONNECT_LOCK
        .lock()
        .map_err(|e| format!("Named Pipe 连接锁失败: {e}"))?;

    let wide: Vec<u16> = OsStr::new(pipe_name)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let name = PCWSTR(wide.as_ptr());

    // CreateFile 失败时 windows crate 给的是 HRESULT（如 0x800700E7），
    // 不能与 WIN32_ERROR 裸值（231）直接比——否则 PIPE_BUSY 永远不重试。
    let busy = HRESULT::from_win32(ERROR_PIPE_BUSY.0);
    let not_found = HRESULT::from_win32(ERROR_FILE_NOT_FOUND.0);

    for attempt in 0..PIPE_OPEN_RETRIES {
        let handle = unsafe {
            CreateFileW(
                name,
                (FILE_GENERIC_READ | FILE_GENERIC_WRITE).0,
                FILE_SHARE_NONE,
                None,
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                None,
            )
        };
        match handle {
            Ok(h) => {
                let file = unsafe { File::from_raw_handle(h.0 as _) };
                return Ok(file);
            }
            Err(err) => {
                let code = err.code();
                if code == busy {
                    let waited = unsafe { WaitNamedPipeW(name, PIPE_BUSY_WAIT_MS) };
                    if !waited.as_bool() {
                        thread::sleep(Duration::from_millis(20 * (attempt as u64 + 1)));
                    }
                    continue;
                }
                if code == not_found && attempt + 1 < PIPE_OPEN_RETRIES {
                    thread::sleep(Duration::from_millis(50 * (attempt as u64 + 1)));
                    continue;
                }
                return Err(format!("打开 Named Pipe 失败: {err}"));
            }
        }
    }
    Err("打开 Named Pipe 超时（PIPE_BUSY）".into())
}
