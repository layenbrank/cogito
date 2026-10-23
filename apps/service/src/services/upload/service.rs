//! 上传/资产用例：每段数据库工作都开在**最短作用域**里。
//!
//! 资产是内容寻址的资源，读它的身份有三种（见 `guards::asset`），所以这里的形状是
//! 「一小段事务 → 长文件 I/O → 另一小段事务」：会话校验、已有分片、终态幂等都挤在只读的
//! 第一段里，CAS 读写与完整性校验放在事务之外（绝不跨 I/O 持连接），最后一次写入单独提交。
//! 唯一的例外是秒传：克隆自己的行与标记本会话 SUPERSEDED 必须同一次提交，否则会留下
//! 「指向不存在目标」的会话。

use entity::asset;
use identity::{TenantId, UserId};
use sea_orm::{DatabaseTransaction, DbErr};
use uuid::Uuid;

use crate::databases::database::Storage;
use crate::guards::account::AccountScope;
use crate::guards::asset::{AssetContentScope, AssetReader};
use crate::guards::tenant::TenantScope;
use crate::services::upload::error::UploadError;
use crate::services::upload::repository;
use crate::services::upload::schema::{
    AssetR, ChunkR, FilesP, FilesR, FinalizeR, HashP, HashR, PrepareP, PrepareR, ProgressR,
    UploadStatus, Visibility, viewers_to_json,
};
use crate::services::upload::storage;
use crate::services::upload::validation::{self, normalize_hash};

pub struct UploadService;

impl UploadService {
    pub async fn prepare(
        db: &Storage,
        req: PrepareP,
        user_id: &str,
    ) -> Result<PrepareR, UploadError> {
        validation::validate_prepare(&req)?;

        if let Some(hash) = normalize_hash(req.hash.as_deref()) {
            // ① 自己已经有同布局的完成资产：这次上传本来就已经完成过。
            if let Some(response) = Self::reuse_own(db, user_id, hash, &req).await? {
                return Ok(response);
            }

            // ② 内容寻址：这份字节别人（可能是别的租户）已经有 → 克隆出自己的行（秒传）。
            //    克隆需要先看清内容，而「看清内容」只能靠 hash 能力键，与我的身份无关。
            if let Some(source) = {
                let scope = AssetContentScope::open(db, hash).await.map_err(db_error)?;
                let source = repository::find_completed(scope.tx(), hash).await?;
                scope.rollback().await.map_err(db_error)?;
                source
            } {
                if Self::prepare_layout_ok(&req, &source) {
                    let scope = account(db, user_id).await?;
                    let cloned =
                        repository::clone_completed_for(scope.tx(), &source, user_id, &req.name)
                            .await?;
                    let response = repository::prepare_response(scope.tx(), &cloned, true).await?;
                    scope.commit().await.map_err(db_error)?;
                    return Ok(response);
                }
            }

            // ③ 未完成会话：续传。会话永远属于创建者，所以只可能是我自己的行。
            let scope = account(db, user_id).await?;
            let pending = repository::find_pending(scope.tx(), hash, Some(user_id)).await?;
            if let Some(pending) = pending {
                let response = repository::prepare_response(scope.tx(), &pending, false).await?;
                scope.rollback().await.map_err(db_error)?;
                return Ok(response);
            }
            scope.rollback().await.map_err(db_error)?;
        }

        // ④ 新建会话：CAS 目录属于存储而不是数据库，先落地再开事务。
        storage::ensure_cas_dir().await?;
        let scope = account(db, user_id).await?;
        let record = repository::build_record(req, Some(user_id.to_string()))?;
        let inserted = repository::insert(scope.tx(), record).await?;
        let response = repository::prepare_response(scope.tx(), &inserted, false).await?;
        scope.commit().await.map_err(db_error)?;
        Ok(response)
    }

