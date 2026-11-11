//! 子 agent 工具面（S10）：`app_agent_spawn` / `app_agent_wait` / `app_agent_result`。
//!
//! 这里只做**调度与限流**：登记、排队、`maxConcurrent=2`、深度 ≤ 2、摘要 ≤ 2KB。
//! 真正跑一轮的是渲染进程（ACP 连接在那边），所以 `spawn` 只登记 + 由 app 侧
//! emit 事件把活派出去，Rust 不替模型编造结果 —— 没有渲染进程跑，就一直是
//! `queued`，`wait` 超时如实返回 `queued`，而不是伪造一个「已完成」。
//!
//! 三条边界：
//! - **不提权**：子任务用父会话的 provider / model / workspace，模型改不了；
//!   子任务的工具审批一律拒绝（渲染侧 `subagent.ts`），它拿不到比父会话更大的面。
//! - **深度 ≤ 2**：深度由 Rust 按「父会话 id」自己算（`depth_by_session`），
//!   模型传什么 `depth` 都不作数；子会话再 spawn 就是深度 2，再下一层直接拒绝。
//! - **摘要有上限**：`settle` 一律截到 2KB（按 UTF-8 字符边界，不切半个汉字）。
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::{Effect, ToolSpec};

pub const SPAWN: &str = "app_agent_spawn";
pub const WAIT: &str = "app_agent_wait";
pub const RESULT: &str = "app_agent_result";

const NAMES: [&str; 3] = [SPAWN, WAIT, RESULT];

/// 同时最多几个子任务（含排队中）。
pub const MAX_CONCURRENT: usize = 2;
/// 允许的最大深度：父会话里 spawn 出来的是 1，子任务里再 spawn 是 2，再到头。
pub const MAX_DEPTH: i64 = 2;
/// 摘要上限（字节）。超了截断并加省略号。
pub const SUMMARY_LIMIT: usize = 2048;
/// `wait` 默认等多久：太短会让模型以为失败，太长会卡住它自己的回合。
pub const DEFAULT_WAIT_MS: u64 = 30_000;
pub const MAX_WAIT_MS: u64 = 120_000;
/// 任务里保留的 prompt 预览长度（完整 prompt 已经派给渲染进程，board 不留全文）。
const PROMPT_PREVIEW: usize = 120;

/// 任务状态。`Queued` 表示已登记、还没人接手跑。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Queued,
    Running,
    Done,
    Failed,
    Cancelled,
}

impl Status {
    fn is_active(self) -> bool {
        matches!(self, Status::Queued | Status::Running)
    }
}

/// 一次 spawn 的入参（由桥从工具参数 + 会话头拼出来）。
#[derive(Debug, Clone)]
pub struct SpawnRequest {
    pub prompt: String,
    pub cwd: Option<String>,
    pub title: Option<String>,
    /// 发起方会话 id（桥从 `x-cogito-session` 拿）；没有则按顶层会话算深度 1
    pub parent_session: Option<String>,
}

/// 任务视图：给 `wait` / `result` 与前端事件用。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub status: Status,
    pub depth: i64,
    pub title: String,
    pub prompt_preview: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_session: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 渲染进程回填的结果。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub job_id: String,
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    /// 子会话 id：登记后，这个会话再 spawn 就是深度 +1
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub cancelled: bool,
}

#[derive(Default)]
struct Inner {
    jobs: HashMap<String, Job>,
    /// 登记顺序（列表稳定，不靠 HashMap 的随机序）
    order: Vec<String>,
    /// 子会话 id → 深度
    depth_by_session: HashMap<String, i64>,
}

/// 进程内的任务板。跨请求共享，故用全局单例。
#[derive(Default)]
pub struct Board {
    inner: Mutex<Inner>,
}

fn board() -> &'static Board {
    static BOARD: OnceLock<Board> = OnceLock::new();
    BOARD.get_or_init(Board::default)
}

/// 全局任务板（桥与命令共用同一份）。
pub fn shared() -> &'static Board {
    board()
}

fn lock(board: &Board) -> MutexGuard<'_, Inner> {
    // 毒化的锁不该让整块工具面瘫掉：清掉脏状态继续用（board 里没有跨字段不变量）
    match board.inner.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// 按 UTF-8 字符边界截断，超限时补 `…`。
