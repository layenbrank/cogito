//! 台账收尾通道：把**编排的终态**落到 `agent_task` 上。
//!
//! 三条触发路径共用这里（起实例失败、等待者轮询到终态、GET 的读时修复）。收尾必须是
//! 幂等的——同一份终态可能被多个写者同时发现，[`agent::persistence::finish`] 的锁与
//! 「已是终态即无操作」规则负责收敛。
//!
//! 为什么不复用请求里的 `TenantCtx`：等待者是后台任务，它跑起来的时候请求早已返回、
//! 作用域早已释放；读时修复那条路径则必须先释放读事务再发外部调用。两条路径都需要一个
//! 「短命、独立」的租户作用域。
//!
//! RLS 是唯一的租户边界，所以这里不写 `"tenantID" = ?`：连接级 `app.tenant_id` 已经
//! 把可见范围钉死了，再加条件等于给自己一个「忘了加就泄露」的机会。

use std::time::{Duration, Instant};

use durable::{Client, InstanceStatus};
use identity::TenantId;
use uuid::Uuid;

use crate::databases::database::Storage;
use crate::guards::tenant::TenantScope;
use crate::orchestrations::agent::{AgentRunOutput, steps_from_progress};
use crate::services::agent::error::AgentError;

/// 等待者两次轮询之间的最短间隔。
const WAIT_MIN_INTERVAL: Duration = Duration::from_secs(1);

/// 等待者两次轮询之间的最长间隔。上限存在的意义只是别把轮询打得太密，
/// 一步 agent 的耗时通常远大于它。
const WAIT_MAX_INTERVAL: Duration = Duration::from_secs(15);

/// 等待者的总预算。用完就交给读时修复——等待者只是「让结果早一点落库」的优化，
/// 不是正确性的依赖。
const WAIT_BUDGET: Duration = Duration::from_secs(3600);

/// 落终态，返回**写完之后**的那一行；行不存在时返回 `None`。
///
/// 返回写后状态而不是「有没有写成」，是因为收尾可能由多个写者同时触发：抢先落地的那一个
/// 才是权威。调用方要渲染就得看库里的值，不能拿自己算的那份去覆盖显示。
///
/// # Errors
/// 开作用域、写回或提交失败时返回 [`AgentError`]。
pub async fn settle(
    storage: &Storage,
    task_id: Uuid,
    tenant_id: TenantId,
    outcome: &agent::TaskOutcome,
) -> Result<Option<entity::agent_task::Model>, AgentError> {
    let scope = TenantScope::open(storage, tenant_id)
        .await
        .map_err(|err| AgentError::Database(err.to_string()))?;

    // 写回与回读必须在同一事务里：分开读的可能是 `finish` 落地前的旧值。
    agent::persistence::finish(scope.tx(), task_id, outcome).await?;
    let row = agent::persistence::find(scope.tx(), task_id).await?;

    scope
        .commit()
        .await
        .map_err(|err| AgentError::Database(err.to_string()))?;

    Ok(row)
}