    pub async fn bind_hash(db: &Storage, req: HashP, user_id: &str) -> Result<HashR, UploadError> {
        validation::validate_hash_hex(&req.hash)?;

        // ① 会话终态幂等：SUPERSEDED / COMPLETED 都已结束，重放直接给结果。
        let asset = {
            let scope = account(db, user_id).await?;
            let asset = Self::load_owned(scope.tx(), &req.id, user_id).await?;
            let status = UploadStatus::from_db(&asset.status);
            let done = match status {
                UploadStatus::Superseded => {
                    Some(Self::hash_r_from_superseded(scope.tx(), &asset).await?)
                }
                UploadStatus::Completed => {
                    Some(Self::hash_r_from_completed(scope.tx(), &asset).await?)
                }
                _ => {
                    validation::validate_status(&asset)?;
                    None
                }
            };
            scope.rollback().await.map_err(db_error)?;
            if let Some(response) = done {
                return Ok(response);
            }
            asset
        };

        // ② 自己的完成资产同布局 → 本会话被秒传（标记与读取同一次提交）。
        {
            let scope = account(db, user_id).await?;
            let mine = repository::find_completed_owned(scope.tx(), &req.hash, user_id).await?;
            if let Some(mine) = mine.filter(|mine| repository::layout_matches(&asset, mine)) {
                repository::mark_superseded(scope.tx(), asset.clone(), mine.id).await?;
                let response = Self::hash_r_from_completed(scope.tx(), &mine).await?;
                scope.commit().await.map_err(db_error)?;
                return Ok(response);
            }
            scope.rollback().await.map_err(db_error)?;
        }

        // ③ 内容寻址：别人的同布局完成资产 → 克隆成自己的行再秒传。
        let source = {
            let scope = AssetContentScope::open(db, &req.hash)
                .await
                .map_err(db_error)?;
            let source = repository::find_completed(scope.tx(), &req.hash).await?;
            scope.rollback().await.map_err(db_error)?;
            source
        };
        if let Some(source) = source.filter(|source| repository::layout_matches(&asset, source)) {
            let scope = account(db, user_id).await?;
            let cloned =
                repository::clone_completed_for(scope.tx(), &source, user_id, &asset.name).await?;
            repository::mark_superseded(scope.tx(), asset.clone(), cloned.id).await?;
            let response = Self::hash_r_from_completed(scope.tx(), &cloned).await?;
            scope.commit().await.map_err(db_error)?;
            return Ok(response);
        }

        if !asset.hash.is_empty() && asset.hash != req.hash {
            return Err(UploadError::BadRequest(
                "会话已绑定其他文件哈希，无法更改".into(),
            ));
        }

        // ④ 绑定：同 hash 另有未完成会话时丢掉*空闲*旧会话，保留当前正在传的会话。
        let scope = account(db, user_id).await?;
        if let Some(pending) =
            repository::find_pending(scope.tx(), &req.hash, Some(user_id)).await?
        {
            if pending.id != asset.id {
                repository::discard_session(scope.tx(), pending).await?;
            }
        }
        let updated = repository::bind_hash(scope.tx(), asset, &req.hash).await?;
        let uploaded = repository::uploaded_list(scope.tx(), updated.id).await?;
        scope.commit().await.map_err(db_error)?;

        Ok(HashR {
            id: updated.id.to_string(),
            exists: false,
            chunks: uploaded.iter().map(|c| c.index).collect(),
            uploaded,
        })
    }

    pub async fn chunk(
        db: &Storage,
        id: &str,
        index: u32,
        data: Option<Vec<u8>>,
        hash: &str,
        user_id: &str,
    ) -> Result<ChunkR, UploadError> {
        // ① 会话与已有分片：全部读完就释放，后面要写 CAS。
        let asset = {
            let scope = account(db, user_id).await?;
            let asset = Self::load_owned(scope.tx(), id, user_id).await?;
            if UploadStatus::from_db(&asset.status).is_terminal_ok() {
                scope.rollback().await.map_err(db_error)?;
                return Ok(instant_chunk_response(index));
            }
            validation::validate_status(&asset)?;
            validation::validate_hash_hex(hash)?;
            validation::expected_chunk_size(&asset, index)?;

            let existing = repository::find_chunk(scope.tx(), asset.id, index).await?;
            scope.rollback().await.map_err(db_error)?;
            if let Some(existing) = existing {
                if existing.hash == hash {
                    return Ok(ChunkR {
                        success: true,
                        index,
                        reused: true,
                        message: format!("分片 {index} 已上传"),
                    });
                }
                return Err(UploadError::BadRequest(format!(
                    "分片 {index} 已存在但 hash 不一致，请取消后重传"
                )));
            }
            asset
        };

        // ② CAS：内容寻址存储，命中即秒传，未命中才落盘。
        let (reused, size) = if storage::cas_exists(hash).await {
            let len = storage::cas_len(hash).await? as usize;
            validation::validate_chunk_size(&asset, index, len)?;
            if let Some(ref bytes) = data {
                if !bytes.is_empty() {
                    let calculated = storage::calculate_hash(bytes);
                    validation::validate_chunk_hash(hash, &calculated)?;
                    validation::validate_chunk_size(&asset, index, bytes.len())?;
                }
            }
            (true, len as i64)
        } else {
            let Some(bytes) = data.filter(|b| !b.is_empty()) else {
                return Err(UploadError::BadRequest(
                    "分片在 CAS 中不存在，必须上传 chunk 数据".into(),
                ));
            };
            let calculated = storage::calculate_hash(&bytes);
            validation::validate_chunk(&asset, index, &bytes, hash, &calculated)?;
            let reused = storage::store_cas(hash, &bytes).await?;
            (reused, bytes.len() as i64)
        };

        // ③ 登记分片（并把会话推进到 UPLOADING）。
        let scope = account(db, user_id).await?;
        repository::upsert_chunk(scope.tx(), &asset, index, hash, size, Some(user_id)).await?;
        scope.commit().await.map_err(db_error)?;

        Ok(ChunkR {
            success: true,
            index,
            reused,
            message: if reused {
                format!("分片 {index} 秒传成功")
            } else {
                format!("分片 {index} 上传成功")
            },
        })
    }

