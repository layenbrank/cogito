//! rag 索引任务的业务侧：起任务、查进度。
//!
//! **顺序铁律**：先把台账行落库并提交，再起编排实例。反过来（先起实例再写台账）一旦在两步
//! 之间崩溃，就会留下一份**看不见的工作**：编排在跑、花了嵌入算力，但没有任何一行记录
//! 指向它，谁也查不到、谁也收不了尾。现在的顺序最坏留下「有台账、无实例」，而那一行是
//! 可见的，读路径按行龄就能把它收敛成失败。
//!
//! **校验全部先于建行**：资产是否存在、是否可索引、是否已有在跑的任务，都在写台账之前判完。
//! 于是坏入参留下的是**零**台账行——不会出现一堆注定失败的任务把「在跑」的唯一索引位占住。
//!
//! **谁写台账**：只有本进程（api）。orchestrator 侧零改动——它跑编排、调活动，结果由这里
//! 的等待者或读路径落到 `rag_index_task`。台账因此只有一个写者，`rag::persistence::finish`
//! 的行锁只用来兜「同一进程内的并发收尾」。
//!
//! **外部调用不跨作用域**：`durable` 的 `start`/`status` 都是网络调用，调用前必须把数据库
//! 事务落定（写路径 `commit`、读路径 `rollback`），否则连接与行锁会被一路占住。

use std::sync::Arc;

use chrono::{TimeDelta, Utc};
use durable::{Client, InstanceStatus};
use entity::rag_index_task;
use identity::TenantId;
use sea_orm::EntityTrait;
use uuid::Uuid;

use authz::{Action, Permission, Resource};

use crate::clients::compute::{
    CallMeta, ComputeClient, ComputeError, INTERNAL_SCHEMA_VERSION, SearchRequest,
};
use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::tenant::TenantCtx;
use crate::orchestrations::rag::{INDEX_ASSET, IndexAssetInput};
use crate::services::rag::dispatch;
use crate::services::rag::error::RagError;
use crate::services::rag::schema::{IndexTaskP, IndexTaskR, SearchHitR, SearchP, SearchR};
use crate::services::upload::schema::UploadStatus;
use crate::utils::telemetry::current_traceparent;

/// 起任务：租户内任何能看到该资产的成员都可以（含 MEMBER）。
///
/// 权限直接复用 `Asset` 的写/读：索引是「对这份资产的加工」，能改资产的人才能索引它，
/// 能看资产的人才能看它的索引进度。为它单开一对权限只会让权限种子多两份没人会去调的配置。
const WRITE_ASSET: Permission = Permission::new(Resource::Asset, Action::Write);
const READ_ASSET: Permission = Permission::new(Resource::Asset, Action::Read);

/// 台账显示 `RUNNING` 但编排里查不到这个实例时，容忍多久才判定它真的丢了。
///
/// 存在的意义是别把「实例还没被运行时领走」误判成失败：`start` 成功后实例马上就有记录，
/// 但库被重建、编排 schema 被清空这类事故也会让状态变成 `NotFound`，此时只有行龄能区分
/// 「刚起」和「早就没了」。
pub const INSTANCE_ABSENT_GRACE: TimeDelta = TimeDelta::seconds(300);

/// 编排运行时的两种起不来：配置层面没接通、以及接通了但这次启动失败。原因落台账与日志。
const RUNTIME_OFFLINE: &str = "编排运行时未接通（durable 未配置或连接失败）";
const RUNTIME_START_FAILED: &str = "编排实例启动失败";

/// 起任务前已定死的一切：台账行 + 编排输入。
///
/// 分两段是因为中间必须有一次事务提交：`prepare` 在请求事务里建行，`launch` 在提交之后
/// 才发网络调用。
pub struct Prepared {
    pub task_id: Uuid,
    pub tenant_id: TenantId,
    pub instance_id: String,
    pub row: rag_index_task::Model,
    pub input: IndexAssetInput,
}

pub struct IndexService;