/// 起一个后台等待者：轮询实例状态，跑到终态就落台账。
///
/// 起这个任务只是因为「让结果早一点可见」；就算它超时、报错、进程被杀，GET 的读时修复
/// 仍会把行收敛到终态（见 `service.rs`）。所以这里失败一律只记日志，不写任何「失败」状态——
/// 把一次查询失败写成任务失败，是把运维抖动变成了业务事实。
///
/// 刻意不用 [`durable::Client::wait`]：实例处于 `NotFound`（还没被运行时领走）时它会立刻
/// 返回，转成热循环；这里的退避轮询对「刚起、还没领走」这个窗口是安全的。
pub fn spawn_waiter(
    storage: Storage,
    client: std::sync::Arc<Client>,
    row: entity::agent_task::Model,
) {
    let tenant_id = TenantId::from_uuid(row.tenant_id);
    let task_id = row.id;
    let instance_id = row.instance_id.clone();
    let mut steps = row.steps;

    actix_web::rt::spawn(async move {
        let deadline = Instant::now() + WAIT_BUDGET;
        let mut interval = WAIT_MIN_INTERVAL;

        loop {
            match client.status(&instance_id).await {
                Ok(status) => {
                    if let Some(reported) = reported_steps(&status) {
                        steps = reported;
                    }
                    if status.is_terminal() {
                        let outcome = outcome_of(status, steps);
                        if let Err(err) = settle(&storage, task_id, tenant_id, &outcome).await {
                            tracing::error!(
                                error = %err, task = %task_id,
                                "agent 异步收尾失败：交由读时修复"
                            );
                        }
                        return;
                    }
                }
                Err(err) => {
                    tracing::warn!(
                        error = %err, task = %task_id,
                        "agent 状态查询失败，停止等待：交由读时修复"
                    );
                    return;
                }
            }

            if Instant::now() >= deadline {
                tracing::warn!(task = %task_id, "agent 等待者预算耗尽：交由读时修复");
                return;
            }

            tokio::time::sleep(interval).await;
            interval = (interval * 2).min(WAIT_MAX_INTERVAL);
        }
    });
}

/// 编排状态 → 台账终态。
///
/// 只对终态有意义；`Running` / `NotFound` 传进来是调用方的逻辑错误，返回一个失败终态而不是
/// panic：一个不该出现的状态不该让整个进程倒掉，但它也绝不能被当成「成功」写进台账。
pub fn outcome_of(status: InstanceStatus, steps: i32) -> agent::TaskOutcome {
    match status {
        InstanceStatus::Completed { output } => {
            match serde_json::from_str::<AgentRunOutput>(&output) {
                Ok(run) => agent::TaskOutcome {
                    state: agent::TaskState::Succeeded,
                    steps: run.steps.max(steps),
                    result: serde_json::to_value(&run).ok(),
                    error: None,
                },
                Err(err) => {
                    // 编排跑完了但产出读不出来：仍然要有终态，否则这行永远是 RUNNING，
                    // 读时修复也救不了它（实例已是终态，不会再变）。
                    tracing::error!(error = %err, output = %output, "agent 编排产出无法解析");
                    agent::TaskOutcome::failed(steps, format!("编排产出无法解析：{err}"))
                }
            }
        }
        InstanceStatus::Failed { category, message } => {
            agent::TaskOutcome::failed(steps, failure_reason(&category, &message))
        }
        other => agent::TaskOutcome::failed(
            steps,
            format!("编排实例未处于终态却要求收尾（{}）", other.label()),
        ),
    }
}

/// 编排失败分类 → 运维能直接读懂的中文。
///
/// 分类是框架给的（见 `durable::InstanceStatus::Failed` 的文档），这里只做翻译，不做判断。
fn failure_reason(category: &str, message: &str) -> String {
    let label = match category {
        "infrastructure" => "环境故障",
        "configuration" => "编排配置错误",
        "application" => "业务逻辑失败（重试已耗尽）",
        "poison" => "活动反复毒化实例",
        other => other,
    };

    if message.is_empty() {
        label.to_owned()
    } else {
        format!("{label}：{message}")
    }
}