    pub async fn finalize(db: &Storage, id: &str, user_id: &str) -> Result<FinalizeR, UploadError> {
        // ① 终态幂等 + 分片清单：读完释放，后面要做完整性校验。
        let (asset, chunk_hashes) = {
            let scope = account(db, user_id).await?;
            let asset = Self::load_owned(scope.tx(), id, user_id).await?;
            let status = UploadStatus::from_db(&asset.status);
            if status == UploadStatus::Superseded {
                let target = Self::resolve_superseded(scope.tx(), &asset).await?;
                let response = FinalizeR {
                    success: true,
                    url: repository::file_url_by_id(&target.id),
                    id: target.id.to_string(),
                };
                scope.rollback().await.map_err(db_error)?;
                return Ok(response);
            }
            if status == UploadStatus::Completed {
                let response = FinalizeR {
                    success: true,
                    url: repository::file_url_by_id(&asset.id),
                    id: asset.id.to_string(),
                };
                scope.rollback().await.map_err(db_error)?;
                return Ok(response);
            }

            let uploaded = repository::count_chunks(scope.tx(), asset.id).await?;
            validation::validate_completion(&asset, uploaded)?;
            let chunk_hashes = repository::ordered_chunk_hashes(scope.tx(), &asset).await?;
            scope.rollback().await.map_err(db_error)?;
            (asset, chunk_hashes)
        };

        // ② 逐分片对账（读 CAS 文件）。
        storage::ensure_cas_present(&chunk_hashes).await?;
        let sha = storage::verify_chunks_integrity(&chunk_hashes, &asset.hash).await?;

        // ③ 落完成状态。
        let scope = account(db, user_id).await?;
        repository::mark_completed(scope.tx(), &asset, &sha).await?;
        scope.commit().await.map_err(db_error)?;

        Ok(FinalizeR {
            success: true,
            url: repository::file_url_by_id(&asset.id),
            id: id.to_string(),
        })
    }

    pub async fn progress(db: &Storage, id: &str, user_id: &str) -> Result<ProgressR, UploadError> {
        let scope = account(db, user_id).await?;
        let asset = Self::load_owned(scope.tx(), id, user_id).await?;
        let status = UploadStatus::from_db(&asset.status);
        if status == UploadStatus::Superseded {
            let response = Self::progress_superseded(scope.tx(), id, &asset).await;
            scope.rollback().await.map_err(db_error)?;
            return response;
        }

        let uploaded = repository::uploaded_list(scope.tx(), asset.id).await?;
        scope.rollback().await.map_err(db_error)?;

        let progress = if asset.total == 0 {
            0.0
        } else {
            uploaded.len() as f64 / asset.total as f64 * 100.0
        };

        Ok(ProgressR {
            id: id.to_string(),
            progress,
            chunks: uploaded.iter().map(|c| c.index).collect(),
            uploaded,
            total: asset.total as u32,
            status,
            superseded: None,
        })
    }

    pub async fn cancel(db: &Storage, id: &str, user_id: &str) -> Result<(), UploadError> {
        let scope = account(db, user_id).await?;
        let asset = Self::load_owned(scope.tx(), id, user_id).await?;
        if UploadStatus::from_db(&asset.status) == UploadStatus::Completed {
            return Err(UploadError::BadRequest("已完成的资产不能取消".into()));
        }
        repository::discard_session(scope.tx(), asset).await?;
        scope.commit().await.map_err(db_error)?;
        Ok(())
    }

