//! 台账读写：建行、读行、终态写回、审批决定。
//!
//! 几个函数都要求调用方**已经在正确的作用域里**（`agent_task` / `agent_approval` 都启用了
//! RLS），本模块不写 `"tenantID" = ?` 条件：租户判定只有一处（策略），两处判定必然有一天不一致。

use chrono::Utc;
use entity::{agent_approval, agent_task};
use sea_orm::{ActiveModelTrait, ConnectionTrait, EntityTrait, IntoActiveModel, QuerySelect, Set};
use serde_json::Value;
use uuid::Uuid;

use crate::{ApprovalState, Error, NewApproval, NewTask, TaskOutcome, TaskState};

/// 建行：`status = RUNNING`、轮次 0、无结果。
///
/// 先落台账再起编排实例：反过来的话，进程在「实例已起、台账未写」之间崩溃，会留下**看不见的工作**。
/// 现在的顺序最坏留下「有台账、无实例」，读时按行龄判定即可修成失败。
pub async fn create<C: ConnectionTrait>(
    conn: &C,
    task: &NewTask,
) -> Result<agent_task::Model, Error> {
    let now = Utc::now().fixed_offset();
    let model = agent_task::ActiveModel {
        id: Set(task.id),
        tenant_id: Set(task.tenant_id),
        user_id: Set(task.user_id),
        status: Set(TaskState::Running.as_str().to_owned()),
        objective: Set(task.objective.clone()),
        model: Set(task.model.clone()),
        max_steps: Set(task.max_steps),
        allowed_tools: Set(tools_to_json(&task.allowed_tools)),
        instance_id: Set(task.instance_id.clone()),
        steps: Set(0),
        result: Set(None),
        error: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    };

    Ok(model.insert(conn).await?)
}

/// 读行（读不到即 `None`：可能是别人的行，策略会隐藏它）。
pub async fn find<C: ConnectionTrait>(
    conn: &C,
    id: Uuid,
) -> Result<Option<agent_task::Model>, Error> {
    Ok(agent_task::Entity::find_by_id(id).one(conn).await?)
}

/// 终态写回；返回**本次是否真的写了**（`false` = 已是终态或行不存在，什么都没改）。
///
/// 必须在事务里调用：先 `SELECT ... FOR UPDATE` 锁住行、再判断是不是终态，
/// 于是「终态只写一次」是一条原子规则，而不是靠「谁先到」的时序假设——
/// 收尾可能由后台等待者、读时修复、甚至重试同时触发。
///
/// # Errors
/// `outcome.state` 不是终态时返回 [`Error::NotTerminal`]；状态列有无法识别的字面量时返回
/// [`Error::UnknownState`]（宁可报错也不要猜，坏行必须被看见）。
pub async fn finish<C: ConnectionTrait>(
    conn: &C,
    id: Uuid,
    outcome: &TaskOutcome,
) -> Result<bool, Error> {
    require_terminal(outcome.state)?;

    let Some(model) = agent_task::Entity::find_by_id(id)
        .lock_exclusive()
        .one(conn)
        .await?
    else {
        return Ok(false);
    };
    if TaskState::parse(&model.status)?.is_terminal() {
        return Ok(false);
    }

    let mut active = model.into_active_model();
    active.status = Set(outcome.state.as_str().to_owned());
    active.steps = Set(outcome.steps);
    active.result = Set(outcome.result.clone());
    active.error = Set(outcome.error.clone());
    active.updated_at = Set(Utc::now().fixed_offset());
    active.update(conn).await?;

    Ok(true)
}