#[must_use]
pub fn truncate_summary(text: &str, limit: usize) -> String {
    const ELLIPSIS: char = '…';
    if limit < ELLIPSIS.len_utf8() {
        return String::new();
    }
    if text.len() <= limit {
        return text.to_string();
    }
    // 省略号自己也要占预算，否则「2KB 上限」会被它顶破 2 个字节
    let budget = limit - ELLIPSIS.len_utf8();
    let mut out = String::new();
    for ch in text.chars() {
        if out.len() + ch.len_utf8() > budget {
            break;
        }
        out.push(ch);
    }
    out.push(ELLIPSIS);
    out
}

fn preview(prompt: &str) -> String {
    truncate_summary(prompt.trim(), PROMPT_PREVIEW)
}

impl Board {
    /// 登记一个子任务。返回任务视图。
    ///
    /// 失败是**可判定**的：并发满 / 深度超限 / prompt 为空，都给一句能照做的说明。
    pub fn spawn(&self, request: SpawnRequest) -> Result<Job, String> {
        let prompt = request.prompt.trim();
        if prompt.is_empty() {
            return Err("spawn: prompt 不能为空".to_string());
        }
        let mut inner = lock(self);
        let parent_depth = request
            .parent_session
            .as_deref()
            .and_then(|session| inner.depth_by_session.get(session).copied())
            .unwrap_or(0);
        let depth = parent_depth + 1;
        if depth > MAX_DEPTH {
            return Err(format!(
                "spawn: 子任务最多 {MAX_DEPTH} 层（当前已在第 {parent_depth} 层），这一层不能再开子任务；请自己继续做"
            ));
        }
        let active = inner
            .jobs
            .values()
            .filter(|job| job.status.is_active())
            .count();
        if active >= MAX_CONCURRENT {
            return Err(format!(
                "spawn: 已有 {active} 个子任务在跑（上限 {MAX_CONCURRENT}），先 wait 一个或自己继续"
            ));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let timestamp = now_ms();
        let title = request
            .title
            .map(|title| title.trim().to_string())
            .filter(|title| !title.is_empty())
            .unwrap_or_else(|| preview(prompt));
        let job = Job {
            id: id.clone(),
            status: Status::Queued,
            depth,
            title,
            prompt_preview: preview(prompt),
            cwd: request.cwd,
            parent_session: request.parent_session,
            session_id: None,
            summary: None,
            error: None,
            created_at: timestamp,
            updated_at: timestamp,
        };
        inner.order.push(id.clone());
        inner.jobs.insert(id, job.clone());
        Ok(job)
    }

    /// 渲染进程回填结果。幂等：已经收尾的任务再报一次只返回现状，不覆盖终态。
    pub fn settle(&self, report: Report) -> Result<Job, String> {
        let mut inner = lock(self);
        let Some(job) = inner.jobs.get(&report.job_id) else {
            return Err(format!("未知子任务：{}", report.job_id));
        };
        if !job.status.is_active() {
            return Ok(job.clone());
        }
        let timestamp = now_ms();
        let status = if report.cancelled {
            Status::Cancelled
        } else if report.ok {
            Status::Done
        } else {
            Status::Failed
        };
        let summary = report
            .summary
            .map(|summary| truncate_summary(summary.trim(), SUMMARY_LIMIT))
            .filter(|summary| !summary.is_empty());
        let error = report
            .error
            .map(|error| truncate_summary(error.trim(), SUMMARY_LIMIT))
            .filter(|error| !error.is_empty());
        let session_id = report.session_id.clone();
        let depth = job.depth;
        let updated = if let Some(job) = inner.jobs.get_mut(&report.job_id) {
            job.status = status;
            job.summary = summary;
            job.error = error;
            job.session_id = session_id;
            job.updated_at = timestamp;
            job.clone()
        } else {
            return Err(format!("未知子任务：{}", report.job_id));
        };
        // 子会话登记深度：它之后再 spawn 就是 depth + 1。
        // 失败的任务也登记 —— 它可能已经开过下一层。
        if let Some(session) = updated.session_id.as_deref() {
            inner.depth_by_session.insert(session.to_string(), depth);
        }
        Ok(updated)
    }

    /// 读一个任务的现状。
    pub fn view(&self, job_id: &str) -> Result<Job, String> {
        let inner = lock(self);
        inner
            .jobs
            .get(job_id)
            .cloned()
            .ok_or_else(|| format!("未知子任务：{job_id}"))
    }

    /// 全部任务，按登记顺序（诊断与测试用）。
    pub fn list(&self) -> Vec<Job> {
        let inner = lock(self);
        inner
            .order
            .iter()
            .filter_map(|id| inner.jobs.get(id).cloned())
            .collect()
    }

    /// 只测试用：清空。
    pub fn reset(&self) {
        let mut inner = lock(self);
        inner.jobs.clear();
        inner.order.clear();
        inner.depth_by_session.clear();
    }
}

#[must_use]
pub fn owns(name: &str) -> bool {
    NAMES.contains(&name)
}

#[must_use]
pub fn specs() -> Vec<ToolSpec> {
    vec![
        super::describe_with_risk(
            SPAWN,
            "开一个子任务（并行会话）去干一件独立的事，立刻返回 jobID，不阻塞你当前回合。子任务用同一个 provider / model / workspace，工具审批一律拒绝（不需要人盯着）；最多同时 2 个、最多 2 层。干完用 app_agent_wait 等结果、app_agent_result 取摘要。",
            Effect::Write,
            super::Risk::Write,
            json!({
                "type": "object",
                "properties": {
                    "prompt": {
                        "type": "string",
                        "description": "交给子任务的完整指令：它看不到你的对话，把背景、要做什么、怎么算完成写清楚"
                    },
                    "cwd": {
                        "type": "string",
                        "description": "子任务的工作目录；省略则用当前会话的工作目录"
                    },
                    "title": {
                        "type": "string",
                        "description": "会话标题（左栏可见），省略则取 prompt 开头"
                    }
                },
                "required": ["prompt"]
            }),
        ),
        super::describe(
            WAIT,
            "等一个子任务收尾（默认最多 30 秒，最多 120 秒）。返回 status 与摘要；超时返回当前状态（可能仍是 running），不会伪造完成。",
            Effect::Read,
            json!({
                "type": "object",
                "properties": {
                    "jobID": { "type": "string", "description": "app_agent_spawn 返回的 jobID" },
                    "timeoutMs": {
                        "type": "integer",
                        "description": "最多等多少毫秒（默认 30000，上限 120000）"
                    }
                },
                "required": ["jobID"]
            }),
        ),
        super::describe(
            RESULT,
            "取子任务的最终结果（摘要已截到 2KB）。任务还没收尾时返回 status，不会阻塞。",
            Effect::Read,
            json!({
                "type": "object",
                "properties": {
                    "jobID": { "type": "string", "description": "app_agent_spawn 返回的 jobID" }
                },
                "required": ["jobID"]
            }),
        ),
    ]
}

/// 把工具参数解析成 SpawnRequest（桥侧用；参数非法给可读错误）。
pub fn spawn_request(
    arguments: &Value,
    parent_session: Option<&str>,
) -> Result<SpawnRequest, String> {
    let prompt = arguments
        .get("prompt")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
        .ok_or_else(|| "spawn: 缺少 prompt".to_string())?;
    let cwd = arguments
        .get("cwd")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|cwd| !cwd.is_empty())
        .map(str::to_string);
    let title = arguments
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(str::to_string);
    Ok(SpawnRequest {
        prompt: prompt.to_string(),
        cwd,
        title,
        parent_session: parent_session.map(str::to_string),
    })
}