    pub async fn toRead_files(
        db: &Storage,
        user_id: &str,
        query: FilesP,
    ) -> Result<FilesR, UploadError> {
        let page = query.page.unwrap_or(1).max(1);
        let size = query.size.unwrap_or(20).clamp(1, 100);

        let scope = account(db, user_id).await?;
        let (items, count) =
            repository::list_owned(scope.tx(), user_id, page, size, query.status.as_ref()).await?;
        scope.rollback().await.map_err(db_error)?;

        Ok(FilesR::from_page(items, count, page, size))
    }

    pub async fn find_file_for_download(
        db: &Storage,
        hash: &str,
        user_id: &str,
    ) -> Result<Option<asset::Model>, UploadError> {
        let scope = account(db, user_id).await?;
        let found = repository::find_file_for_download(scope.tx(), hash, user_id).await?;
        scope.rollback().await.map_err(db_error)?;
        Ok(found)
    }

    /// 按 id 取可下载的资产：**先可见、再判权**。
    ///
    /// 行级策略决定「我能不能看到这一行」，`ensure_can_download` 决定「看到之后能不能下」。
    /// 看不到就是 404（连存在性都不告诉你），看得到但没权限才是 403。
    pub async fn find_owned_asset(
        db: &Storage,
        id: &str,
        user_id: Option<&str>,
    ) -> Result<asset::Model, UploadError> {
        let scope = reader(db, user_id).await?;
        let asset = repository::find_by_id(scope.tx(), id).await?;
        let status = UploadStatus::from_db(&asset.status);

        if status == UploadStatus::Superseded {
            // 会话 id 仅创建者可用；跟随目标后再做下载 ACL
            let Some(user_id) = user_id else {
                return Err(UploadError::Forbidden);
            };
            validation::ensure_owner(&asset, user_id)?;
            let target = Self::resolve_superseded(scope.tx(), &asset).await?;
            validation::ensure_can_download(&target, Some(user_id))?;
            if UploadStatus::from_db(&target.status) != UploadStatus::Completed {
                return Err(UploadError::BadRequest("文件尚未完成上传".into()));
            }
            scope.rollback().await.map_err(db_error)?;
            return Ok(target);
        }

        validation::ensure_can_download(&asset, user_id)?;
        if status != UploadStatus::Completed {
            return Err(UploadError::BadRequest("文件尚未完成上传".into()));
        }
        scope.rollback().await.map_err(db_error)?;
        Ok(asset)
    }

    pub async fn stream_hashes_for_asset(
        db: &Storage,
        asset: &asset::Model,
        user_id: Option<&str>,
    ) -> Result<Vec<String>, UploadError> {
        let scope = reader(db, user_id).await?;
        let hashes = repository::ordered_chunk_hashes(scope.tx(), asset).await?;
        scope.rollback().await.map_err(db_error)?;
        storage::ensure_cas_present(&hashes).await?;
        Ok(hashes)
    }

    /// 服务身份按 **(租户, 资产)** 取内容：`asset-read` 令牌的落地方式。
    ///
    /// 与用户路径的差别只在「凭据从哪来」：这里没有账号，只有租户作用域，于是行级策略
    /// 只放行本租户可见的行——别的租户的 `PRIVATE` 行根本查不到（404，连存在性都不外泄）。
    /// 令牌里的 assetID 由调用方比对，本函数不做 ACL 判定：作用域已经把它定死在一个资产上，
    /// 再补一层「像用户那样判权」只会多出一处可能与策略漂移的判定。
    pub async fn service_asset_content(
        db: &Storage,
        tenant_id: TenantId,
        asset_id: &str,
    ) -> Result<(asset::Model, Vec<String>), UploadError> {
        let scope = tenant_scope(db, tenant_id).await?;
        let loaded = Self::service_asset_parts(scope.tx(), asset_id).await;
        scope.rollback().await.map_err(db_error)?;
        let (asset, hashes) = loaded?;
        // 跨事务的文件 I/O 绝不持连接：CAS 就位校验放在事务外。
        storage::ensure_cas_present(&hashes).await?;
        Ok((asset, hashes))
    }

