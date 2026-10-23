//! 台账收尾通道：把**编排的终态**落到 `rag_index_task` 上。
//!
//! 三条触发路径共用这里（起实例失败、等待者轮询到终态、GET 的读时修复）。收尾必须是
//! 幂等的——同一份终态可能被多个写者同时发现，[`rag::persistence::finish`] 的锁与
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
use crate::orchestrations::rag::IndexAssetOutput;
use crate::services::rag::error::RagError;

/// 等待者两次轮询之间的最短间隔。
const WAIT_MIN_INTERVAL: Duration = Duration::from_secs(1);

/// 等待者两次轮询之间的最长间隔。上限存在的意义只是别把轮询打得太密，
/// 一次嵌入批次的耗时通常远大于它。
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
/// 开作用域、写回或提交失败时返回 [`RagError`]。
pub async fn settle(
    storage: &Storage,
    task_id: Uuid,
    tenant_id: TenantId,
    outcome: &rag::IndexOutcome,
) -> Result<Option<entity::rag_index_task::Model>, RagError> {
    let scope = TenantScope::open(storage, tenant_id)
        .await
        .map_err(|err| RagError::Database(err.to_string()))?;

    // 写回与回读必须在同一事务里：分开读的可能是 `finish` 落地前的旧值。
    rag::persistence::finish(scope.tx(), task_id, outcome).await?;
    let row = rag::persistence::find(scope.tx(), task_id).await?;

    scope
        .commit()
        .await
        .map_err(|err| RagError::Database(err.to_string()))?;

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
    row: entity::rag_index_task::Model,
) {
    let tenant_id = TenantId::from_uuid(row.tenant_id);
    let task_id = row.id;
    let instance_id = row.instance_id.clone();

    actix_web::rt::spawn(async move {
        let deadline = Instant::now() + WAIT_BUDGET;
        let mut interval = WAIT_MIN_INTERVAL;

        loop {
            match client.status(&instance_id).await {
                Ok(status) => {
                    if status.is_terminal() {
                        let outcome = outcome_of(status);
                        if let Err(err) = settle(&storage, task_id, tenant_id, &outcome).await {
                            tracing::error!(
                                error = %err, task = %task_id,
                                "rag 索引异步收尾失败：交由读时修复"
                            );
                        }
                        return;
                    }
                }
                Err(err) => {
                    tracing::warn!(
                        error = %err, task = %task_id,
                        "rag 索引状态查询失败，停止等待：交由读时修复"
                    );
                    return;
                }
            }

            if Instant::now() >= deadline {
                tracing::warn!(task = %task_id, "rag 索引等待者预算耗尽：交由读时修复");
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
pub fn outcome_of(status: InstanceStatus) -> rag::IndexOutcome {
    match status {
        InstanceStatus::Completed { output } => {
            match serde_json::from_str::<IndexAssetOutput>(&output) {
                Ok(indexed) => rag::IndexOutcome {
                    state: rag::IndexState::Succeeded,
                    result: serde_json::to_value(&indexed).ok(),
                    error: None,
                },
                Err(err) => {
                    // 编排跑完了但产出读不出来：仍然要有终态，否则这行永远是 RUNNING，
                    // 读时修复也救不了它（实例已是终态，不会再变）。
                    tracing::error!(error = %err, output = %output, "rag 索引编排产出无法解析");
                    rag::IndexOutcome::failed(format!("编排产出无法解析：{err}"))
                }
            }
        }
        InstanceStatus::Failed { category, message } => {
            rag::IndexOutcome::failed(failure_reason(&category, &message))
        }
        other => {
            rag::IndexOutcome::failed(format!("编排实例未处于终态却要求收尾（{}）", other.label()))
        }
    }
}

/// 编排自报的进度原文（`chunked:n` / `embedded:to` / `indexed`）。
///
/// **不解析、不翻译**：这一串是编排写给运维看的，中间层替它「美化」成步数只会多一个
/// 会过期的解释（批数随资产大小变）。空串当下线处理，免得出参里出现一个没含义的 `""`。
pub fn progress_of(status: &InstanceStatus) -> Option<String> {
    match status {
        InstanceStatus::Running { custom_status } => custom_status
            .as_deref()
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_owned),
        _ => None,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn output() -> String {
        serde_json::to_string(&IndexAssetOutput {
            asset_id: "0b0e1e1e-1c1c-4c4c-8c8c-1c1c1c1c1c1c".into(),
            chunk_set_id: "set-1".into(),
            chunk_count: 48,
            batches: 3,
            dimensions: 1024,
            indexed: 48,
            collection: "rag_1024".into(),
        })
        .expect("序列化失败")
    }

    #[test]
    fn completed_output_becomes_a_succeeded_ledger_row() {
        let outcome = outcome_of(InstanceStatus::Completed { output: output() });

        assert_eq!(outcome.state, rag::IndexState::Succeeded);
        assert!(outcome.error.is_none());
        let result = outcome.result.expect("成功必须有快照");
        assert_eq!(result["chunkSetID"], serde_json::json!("set-1"));
        assert_eq!(result["chunkCount"], serde_json::json!(48));
    }

    #[test]
    fn unparsable_output_still_reaches_a_terminal_state() {
        let outcome = outcome_of(InstanceStatus::Completed {
            output: "{ not json".into(),
        });

        assert_eq!(outcome.state, rag::IndexState::Failed);
        assert!(
            outcome.error.expect("要留原因").contains("无法解析"),
            "失败原因要指向产出本身"
        );
    }

    #[test]
    fn failure_categories_are_translated_for_operators() {
        let outcome = outcome_of(InstanceStatus::Failed {
            category: "application".into(),
            message: "下游 500".into(),
        });
        assert_eq!(outcome.state, rag::IndexState::Failed);
        assert_eq!(
            outcome.error.as_deref(),
            Some("业务逻辑失败（重试已耗尽）：下游 500")
        );
    }

    #[test]
    fn unknown_failure_category_is_passed_through_not_invented() {
        let outcome = outcome_of(InstanceStatus::Failed {
            category: "unknown-case".into(),
            message: String::new(),
        });
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
            let outcome = outcome_of(status);
            assert_eq!(outcome.state, rag::IndexState::Failed);
            assert!(outcome.result.is_none());
        }
    }

    #[test]
    fn progress_is_passed_through_verbatim() {
        let status = InstanceStatus::Running {
            custom_status: Some("embedded:32".into()),
        };
        assert_eq!(progress_of(&status).as_deref(), Some("embedded:32"));

        let blank = InstanceStatus::Running {
            custom_status: Some("  ".into()),
        };
        assert_eq!(progress_of(&blank), None, "空串等于没报");

        assert_eq!(progress_of(&InstanceStatus::NotFound), None);
    }
}