/// `wait` 的超时钳制：没传用默认，太离谱按上限。
#[must_use]
pub fn clamp_wait_ms(value: Option<u64>) -> u64 {
    value.unwrap_or(DEFAULT_WAIT_MS).clamp(50, MAX_WAIT_MS)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> Board {
        // 每个用例一块独立的任务板：全局单例在 `shared_is_process_wide` 里单独验，
        // 用例之间不共享状态，也就不需要串行执行。
        Board::default()
    }

    fn request(prompt: &str, parent: Option<&str>) -> SpawnRequest {
        SpawnRequest {
            prompt: prompt.to_string(),
            cwd: None,
            title: None,
            parent_session: parent.map(str::to_string),
        }
    }

    #[test]
    fn spawn_assigns_depth_and_previews_prompt() {
        let board = fresh();
        let job = board
            .spawn(request("  把 README 更新一遍  ", None))
            .expect("spawn");
        assert_eq!(job.depth, 1, "顶层会话开出来的子任务是第 1 层");
        assert_eq!(job.status, Status::Queued);
        assert_eq!(job.prompt_preview, "把 README 更新一遍");
        assert_eq!(board.list().len(), 1);
    }

    #[test]
    fn spawn_rejects_empty_prompt() {
        let board = fresh();
        assert!(board.spawn(request("   ", None)).is_err());
    }

    #[test]
    fn concurrency_is_capped_at_two() {
        let board = fresh();
        board.spawn(request("a", None)).expect("第一个");
        board.spawn(request("b", None)).expect("第二个");
        let error = board.spawn(request("c", None)).expect_err("第三个必须被拒");
        assert!(error.contains("上限 2"), "{error}");
        // 收尾一个就能再开
        let first = board.list()[0].id.clone();
        board
            .settle(Report {
                job_id: first,
                ok: true,
                summary: Some("done".to_string()),
                error: None,
                session_id: Some("child-1".to_string()),
                cancelled: false,
            })
            .expect("settle");
        board.spawn(request("c", None)).expect("腾出槽位后可以再开");
    }

    #[test]
    fn depth_is_tracked_by_session_not_by_argument() {
        let board = fresh();
        let root = board.spawn(request("根任务", None)).expect("depth 1");
        board
            .settle(Report {
                job_id: root.id,
                ok: true,
                summary: Some("ok".to_string()),
                error: None,
                session_id: Some("child-a".to_string()),
                cancelled: false,
            })
            .expect("settle");
        // 子会话再开：深度 2
        let nested = board
            .spawn(request("孙任务", Some("child-a")))
            .expect("depth 2 允许");
        assert_eq!(nested.depth, 2);
        board
            .settle(Report {
                job_id: nested.id,
                ok: true,
                summary: Some("ok".to_string()),
                error: None,
                session_id: Some("child-b".to_string()),
                cancelled: false,
            })
            .expect("settle");
        // 第三层：拒绝
        let error = board
            .spawn(request("曾孙任务", Some("child-b")))
            .expect_err("深度 3 必须被拒");
        assert!(error.contains("最多 2 层"), "{error}");
    }

    #[test]
    fn settle_truncates_summary_on_char_boundary() {
        let board = fresh();
        let job = board.spawn(request("任务", None)).expect("spawn");
        let long = "汉".repeat(SUMMARY_LIMIT);
        let settled = board
            .settle(Report {
                job_id: job.id,
                ok: true,
                summary: Some(long),
                error: None,
                session_id: None,
                cancelled: false,
            })
            .expect("settle");
        let summary = settled.summary.expect("有摘要");
        assert!(summary.len() <= SUMMARY_LIMIT, "摘要超过 2KB");
        assert!(summary.ends_with('…'));
        // 每个字符都是完整汉字：能重新解析回 UTF-8
        assert!(summary.is_char_boundary(summary.len()));
    }

    #[test]
    fn settle_is_idempotent_and_keeps_terminal_state() {
        let board = fresh();
        let job = board.spawn(request("任务", None)).expect("spawn");
        let report = Report {
            job_id: job.id.clone(),
            ok: true,
            summary: Some("第一次".to_string()),
            error: None,
            session_id: Some("child-x".to_string()),
            cancelled: false,
        };
        let first = board.settle(report.clone()).expect("settle");
        assert_eq!(first.status, Status::Done);
        let second = board
            .settle(Report {
                summary: Some("第二次".to_string()),
                ok: false,
                ..report
            })
            .expect("settle 幂等");
        assert_eq!(second.status, Status::Done, "终态不被覆盖");
        assert_eq!(second.summary.as_deref(), Some("第一次"));
    }

    #[test]
    fn cancelled_report_marks_job_cancelled() {
        let board = fresh();
        let job = board.spawn(request("任务", None)).expect("spawn");
        let settled = board
            .settle(Report {
                job_id: job.id,
                ok: false,
                summary: None,
                error: None,
                session_id: None,
                cancelled: true,
            })
            .expect("settle");
        assert_eq!(settled.status, Status::Cancelled);
    }

    #[test]
    fn unknown_job_is_rejected() {
        let board = fresh();
        assert!(board.view("nope").is_err());
        assert!(
            board
                .settle(Report {
                    job_id: "nope".to_string(),
                    ok: true,
                    summary: None,
                    error: None,
                    session_id: None,
                    cancelled: false,
                })
                .is_err()
        );
    }

    #[test]
    fn wait_timeout_is_clamped() {
        assert_eq!(clamp_wait_ms(None), DEFAULT_WAIT_MS);
        assert_eq!(clamp_wait_ms(Some(1)), 50);
        assert_eq!(clamp_wait_ms(Some(u64::MAX)), MAX_WAIT_MS);
    }

    #[test]
    fn specs_are_object_schemas_with_required_fields() {
        let specs = specs();
        assert_eq!(specs.len(), 3);
        for spec in &specs {
            assert_eq!(spec.input_schema["type"], "object", "{}", spec.name);
        }
        let spawn = &specs[0];
        assert_eq!(spawn.effect, Effect::Write, "spawn 有副作用");
        assert_eq!(spawn.input_schema["required"][0], "prompt");
        let wait = &specs[1];
        assert_eq!(wait.input_schema["required"][0], "jobID");
        assert!(specs[2].input_schema["properties"].get("jobID").is_some());
    }
}