/// 记下一个人做的决定；同一次审批重复提交**不再写**，返回已有那一行。
///
/// 调用方拿到返回值后要看 `applied_at`：为空说明「决定在册，但还没送进编排邮箱」，
/// 于是重复提交天然变成**补投**，而不是被当成冲突拒掉（进程可能恰好死在 commit 与投递之间）。
/// 相反的决定则是 [`Error::DecisionConflict`]：一次审批只能有一个结局，改判要在台账上留下痕迹，
/// 不能悄悄覆盖。
///
/// 「先插、撞主键就跳过、再读一行」而不是「先读、没有才插」：后者在并发双写时会撞出主键冲突，
/// 那是个**会自愈的假故障**，却会被上层报成数据库错误。写一句走完，判定统一在读到的那一行上做。
///
/// # Errors
/// 想记 `EXPIRED`（不是人的决定）返回 [`Error::NotHumanDecision`]；同一审批已有相反决定返回
/// [`Error::DecisionConflict`]。
pub async fn record_approval<C: ConnectionTrait>(
    conn: &C,
    approval: &NewApproval,
) -> Result<agent_approval::Model, Error> {
    require_human_decision(approval.state)?;

    let now = Utc::now().fixed_offset();
    let model = agent_approval::ActiveModel {
        id: Set(approval.id.clone()),
        tenant_id: Set(approval.tenant_id),
        task_id: Set(approval.task_id),
        step: Set(approval.step),
        tool: Set(approval.tool.clone()),
        arguments: Set(approval.arguments.clone()),
        state: Set(approval.state.as_str().to_owned()),
        decided_by: Set(Some(approval.decided_by)),
        decided_at: Set(now),
        reason: Set(approval.reason.clone()),
        expires_at: Set(approval.expires_at),
        applied_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    };

    agent_approval::Entity::insert(model)
        .on_conflict_do_nothing()
        .exec_without_returning(conn)
        .await?;

    // 读回来的才是权威：可能是这一次插的，也可能是先到的那一次留下的。
    let recorded =
        find_approval(conn, &approval.id)
            .await?
            .ok_or_else(|| Error::ApprovalVanished {
                approval_id: approval.id.clone(),
            })?;

    let existing = ApprovalState::parse(&recorded.state)?;
    if existing != approval.state {
        return Err(Error::DecisionConflict {
            approval_id: approval.id.clone(),
            existing: existing.as_str(),
            incoming: approval.state.as_str(),
        });
    }

    Ok(recorded)
}

/// 读一条审批（读不到即 `None`：可能是别人的行，策略会隐藏它）。
pub async fn find_approval<C: ConnectionTrait>(
    conn: &C,
    id: &str,
) -> Result<Option<agent_approval::Model>, Error> {
    Ok(agent_approval::Entity::find_by_id(id).one(conn).await?)
}

/// 标记决定**已经送进编排邮箱**；返回本次是否真的改了（`false` = 早就送过了）。
///
/// 送没送到只能记在台账上，不能靠「调用返回成功」推断：投递与标记之间进程可能崩，
/// 留一个 `applied_at IS NULL` 的行，正好让下一次重复提交把它补上。
pub async fn mark_applied<C: ConnectionTrait>(conn: &C, id: &str) -> Result<bool, Error> {
    let Some(model) = find_approval(conn, id).await? else {
        return Ok(false);
    };
    if model.applied_at.is_some() {
        return Ok(false);
    }

    let now = Utc::now().fixed_offset();
    let mut active = model.into_active_model();
    active.applied_at = Set(Some(now));
    active.updated_at = Set(now);
    active.update(conn).await?;

    Ok(true)
}

/// 工具白名单落库形状：字符串数组。
///
/// 空数组就落空数组——「不给工具」与「没记录」是两件事，不能混成 NULL。
fn tools_to_json(tools: &[String]) -> Value {
    Value::Array(
        tools
            .iter()
            .map(|tool| Value::String(tool.clone()))
            .collect(),
    )
}

/// 入参闸门：只有终态能写回。
fn require_terminal(state: TaskState) -> Result<(), Error> {
    if state.is_terminal() {
        return Ok(());
    }
    Err(Error::NotTerminal {
        state: state.as_str(),
    })
}

/// 入参闸门：审批台账只收**人做过的**决定。
///
/// `EXPIRED` 是编排等出来的结局，没有决定人；放它进台账，就等于在「人批过什么」这份账上
/// 记一笔没人做过的事，事后无法分辨。
fn require_human_decision(state: ApprovalState) -> Result<(), Error> {
    if state == ApprovalState::Expired {
        return Err(Error::NotHumanDecision {
            state: state.as_str(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tools_keep_their_order_and_empty_stays_empty() {
        let tools = vec!["asset_read".to_owned(), "knowledge_search".to_owned()];
        assert_eq!(
            tools_to_json(&tools),
            serde_json::json!(["asset_read", "knowledge_search"])
        );
        assert_eq!(tools_to_json(&[]), serde_json::json!([]));
    }

    #[test]
    fn only_terminal_states_pass_the_gate() {
        assert_eq!(
            require_terminal(TaskState::Running)
                .unwrap_err()
                .to_string(),
            "终态写回要求终态状态，收到：RUNNING"
        );
        assert!(require_terminal(TaskState::Succeeded).is_ok());
        assert!(require_terminal(TaskState::Failed).is_ok());
    }

    #[test]
    fn expiry_is_not_a_human_decision() {
        assert_eq!(
            require_human_decision(ApprovalState::Expired)
                .unwrap_err()
                .to_string(),
            "`agent_approval.state` 不接受 EXPIRED：人只能批准或驳回，`EXPIRED` 是编排等出来的结局"
        );
        assert!(require_human_decision(ApprovalState::Approved).is_ok());
        assert!(require_human_decision(ApprovalState::Rejected).is_ok());
    }
}