    /// 在**已开好的**作用域里确认「资产可见且已完成」并取分片清单。
    ///
    /// 单独暴露是给签发内容令牌用的：令牌段只要知道「这个资产确实可读」，不必再开一个事务；
    /// 签发与读内容共用同一处判定，两处口径不会漂移。
    pub async fn service_asset_parts(
        tx: &DatabaseTransaction,
        asset_id: &str,
    ) -> Result<(asset::Model, Vec<String>), UploadError> {
        let asset = repository::find_by_id(tx, asset_id).await?;
        if UploadStatus::from_db(&asset.status) != UploadStatus::Completed {
            return Err(UploadError::BadRequest("文件尚未完成上传".into()));
        }
        let hashes = repository::ordered_chunk_hashes(tx, &asset).await?;
        Ok((asset, hashes))
    }

    /// 服务身份改一个资产的可见性：`asset-write` 令牌的落地方式。
    ///
    /// 与读的两条服务路径不同，写**不能走租户作用域**：资产行的写策略只认 `creator`，租户作用域
    /// 下这次 UPDATE 会一行都改不到。于是这里以**批准人（= 资产创建者）的账号作用域**落地——
    /// 这正是「审批通道」的意义所在：机器拿到了人的授权，就以那个人的身份去写一次。
    ///
    /// 可见性与可见对象都已经由调用方从**令牌**里解析成类型（人批过的那一份），这里不再接受
    /// 请求体里来的任何东西。
    ///
    /// # Errors
    /// 作用域开不起来、资产不存在（含不属于批准人）、创建者不是批准人、写库失败。
    pub async fn service_asset_visibility(
        db: &Storage,
        actor_id: &str,
        asset_id: &str,
        visibility: &Visibility,
        viewers: &[Uuid],
    ) -> Result<AssetR, UploadError> {
        let actor = UploadError::parse_user_id(actor_id)?;
        let scope = reader(db, Some(actor_id)).await?;
        let written =
            Self::write_visibility(scope.tx(), asset_id, actor, visibility, viewers).await;
        let asset = match written {
            Ok(asset) => asset,
            Err(err) => {
                scope.rollback().await.map_err(db_error)?;
                return Err(err);
            }
        };
        // 写路径必须显式提交；失败即没写成，调用方拿到 500 而不是「以为成功了」。
        scope.commit().await.map_err(db_error)?;
        Ok(repository::asset_to_r(asset))
    }

    /// 短事务里的那一次写：读一行 → 核归属 → 改可见性。
    ///
    /// 归属在领域层再核一次：策略挡人的方式是「改 0 行」，那看起来会像写成功了（响应还是那一行），
    /// 所以这里主动比对创建者，把「不是你的资产」明确判成 403。
    async fn write_visibility(
        tx: &DatabaseTransaction,
        asset_id: &str,
        actor: Uuid,
        visibility: &Visibility,
        viewers: &[Uuid],
    ) -> Result<asset::Model, UploadError> {
        let asset = repository::find_by_id(tx, asset_id).await?;
        if asset.creator != Some(actor) {
            return Err(UploadError::AssetForbidden);
        }
        let viewers = match visibility {
            Visibility::Restricted => viewers_to_json(viewers),
            // 非 RESTRICTED 一律清空名单：留着旧的名单会让后续从 PUBLIC 改回 RESTRICTED 时
            // 悄悄沿用上一批人，而名单必须是每次显式给的。
            _ => None,
        };
        repository::update_visibility(tx, asset, visibility.as_str(), viewers, actor).await
    }

    /// 自己已有同布局的完成资产：上传其实早就完成了，给回同一行（幂等）。
    async fn reuse_own(
        db: &Storage,
        user_id: &str,
        hash: &str,
        req: &PrepareP,
    ) -> Result<Option<PrepareR>, UploadError> {
        let scope = account(db, user_id).await?;
        let mine = repository::find_completed_owned(scope.tx(), hash, user_id).await?;
        let Some(mine) = mine.filter(|mine| Self::prepare_layout_ok(req, mine)) else {
            scope.rollback().await.map_err(db_error)?;
            return Ok(None);
        };
        let response = repository::prepare_response(scope.tx(), &mine, true).await?;
        scope.rollback().await.map_err(db_error)?;
        Ok(Some(response))
    }

    fn prepare_layout_ok(req: &PrepareP, existing: &asset::Model) -> bool {
        req.size as i64 == existing.size && req.chunk as i32 == existing.chunk
    }