/// 从 custom status 里读回「走到第几轮」；读不出来给 `None`（不编造轮次）。
fn reported_steps(status: &InstanceStatus) -> Option<i32> {
    match status {
        InstanceStatus::Running { custom_status } => {
            custom_status.as_deref().and_then(steps_from_progress)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::orchestrations::agent::{ApprovalRecord, ApprovalState};

    fn output(steps: i32, finished: bool) -> String {
        serde_json::to_string(&AgentRunOutput {
            task_id: "t-1".into(),
            steps,
            finished,
            answer: Some("答案".into()),
            tool_calls: 2,
            memory_id: Some("0b0e1e1e-1c1c-4c4c-8c8c-1c1c1c1c1c1c".into()),
            approvals: vec![],
        })
        .expect("序列化失败")
    }

    #[test]
    fn completed_output_becomes_a_succeeded_ledger_row() {
        let outcome = outcome_of(
            InstanceStatus::Completed {
                output: output(3, true),
            },
            1,
        );

        assert_eq!(outcome.state, agent::TaskState::Succeeded);
        assert_eq!(outcome.steps, 3, "编排报的轮次比台账更新");
        assert!(outcome.error.is_none());
        let result = outcome.result.expect("成功必须有快照");
        assert_eq!(result["finished"], serde_json::json!(true));
        assert_eq!(result["toolCalls"], serde_json::json!(2));
    }

    #[test]
    fn ledger_steps_win_when_the_orchestration_reports_fewer() {
        // 进度里的轮次可能比输出里的新（最后一步还没写进输出）；取大的那个，
        // 免得台账出现「轮次回退」。
        let outcome = outcome_of(
            InstanceStatus::Completed {
                output: output(2, false),
            },
            5,
        );
        assert_eq!(outcome.steps, 5);
    }

    #[test]
    fn unparsable_output_still_reaches_a_terminal_state() {
        let outcome = outcome_of(
            InstanceStatus::Completed {
                output: "{ not json".into(),
            },
            4,
        );

        assert_eq!(outcome.state, agent::TaskState::Failed);
        assert_eq!(outcome.steps, 4);
        assert!(
            outcome.error.expect("要留原因").contains("无法解析"),
            "失败原因要指向产出本身"
        );
    }

    #[test]
    fn approvals_reach_the_snapshot_with_their_verdict() {
        // 「超时」不是人做的决定，它只活在快照里；台账里不会有这一行。
        let output = serde_json::to_string(&AgentRunOutput {
            task_id: "t-1".into(),
            steps: 1,
            finished: true,
            answer: None,
            tool_calls: 1,
            memory_id: None,
            approvals: vec![ApprovalRecord {
                approval_id: "t-1:0:0".into(),
                step: 0,
                tool: "asset_write".into(),
                decision: ApprovalState::Expired,
                reason: None,
            }],
        })
        .expect("序列化失败");

        let outcome = outcome_of(InstanceStatus::Completed { output }, 1);
        let result = outcome.result.expect("成功必须有快照");
        assert_eq!(
            result["approvals"][0]["decision"],
            serde_json::json!("EXPIRED")
        );
        assert_eq!(result["approvals"][0]["approvalID"], "t-1:0:0");
    }

    #[test]
    fn failure_categories_are_translated_for_operators() {
        let outcome = outcome_of(
            InstanceStatus::Failed {
                category: "application".into(),
                message: "下游 500".into(),
            },
            2,
        );
        assert_eq!(outcome.state, agent::TaskState::Failed);
        assert_eq!(
            outcome.error.as_deref(),
            Some("业务逻辑失败（重试已耗尽）：下游 500")
        );
    }

    #[test]
    fn unknown_failure_category_is_passed_through_not_invented() {
        let outcome = outcome_of(
            InstanceStatus::Failed {
                category: "unknown-case".into(),
                message: String::new(),
            },
            0,
        );
        assert_eq!(outcome.error.as_deref(), Some("unknown-case"));
    }

    #[test]
    fn non_terminal_statuses_never_become_success() {
        for status in [
            InstanceStatus::Running {
                custom_status: None,
            },
            InstanceStatus::NotFound,
        ] {
            let outcome = outcome_of(status, 1);
            assert_eq!(outcome.state, agent::TaskState::Failed);
            assert!(outcome.result.is_none());
        }
    }

    #[test]
    fn progress_is_read_back_from_custom_status() {
        let status = InstanceStatus::Running {
            custom_status: Some("step:2/6 tools:2".into()),
        };
        assert_eq!(reported_steps(&status), Some(2));

        let silent = InstanceStatus::Running {
            custom_status: Some("".into()),
        };
        assert_eq!(reported_steps(&silent), None);
        assert_eq!(reported_steps(&InstanceStatus::NotFound), None);
    }
}
