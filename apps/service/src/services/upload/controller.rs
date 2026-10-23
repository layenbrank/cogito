use std::sync::Arc;

use actix_multipart::Multipart;
use actix_web::http::header::{
    CONTENT_LENGTH, ContentDisposition, DispositionParam, DispositionType,
};
use actix_web::{HttpRequest, HttpResponse, Result, web};

use crate::{
    databases::database::Storage,
    filters::exception::Exception,
    guards::service::{AssetScope, AssetWriteScope},
    guards::session::Session,
    interceptors::envelope::Envelope,
    services::upload::{
        multipart,
        schema::{FilesP, FinalizeP, HashP, PrepareP},
        service::UploadService,
        storage::{self, safe_filename},
    },
    utils::code::resource,
};

pub struct UploadController;

impl UploadController {
    pub async fn prepare(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        req: web::Json<PrepareP>,
    ) -> Result<HttpResponse> {
        let Some(session) = Session::of(&http) else {
            return Exception::unauthorized("用户未登录").transform();
        };
        let user_id = session.user_id().to_string();

        match UploadService::prepare(&db, req.into_inner(), &user_id).await {
            Ok(response) => Envelope::success(response, "初始化上传成功").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    pub async fn bind_hash(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        req: web::Json<HashP>,
    ) -> Result<HttpResponse> {
        let Some(session) = Session::of(&http) else {
            return Exception::unauthorized("用户未登录").transform();
        };
        let user_id = session.user_id().to_string();

        match UploadService::bind_hash(&db, req.into_inner(), &user_id).await {
            Ok(response) => Envelope::success(response, "绑定文件哈希成功").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    pub async fn chunk(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        payload: Multipart,
    ) -> Result<HttpResponse> {
        let Some(session) = Session::of(&http) else {
            return Exception::unauthorized("用户未登录").transform();
        };
        let user_id = session.user_id().to_string();

        let form = match multipart::parse_chunk_form(payload).await {
            Ok(form) => form,
            Err(body) => return body.transform(),
        };

        match UploadService::chunk(&db, &form.id, form.index, form.data, &form.hash, &user_id).await
        {
            Ok(response) => Envelope::success(response, "分片上传成功").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    pub async fn finalize(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        req: web::Json<FinalizeP>,
    ) -> Result<HttpResponse> {
        let Some(session) = Session::of(&http) else {
            return Exception::unauthorized("用户未登录").transform();
        };
        let user_id = session.user_id().to_string();

        match UploadService::finalize(&db, &req.id, &user_id).await {
            Ok(response) => Envelope::success(response, "完成上传成功").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    pub async fn progress(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let Some(session) = Session::of(&http) else {
            return Exception::unauthorized("用户未登录").transform();
        };
        let user_id = session.user_id().to_string();
        let id = path.into_inner();

        match UploadService::progress(&db, &id, &user_id).await {
            Ok(response) => Envelope::success(response, "获取上传进度成功").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    pub async fn cancel(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let Some(session) = Session::of(&http) else {
            return Exception::unauthorized("用户未登录").transform();
        };
        let user_id = session.user_id().to_string();
        let id = path.into_inner();

        match UploadService::cancel(&db, &id, &user_id).await {
            Ok(()) => Envelope::message_only("上传已取消").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    /// 本人已上传文件列表（分页）
    pub async fn toRead_files(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        query: web::Query<FilesP>,
    ) -> Result<HttpResponse> {
        let Some(session) = Session::of(&http) else {
            return Exception::unauthorized("用户未登录").transform();
        };
        let user_id = session.user_id().to_string();

        match UploadService::toRead_files(&db, &user_id, query.into_inner()).await {
            Ok(response) => Envelope::success(response, "获取文件列表成功").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    /// 按资产 id 流式下载（PUBLIC 可匿名；PRIVATE/RESTRICTED 需 JWT + ACL）
    pub async fn serve_asset(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let user_id = Session::of(&http).map(|session| session.user_id().to_string());
        let id = path.into_inner();

        match UploadService::find_owned_asset(&db, &id, user_id.as_deref()).await {
            Ok(asset) => Self::stream_asset(&db, asset, user_id.as_deref()).await,
            Err(err) => Exception::from(err).transform(),
        }
    }

    /// 按文件 hash 流式下载（仅本人 COMPLETED）
    pub async fn serve_file(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        path: web::Path<String>,
    ) -> Result<HttpResponse> {
        let Some(session) = Session::of(&http) else {
            return Exception::unauthorized("用户未登录").transform();
        };
        let user_id = session.user_id().to_string();
        let hash = path.into_inner();

        match UploadService::find_file_for_download(&db, &hash, &user_id).await {
            Ok(Some(asset)) => Self::stream_asset(&db, asset, Some(&user_id)).await,
            Ok(None) => Exception::not_found("文件不存在").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    /// 服务身份按资产 id 流式读取内容（`asset-read` 作用域令牌）。
    ///
    /// 与 [`serve_asset`](Self::serve_asset) 的差别是凭据：这里没有用户会话，作用域来自令牌
    /// （租户 + 单个资产）。于是路径参数只用于**比对**，不用于授权——授权的唯一来源是令牌
    /// 里的 assetID，请求打错资产只会 403，不会被当成「换了个人来读」。
    pub async fn service_content(
        db: web::Data<Arc<Storage>>,
        path: web::Path<String>,
        scope: AssetScope,
    ) -> Result<HttpResponse> {
        if path.into_inner() != scope.asset_id() {
            // 与资产面的口径一致（`UploadError::Forbidden`）：无权读这个资源，而不是「参数写错了」
            return Exception::custom(
                resource::ACCESS_RESTRICTED,
                "服务身份令牌作用域与该资产不符",
            )
            .transform();
        }

        match UploadService::service_asset_content(&db, scope.tenant_id(), scope.asset_id()).await {
            Ok((asset, hashes)) => Self::stream_hashes(asset, hashes),
            Err(err) => Exception::from(err).transform(),
        }
    }

    /// 服务身份按一次**已批准的**审批改资产可见性（`asset-write` 作用域令牌）。
    ///
    /// 这个端点**没有请求体**：改成什么样已经钉在令牌里了（那才是人批过的那一份），请求里
    /// 只剩「打哪个资产」，而它同样在令牌里。路径参数因此只用于比对，与
    /// [`service_content`](Self::service_content) 同一口径。
    /// 写以批准人的身份落地（`scope.actor_id()`），因为资产行的写策略只认创建者。
    /// 响应是裸结构：调用方是服务进程，与换令牌的 [`service_token`] 口径一致。
    ///
    /// [`service_token`]: crate::services::gateway::controller::GatewayController::service_token
    pub async fn service_visibility(
        db: web::Data<Arc<Storage>>,
        path: web::Path<String>,
        scope: AssetWriteScope,
    ) -> Result<HttpResponse> {
        if path.into_inner() != scope.asset_id() {
            return Exception::custom(
                resource::ACCESS_RESTRICTED,
                "服务身份令牌作用域与该资产不符",
            )
            .transform();
        }

        match UploadService::service_asset_visibility(
            &db,
            scope.actor_id(),
            scope.asset_id(),
            scope.visibility(),
            scope.viewers(),
        )
        .await
        {
            Ok(asset) => Ok(HttpResponse::Ok().json(asset)),
            Err(err) => Exception::from(err).transform(),
        }
    }

    async fn stream_asset(
        db: &Arc<Storage>,
        asset: entity::asset::Model,
        user_id: Option<&str>,
    ) -> Result<HttpResponse> {
        match UploadService::stream_hashes_for_asset(db, &asset, user_id).await {
            Ok(chunk_hashes) => Self::stream_hashes(asset, chunk_hashes),
            Err(err) => Exception::from(err).transform(),
        }
    }

    /// 分片清单已就位（CAS 已校验）时构造流式响应：用户路径与服务身份路径共用。
    fn stream_hashes(
        asset: entity::asset::Model,
        chunk_hashes: Vec<String>,
    ) -> Result<HttpResponse> {
        let filename = safe_filename(&asset.name);
        let stream = storage::stream_cas_chunks(chunk_hashes);
        Ok(HttpResponse::Ok()
            .content_type(asset.mime.as_str())
            .insert_header((CONTENT_LENGTH, asset.size))
            .insert_header(ContentDisposition {
                disposition: DispositionType::Attachment,
                parameters: vec![DispositionParam::Filename(filename)],
            })
            .streaming(stream))
    }
}