    async fn load_owned(
        tx: &DatabaseTransaction,
        id: &str,
        user_id: &str,
    ) -> Result<asset::Model, UploadError> {
        let asset = repository::find_by_id(tx, id).await?;
        validation::ensure_owner(&asset, user_id)?;
        Ok(asset)
    }

    async fn resolve_superseded(
        tx: &DatabaseTransaction,
        asset: &asset::Model,
    ) -> Result<asset::Model, UploadError> {
        let Some(target) = asset.superseded else {
            return Err(UploadError::BadRequest("秒传目标缺失".into()));
        };
        repository::find_by_id(tx, &target.to_string()).await
    }

    async fn hash_r_from_completed(
        tx: &DatabaseTransaction,
        asset: &asset::Model,
    ) -> Result<HashR, UploadError> {
        let uploaded = repository::uploaded_list(tx, asset.id).await?;
        Ok(HashR {
            id: asset.id.to_string(),
            exists: true,
            chunks: uploaded.iter().map(|c| c.index).collect(),
            uploaded,
        })
    }

    async fn hash_r_from_superseded(
        tx: &DatabaseTransaction,
        asset: &asset::Model,
    ) -> Result<HashR, UploadError> {
        let target = Self::resolve_superseded(tx, asset).await?;
        Self::hash_r_from_completed(tx, &target).await
    }

    async fn progress_superseded(
        tx: &DatabaseTransaction,
        session_id: &str,
        asset: &asset::Model,
    ) -> Result<ProgressR, UploadError> {
        let target = Self::resolve_superseded(tx, asset).await?;
        let uploaded = repository::uploaded_list(tx, target.id).await?;
        Ok(ProgressR {
            id: session_id.to_string(),
            progress: 100.0,
            chunks: uploaded.iter().map(|c| c.index).collect(),
            uploaded,
            total: target.total as u32,
            status: UploadStatus::Superseded,
            superseded: Some(target.id.to_string()),
        })
    }
}

/// 账号作用域：资产面的本人读写都从这里出发，写路径必须显式 commit。
async fn account(db: &Storage, user_id: &str) -> Result<AccountScope, UploadError> {
    let user_id = UserId::from_uuid(UploadError::parse_user_id(user_id)?);
    AccountScope::open(db, user_id).await.map_err(db_error)
}

/// 读资产的作用域：登录态是账号作用域，匿名只剩 `PUBLIC` 可读。
async fn reader(db: &Storage, user_id: Option<&str>) -> Result<AssetReader, UploadError> {
    let user_id = match user_id {
        Some(id) => Some(UserId::from_uuid(UploadError::parse_user_id(id)?)),
        None => None,
    };
    AssetReader::enter(db, user_id).await.map_err(db_error)
}

/// 服务身份读资产的作用域：机器路径没有账号，只有租户。
async fn tenant_scope(db: &Storage, tenant_id: TenantId) -> Result<TenantScope, UploadError> {
    TenantScope::open(db, tenant_id).await.map_err(db_error)
}

/// 守卫的错误只有一种来源：事务开不起来。
fn db_error(err: DbErr) -> UploadError {
    UploadError::Database(err.to_string())
}

/// SUPERSEDED / COMPLETED 时在途分片的幂等成功响应（不写库）。
pub fn instant_chunk_response(index: u32) -> ChunkR {
    ChunkR {
        success: true,
        index,
        reused: true,
        message: "文件已秒传".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_status_yields_idempotent_chunk() {
        assert!(UploadStatus::Superseded.is_terminal_ok());
        assert!(UploadStatus::Completed.is_terminal_ok());
        assert!(!UploadStatus::Uploading.is_terminal_ok());
        assert!(!UploadStatus::Pending.is_terminal_ok());

        let res = instant_chunk_response(43);
        assert!(res.success);
        assert!(res.reused);
        assert_eq!(res.index, 43);
        assert_eq!(res.message, "文件已秒传");
    }

    #[test]
    fn bind_hash_instant_keeps_session_contract() {
        // 秒传不得 DELETE 当前会话：chunk 看到 SUPERSEDED/COMPLETED 即 200。
        // 与 upsert_chunk 的 SessionGone（真删除/GC）分开。
        assert!(UploadStatus::from_db("SUPERSEDED").is_terminal_ok());
        assert_eq!(crate::utils::code::business::upload::SESSION_GONE, 500207);
        assert_eq!(crate::utils::code::request::INVALID_PARAMETER_VALUE, 200003);
    }
}