impl IndexService {
    /// 校验入参、确认资产可索引、建台账行（不提交、不起实例）。
    ///
    /// # Errors
    /// 权限不足 403；资产 id 非法/不存在/已归档 404；资产未完成上传 422；该资产已有在跑的任务 409；库错 500。
    pub async fn prepare(ctx: &TenantCtx, req: IndexTaskP) -> Result<Prepared, Exception> {
        ctx.require(WRITE_ASSET)?;

        // 非法 id 与「不是我的 id」回同一个 404：分开会让调用方能拿它探测别的资产。
        let asset_id = Uuid::parse_str(req.asset_id.trim()).map_err(|_| RagError::AssetNotFound)?;
        let asset = entity::asset::Entity::find_by_id(asset_id)
            .one(ctx.tx())
            .await
            .map_err(|err| RagError::Database(err.to_string()))?
            .ok_or(RagError::AssetNotFound)?;

        // 只有 COMPLETED 的资产能被 compute 取到内容（见 `upload::service::service_asset_parts`）：
        // 在途或失败的行就算建了任务也注定在下游失败，不如在这里就说清楚。
        if UploadStatus::from_db(&asset.status) != UploadStatus::Completed {
            return Err(RagError::AssetNotIndexable("资产尚未完成上传，无法索引".into()).into());
        }
        // 已归档 = 用户侧已看不见它：按不存在处理，别让归档资产还能被索引出内容。
        if asset.archived_at.is_some() {
            return Err(RagError::AssetNotFound.into());
        }

        // 先查一次只是为了 409 能带上已有任务的 id；真正的互斥靠部分唯一索引（`create` 兜竞态）。
        if let Some(running) = rag::persistence::running_for(ctx.tx(), asset_id)
            .await
            .map_err(RagError::from)?
        {
            return Err(RagError::AlreadyRunning(Some(running.id)).into());
        }

        let task_id = Uuid::new_v4();
        let tenant_id = ctx.tenant_id();
        let user_id = ctx.principal().user_id().as_uuid();
        let instance_id = format!("rag-index-{task_id}");

        let row = rag::persistence::create(
            ctx.tx(),
            &rag::NewIndexTask {
                id: task_id,
                tenant_id: tenant_id.as_uuid(),
                user_id: Some(user_id),
                asset_id,
                instance_id: instance_id.clone(),
            },
        )
        .await
        .map_err(RagError::from)?;

        let input = IndexAssetInput {
            tenant_id: tenant_id.as_uuid().to_string(),
            asset_id: asset_id.to_string(),
            mime: asset.mime.clone(),
            name: Some(asset.name.clone()),
            traceparent: current_traceparent(),
        };

        Ok(Prepared {
            task_id,
            tenant_id,
            instance_id,
            row,
            input,
        })
    }

    /// 起编排实例并把等待者挂上。**必须在 `prepare` 的事务提交之后调用。**
    ///
    /// 起不来时把那一行落成失败再返回 503：任务确实没跑，台账必须如实说，不能让调用方隔一会儿
    /// 回来查到一条永远 `RUNNING` 的记录。
    ///
    /// # Errors
    /// 编排不可用 503（配置未接通或起实例失败）；此时台账那一行会被落成失败。
    pub async fn launch(
        storage: &Storage,
        client: Option<&Arc<Client>>,
        prepared: Prepared,
    ) -> Result<IndexTaskR, Exception> {
        let Some(client) = client else {
            return Err(ledger_unavailable(
                storage,
                &prepared,
                RUNTIME_OFFLINE,
                "编排运行时未接通（durable 未配置或连接不可用）",
            )
            .await);
        };

        if let Err(err) = client
            .start(&prepared.instance_id, INDEX_ASSET, &prepared.input)
            .await
        {
            return Err(ledger_unavailable(
                storage,
                &prepared,
                RUNTIME_START_FAILED,
                &format!("编排实例启动失败：{err}"),
            )
            .await);
        }

        let rendered = render(&prepared.row, None);
        dispatch::spawn_waiter(storage.clone(), Arc::clone(client), prepared.row);
        Ok(rendered)
    }

    /// 查任务：先读台账，只有还在跑时才去问编排当前进度。
    ///
    /// 终态的行**不再问编排**：台账是权威记录，编排实例的存活与否不影响「这个任务已经结束了」。
    ///
    /// # Errors
    /// 权限不足 403；id 不是 UUID 或租户内查不到 404；库错 500。
    pub async fn read(
        storage: &Storage,
        ctx: TenantCtx,
        client: Option<&Arc<Client>>,
        id: &str,
    ) -> Result<IndexTaskR, Exception> {
        ctx.require(READ_ASSET)?;

        // 非法 id 与「不是我的 id」回同一个 404：分开会让调用方能拿它探测别的租户。
        let task_id = Uuid::parse_str(id).map_err(|_| RagError::NotFound)?;
        let row = rag::persistence::find(ctx.tx(), task_id)
            .await
            .map_err(RagError::from)?;

        // 下面要发网络调用，先把只读事务还回去（回滚是空操作，但连接当场归还）。
        ctx.rollback().await?;

        let Some(row) = row else {
            return Err(RagError::NotFound.into());
        };

        if rag::IndexState::parse(&row.status)
            .map_err(RagError::from)?
            .is_terminal()
        {
            return Ok(render(&row, None));
        }

        let Some(client) = client else {
            // 编排运行时没接通不影响「查得到自己起过的任务」：台账本来就在，如实返回 RUNNING。
            return Ok(render(&row, None));
        };

        match client.status(&row.instance_id).await {
            Ok(status) => {
                if let Some(progress) = dispatch::progress_of(&status) {
                    return Ok(render(&row, Some(&progress)));
                }
                if status.is_terminal() {
                    let outcome = dispatch::outcome_of(status);
                    let settled = dispatch::settle(storage, row.id, tenant_id_of(&row), &outcome)
                        .await
                        .map_err(Exception::from)?;
                    return Ok(render(settled.as_ref().unwrap_or(&row), None));
                }
                if matches!(status, InstanceStatus::NotFound) {
                    return settle_after_missing(storage, row).await;
                }
                Ok(render(&row, None))
            }
            Err(err) => {
                // 查不到状态不等于任务失败：把「台账原样」返回，等下一次查询或等待者收尾。
                tracing::warn!(error = %err, task = %row.id, "查询 rag 索引编排状态失败");
                Ok(render(&row, None))
            }
        }
    }
}

