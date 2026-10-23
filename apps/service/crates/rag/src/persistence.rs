//! 台账读写：建行、读行、查在跑的行、终态写回。
//!
//! 四个函数都要求调用方**已经在正确的作用域里**（`rag_index_task` 已启用 RLS），本模块不写
//! `"tenantID" = ?` 条件：租户判定只有一处（策略），两处判定必然有一天不一致。

use chrono::Utc;
use entity::rag_index_task;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DbErr, EntityTrait, IntoActiveModel,
    QueryFilter, QueryOrder, QuerySelect, RuntimeErr, Set,
};
use uuid::Uuid;

use crate::{Error, IndexOutcome, IndexState, NewIndexTask};

/// 建行：`status = RUNNING`、无结果。
///
/// 先落台账再起编排实例：反过来的话，进程在「实例已起、台账未写」之间崩溃，会留下**看不见的工作**。
/// 现在的顺序最坏留下「有台账、无实例」，读时按行龄判定即可修成失败。
///
/// # Errors
/// 同一租户的同一资产已有 `RUNNING` 行时返回 [`Error::AlreadyRunning`]（部分唯一索引兜并发，
/// 调用方的先查一次只是为了让 409 能带上已有任务的 id）。
pub async fn create<C: ConnectionTrait>(
    conn: &C,
    task: &NewIndexTask,
) -> Result<rag_index_task::Model, Error> {
    let now = Utc::now().fixed_offset();
    let model = rag_index_task::ActiveModel {
        id: Set(task.id),
        tenant_id: Set(task.tenant_id),
        user_id: Set(task.user_id),
        asset_id: Set(task.asset_id),
        status: Set(IndexState::Running.as_str().to_owned()),
        instance_id: Set(task.instance_id.clone()),
        result: Set(None),
        error: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    };

    model.insert(conn).await.map_err(classify)
}

/// 读行（读不到即 `None`：可能是别人的行，策略会隐藏它）。
pub async fn find<C: ConnectionTrait>(
    conn: &C,
    id: Uuid,
) -> Result<Option<rag_index_task::Model>, Error> {
    Ok(rag_index_task::Entity::find_by_id(id).one(conn).await?)
}

/// 查该资产当前在跑的那一行（同一资产同时只允许一个）。
///
/// 存在的意义是让「重复提交」的 409 能带上已有任务的 id —— 唯一索引只能告诉调用方「撞了」，
/// 说不出撞的是谁。取最新一行：部分唯一索引保证至多一行，`ORDER BY` 只是让查询计划稳定。
pub async fn running_for<C: ConnectionTrait>(
    conn: &C,
    asset_id: Uuid,
) -> Result<Option<rag_index_task::Model>, Error> {
    Ok(rag_index_task::Entity::find()
        .filter(rag_index_task::Column::AssetId.eq(asset_id))
        .filter(rag_index_task::Column::Status.eq(IndexState::Running.as_str()))
        .order_by_desc(rag_index_task::Column::CreatedAt)
        .one(conn)
        .await?)
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
    outcome: &IndexOutcome,
) -> Result<bool, Error> {
    require_terminal(outcome.state)?;

    let Some(model) = rag_index_task::Entity::find_by_id(id)
        .lock_exclusive()
        .one(conn)
        .await?
    else {
        return Ok(false);
    };
    if IndexState::parse(&model.status)?.is_terminal() {
        return Ok(false);
    }

    let mut active = model.into_active_model();
    active.status = Set(outcome.state.as_str().to_owned());
    active.result = Set(outcome.result.clone());
    active.error = Set(outcome.error.clone());
    active.updated_at = Set(Utc::now().fixed_offset());
    active.update(conn).await?;

    Ok(true)
}

/// 唯一冲突 → [`Error::AlreadyRunning`]，其余原样上抛。
///
/// 本表除主键外只有一条部分唯一索引（`uidx_rag_index_task_running`），而主键是 v4 uuid，
/// 撞主键不是现实路径；所以这里不做约束名匹配，把所有 23505 归到「已有在跑的任务」。
fn classify(err: DbErr) -> Error {
    if is_unique_violation(&err) {
        Error::AlreadyRunning
    } else {
        Error::Db(err)
    }
}

/// 入参闸门：只有终态能写回。
fn require_terminal(state: IndexState) -> Result<(), Error> {
    if state.is_terminal() {
        return Ok(());
    }
    Err(Error::NotTerminal {
        state: state.as_str(),
    })
}

/// PostgreSQL unique_violation (SQLSTATE 23505)。
///
/// 这份实现是 `cogito::utils::db` 的窄化副本：那个模块在 api 二进制里，而 crate 禁止依赖
/// `cogito`（R1）。只保留 23505 一种判据——crate 里没有别的约束冲突要区分。
fn is_unique_violation(err: &DbErr) -> bool {
    if sqlstate(err).as_deref() == Some("23505") {
        return true;
    }
    let msg = err.to_string().to_lowercase();
    msg.contains("duplicate key") || msg.contains("unique constraint")
}

fn sqlstate(err: &DbErr) -> Option<String> {
    match err {
        DbErr::Exec(RuntimeErr::SqlxError(e)) | DbErr::Query(RuntimeErr::SqlxError(e)) => e
            .as_database_error()
            .and_then(|db| db.code().map(|c| c.into())),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_terminal_states_pass_the_gate() {
        assert_eq!(
            require_terminal(IndexState::Running)
                .unwrap_err()
                .to_string(),
            "终态写回要求终态状态，收到：RUNNING"
        );
        assert!(require_terminal(IndexState::Succeeded).is_ok());
        assert!(require_terminal(IndexState::Failed).is_ok());
    }

    #[test]
    fn duplicate_key_is_treated_as_already_running() {
        let err = classify(DbErr::Custom(
            "duplicate key value violates unique constraint \"uidx_rag_index_task_running\"".into(),
        ));
        assert!(matches!(err, Error::AlreadyRunning));
        assert_eq!(err.to_string(), "该资产已有正在运行的索引任务");
    }

    #[test]
    fn unrelated_failures_stay_database_errors() {
        let err = classify(DbErr::Custom("connection reset".into()));
        assert!(matches!(err, Error::Db(_)));
    }
}