/// 检索：把查询转给 compute，回传命中的块。
///
/// 与索引路径的关系只有一条：**嵌入模型必须与索引时用的一致**，所以 `model` 从服务端配置取
/// （`compute.embed_model`），不接受客户端指指定 —— 客户端传错只会得到一份空结果，
/// 而排查方向会被引到「索引没建好」上。
///
/// 没有台账、没有编排：检索是只读的一次外部调用，失败就如实报失败（可重试的 503/429）。
pub struct SearchService;

impl SearchService {
    /// 在本租户已索引的内容里检索。
    ///
    /// # Errors
    /// 权限不足 403；compute 未接通 503；compute 报错按分类映射（429 限流、5xx 暂不可用）。
    pub async fn find(
        ctx: TenantCtx,
        compute: Option<&Arc<ComputeClient>>,
        embed_model: &str,
        req: SearchP,
        traceparent: Option<String>,
    ) -> Result<SearchR, Exception> {
        ctx.require(READ_ASSET)?;

        let query = req.query.trim();
        if query.is_empty() {
            return Err(RagError::EmptyQuery.into());
        }

        let tenant_id = ctx.tenant_id();
        // compute 是外部调用，不能挂在请求事务上。
        ctx.rollback().await?;

        let Some(client) = compute else {
            return Err(RagError::ComputeUnavailable(
                "compute 未配置（api 进程未接计算车间）".into(),
            )
            .into());
        };

        let request = SearchRequest {
            schema_version: INTERNAL_SCHEMA_VERSION,
            tenant_id: tenant_id.as_uuid().to_string(),
            model: embed_model.to_owned(),
            query: query.to_owned(),
            top_k: req.top_k,
            asset_ids: req.asset_ids,
        };
        // 幂等键只是头的占位（检索端点不进幂等账本）；按「租户 + 查询 + 资产集」派生，
        // 重试时下游看到的仍是同一次请求。
        let meta = CallMeta::new(
            format!(
                "rag-search:{}:{}:{}",
                tenant_id.as_uuid(),
                request.query,
                request.asset_ids.as_ref().map_or(0, Vec::len)
            ),
            traceparent,
        );

        let response = client
            .rag_search(&request, &meta)
            .await
            .map_err(search_error)?;

        Ok(SearchR {
            hits: response
                .hits
                .into_iter()
                .map(|hit| SearchHitR {
                    asset_id: hit.asset_id,
                    ordinal: hit.ordinal,
                    score: hit.score,
                    text: hit.text,
                })
                .collect(),
        })
    }
}

/// compute 的错误 → 对外失败。
///
/// 只分两类：**请求本身有问题**（400，重试没意义）与**下游暂时不行**（503，可重试）。
/// 把两类混成一句「检索失败」会让客户端在参数写错时反复重试。
fn search_error(err: ComputeError) -> Exception {
    match err {
        ComputeError::Rejected { status, .. } if (400..500).contains(&status) => {
            tracing::warn!(status, "rag 检索被 compute 拒绝");
            Exception::custom(
                crate::utils::code::request::INVALID_PARAMETER_VALUE,
                "检索参数不合法",
            )
        }
        other => {
            tracing::error!(error = %other, "rag 检索调用 compute 失败");
            RagError::ComputeUnavailable(other.to_string()).into()
        }
    }
}

/// 编排里没有这个实例：只有行龄够老才判失败，否则保持 `RUNNING` 等它被领走。
async fn settle_after_missing(
    storage: &Storage,
    row: rag_index_task::Model,
) -> Result<IndexTaskR, Exception> {
    if Utc::now().signed_duration_since(row.created_at) <= INSTANCE_ABSENT_GRACE {
        return Ok(render(&row, None));
    }

    let outcome = rag::IndexOutcome::failed("编排实例已不存在（任务记录仍在，未跑完）");
    let settled = dispatch::settle(storage, row.id, tenant_id_of(&row), &outcome)
        .await
        .map_err(Exception::from)?;

    Ok(render(settled.as_ref().unwrap_or(&row), None))
}
/// 把「编排起不来」落成失败台账，返回这个 503。
///
/// 落库失败只记日志：响应还是要说「这次没跑起来」，但那一行最坏也只是停在 `RUNNING` 上，
/// 读路径会在宽限期后把它收敛成失败——收尾有两条独立通道，不该因为一条断了就改口说成功。
async fn ledger_unavailable(
    storage: &Storage,
    prepared: &Prepared,
    reason: &str,
    detail: &str,
) -> Exception {
    tracing::error!(task = %prepared.task_id, reason, "rag 索引编排不可用");

    let outcome = rag::IndexOutcome::failed(reason.to_owned());
    if let Err(err) =
        dispatch::settle(storage, prepared.task_id, prepared.tenant_id, &outcome).await
    {
        tracing::error!(error = %err, task = %prepared.task_id, "rag 索引失败台账未能落库");
    }

    RagError::OrchestrationUnavailable(detail.to_owned()).into()
}

/// 台账行 → 出参。`progress` 是编排自报的当前进度原文（只有还在跑、且问得到时才有）。
fn render(row: &rag_index_task::Model, progress: Option<&str>) -> IndexTaskR {
    IndexTaskR {
        id: row.id.to_string(),
        tenant_id: row.tenant_id.to_string(),
        user_id: row.user_id.map(|id| id.to_string()),
        asset_id: row.asset_id.to_string(),
        status: row.status.clone(),
        progress: progress.map(str::to_owned),
        result: row.result.clone(),
        error: row.error.clone(),
        created_at: row.created_at.timestamp_millis(),
        updated_at: row.updated_at.timestamp_millis(),
    }
}

/// 行里的租户即收尾要开的作用域；列本身就是 uuid，不需要再解析字符串。
fn tenant_id_of(row: &rag_index_task::Model) -> TenantId {
    TenantId::from_uuid(row.tenant_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row() -> rag_index_task::Model {
        let now = Utc::now().fixed_offset();
        rag_index_task::Model {
            id: Uuid::parse_str("1a1a1a1a-2b2b-4c3c-8d4d-5e5e5e5e5e5e").unwrap(),
            tenant_id: Uuid::parse_str("9f9f9f9f-8e8e-4d4d-8c8c-7b7b7b7b7b7b").unwrap(),
            user_id: Some(Uuid::parse_str("2a2a2a2a-3b3b-4c4c-8d8d-6e6e6e6e6e6e").unwrap()),
            asset_id: Uuid::parse_str("3a3a3a3a-4b4b-4c4c-8d8d-7e7e7e7e7e7e").unwrap(),
            status: rag::IndexState::Running.as_str().to_owned(),
            instance_id: "rag-index-1a1a".into(),
            result: None,
            error: None,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn render_reflects_the_ledger_row() {
        let rendered = render(&row(), Some("embedded:32"));

        assert_eq!(rendered.id, "1a1a1a1a-2b2b-4c3c-8d4d-5e5e5e5e5e5e");
        assert_eq!(rendered.asset_id, "3a3a3a3a-4b4b-4c4c-8d8d-7e7e7e7e7e7e");
        assert_eq!(rendered.status, "RUNNING");
        assert_eq!(rendered.progress.as_deref(), Some("embedded:32"));
        assert!(rendered.result.is_none(), "还没结束就不该有结果");
        assert_eq!(rendered.created_at, rendered.updated_at);
    }

    #[test]
    fn render_without_progress_does_not_invent_one() {
        let rendered = render(&row(), None);
        assert_eq!(rendered.progress, None);
    }

    /// 检索失败只分两类：参数问题不重试，下游暂时不行才重试。
    #[test]
    fn search_errors_split_into_rejected_and_unavailable() {
        let rejected = search_error(ComputeError::Rejected {
            status: 400,
            body: "bad query".into(),
        });
        assert_eq!(
            rejected.code,
            crate::utils::code::request::INVALID_PARAMETER_VALUE
        );

        let unavailable = search_error(ComputeError::Unavailable {
            status: 502,
            body: "down".into(),
        });
        assert_eq!(
            unavailable.code,
            crate::utils::code::business::rag::SEARCH_UNAVAILABLE
        );

        // 429 也归到「可重试」，不能因为它是 4xx 就判成参数错。
        let limited = search_error(ComputeError::RateLimited);
        assert_eq!(
            limited.code,
            crate::utils::code::business::rag::SEARCH_UNAVAILABLE
        );
    }

    #[test]
    fn missing_user_is_reported_as_null_not_as_a_guess() {
        let mut anonymous = row();
        anonymous.user_id = None;
        assert_eq!(render(&anonymous, None).user_id, None);
    }

    #[test]
    fn tenant_scope_is_rebuilt_from_the_row() {
        assert_eq!(tenant_id_of(&row()).as_uuid(), row().tenant_id);
    }
}
