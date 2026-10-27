pub mod addons;
pub mod agent;
pub mod application;
pub mod auth;
pub mod billing;
pub mod chat;
pub mod common;
pub mod console;
pub mod engine;
pub mod exception;
pub mod gateway;
pub mod mcp;
pub mod paths;
pub mod payment;
pub mod rag;
pub mod sso;
pub mod subscription;
pub mod system;
pub mod tenant;
pub mod upload;
pub mod user;

use crate::oas::addons::ContractAddon;
use utoipa::OpenApi;

use crate::oas::common::{
    ApplicationEnvelope, ApprovalEnvelope, CaptchaEnvelope, CatalogEnvelope, ChatChangesEnvelope,
    ChatSyncEnvelope, ChunkUploadEnvelope, ChunkUploadForm, DependencyCheck, EmptyEnvelope, EmptyR,
    Exception, ExceptionEnvelope, ExceptionGroupPageEnvelope, ExceptionPageEnvelope,
    ExceptionSourcesEnvelope, ExceptionSummaryEnvelope, FinalizeUploadEnvelope, Health,
    HealthEnvelope, IndexTaskEnvelope, Liveness, LivenessEnvelope, MemberEnvelope,
    MemberListEnvelope, ModelEnvelope, ModelListEnvelope, OrderEnvelope, OrderListEnvelope,
    PlansEnvelope, PreferenceEnvelope, PriceEnvelope, PriceListEnvelope, ProfileEnvelope,
    ProviderEnvelope, ProviderListEnvelope, QuotaEnvelope, Readiness, ReadinessEnvelope,
    ReconcileEnvelope, SelfQuotaEnvelope, SigninEnvelope, SigninErrorExample, SigninSuccessExample,
    SignupEnvelope, SsoConnectionEnvelope, SsoConnectionListEnvelope, SsoLoginEnvelope,
    SubscriptionEnvelope, SubscriptionListEnvelope, SuggestionEnvelope, TaskEnvelope,
    TenantEnvelope, TenantListEnvelope, UploadFilesEnvelope, UploadHashEnvelope,
    UploadPrepareEnvelope, UploadProgressEnvelope, UserEnvelope, UserListEnvelope,
};
use crate::services::agent::schema::{ApprovalP, ApprovalR, TaskP, TaskR};
use crate::services::application::schema::{App, Component, Direction, Shape, Size};
use crate::services::auth::schema::{
    AuthR, Avatar, CaptchaP, CaptchaR, EmailSigninP, ForgotPasswordP, Gender, OtpChannel, OtpP,
    PasswordP, PhoneSigninP, ProfileP, ProfileR, ResetPasswordP, SigninP, SigninR, SignupP,
    SignupR,
};
use crate::services::chat::schema::{
    ChatChangeBatchR, ChatChangesR, ChatConflictR, ChatMessageP, ChatMessageR, ChatSessionP,
    ChatSessionR, ChatSyncP, ChatSyncR, ChatUsageP, ChatUsageR,
};
use crate::services::console::schema::{PreferenceP, PreferenceR};
use crate::services::engine::schema::{EmptySchema, ISchema, QueryP, SuggestionR, TSchema};
use crate::services::exception::schema::{
    ExceptionR, GroupPageR, GroupR, PageR, QueryP as ExceptionQueryP, SummaryR,
    WriteP as ExceptionWriteP,
};
use crate::services::gateway::schema::{
    ChatCompletionsP, EmbeddingsP, ModelR, ModelUpdateP, ModelWriteP, PlanR, PlansR, ProviderR,
    ProviderUpdateP, ProviderWriteP, SelfQuotaP, SelfQuotaR, ServiceTokenP, ServiceTokenR,
};
use crate::services::payment::schema::{
    CatalogR, OrderP, OrderR, PriceQueryP, PriceR, PriceUpdateP, PriceWriteP, ReconcileExceptionR,
    ReconcileExportFormat, ReconcileExportP, ReconcileModelR, ReconcileQueryP, ReconcileR,
    ReconcileTenantR, ReconcileTotalsR,
};
use crate::services::rag::schema::{IndexTaskP, IndexTaskR};
use crate::services::sso::schema::{
    SsoConnectionR, SsoConnectionUpdateP, SsoConnectionWriteP, SsoLoginR,
};
use crate::services::subscription::schema::{QuotaR, SubscribeP, SubscriptionR};
use crate::services::tenant::schema::{
    MemberR, MemberUpdateP, MemberWriteP, TenantR, TenantRole, TenantUpdateP, TenantWriteP,
};
use crate::services::upload::schema::{
    AssetR, ChunkR, FilesP, FilesR, FinalizeP, FinalizeR, HashP, HashR, PrepareP, PrepareR,
    ProgressR, UploadStatus, UploadedChunk, Visibility,
};
use crate::services::user::schema::{Avatar as UserAvatar, UpdateP, UserR, WriteP};

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Cogito Service API",
        version = env!("CARGO_PKG_VERSION"),
        description = "响应体统一信封：成功 code=200000，失败 code 为业务错误码且 details 仅在开发环境返回，\
            错误码规则见 /guide/error-codes.md。\
            接口版本与兼容策略见 /guide/api-versioning.md：主版本在 URL（/api/v1）、info.version 取构建版本、\
            错误码只增不改。\
            HTTP 状态码由错误码归属推导（校验类 400/422、未认证 401、\
            无权限 403、不存在 404、冲突 409、超限 413、限流 429、上游失败 502、内部错误 500），\
            成功恒为 200；未预期状态以契约中的 default 响应描述。\
            链路追踪：请求可带 W3C `traceparent`（缺省由服务端生成），响应始终回显该头，\
            响应体信封的 traceID 即其 trace-id。\
            鉴权：JWT Bearer；Apifox 环境变量统一使用 {{token}}（来自 signin.data.token）。\
            密码登录 / 注册 / 发 OTP 前须先 POST /api/v1/auth/captcha 获取 captchaKey（go-captcha 行为验证码）。",
        contact(name = "Cogito Team", email = "15638470820@163.com"),
        license(name = "Proprietary")
    ),
    servers(
        (url = "http://127.0.0.1:3000", description = "development"),
        (url = "https://api.example.com", description = "production")
    ),
    paths(
        system::health_doc,
        system::live_doc,
        system::ready_doc,
        auth::captcha_doc,
        auth::otp_doc,
        auth::signin_doc,
        auth::signin_phone_doc,
        auth::signin_email_doc,
        auth::signup_doc,
        auth::password_forgot_doc,
        auth::password_reset_doc,
        auth::password_doc,
        auth::toRead_doc,
        auth::toUpdate_doc,
        auth::signout_doc,
        user::toRead_doc,
        user::toWrite_doc,
        user::toRead_by_id_doc,
        user::toUpdate_doc,
        user::toRemove_doc,
        console::toRead_doc,
        console::toUpdate_doc,
        exception::toWrite_doc,
        exception::toList_doc,
        exception::groups_doc,
        exception::sources_doc,
        exception::summary_doc,
        exception::toRead_doc,
        exception::toRemove_doc,
        upload::prepare_upload_doc,
        upload::bind_hash_doc,
        upload::chunk_upload_doc,
        upload::finalize_upload_doc,
        upload::progress_upload_doc,
        upload::cancel_upload_doc,
        upload::toRead_files_doc,
        upload::serve_file_doc,
        upload::serve_asset_doc,
        engine::toRead_doc,
        application::toRead_doc,
        tenant::toList_doc,
        tenant::toWrite_doc,
        tenant::toRead_by_id_doc,
        tenant::toUpdate_doc,
        tenant::toRemove_doc,
        tenant::members_doc,
        tenant::member_add_doc,
        tenant::member_update_doc,
        tenant::member_remove_doc,
        subscription::toList_doc,
        subscription::toWrite_doc,
        subscription::toRemove_doc,
        subscription::quota_doc,
        gateway::chat_doc,
        gateway::models_doc,
        gateway::providers_doc,
        gateway::provider_write_doc,
        gateway::provider_update_doc,
        gateway::provider_remove_doc,
        gateway::models_admin_doc,
        gateway::model_write_doc,
        gateway::model_update_doc,
        gateway::model_remove_doc,
        gateway::usage_doc,
        gateway::audit_doc,
        gateway::audit_export_doc,
        gateway::tenant_audit_doc,
        gateway::tenant_audit_export_doc,
        gateway::quota_me_doc,
        gateway::plans_doc,
        gateway::service_token_doc,
        gateway::service_embeddings_doc,
        gateway::service_chat_doc,
        gateway::service_asset_content_doc,
        gateway::service_asset_visibility_doc,
        sso::connections_doc,
        sso::connection_write_doc,
        sso::connection_update_doc,
        sso::connection_remove_doc,
        sso::authorize_doc,
        sso::callback_doc,
        payment::catalog_doc,
        payment::toList_doc,
        payment::toWrite_doc,
        payment::toRead_by_no_doc,
        payment::sync_doc,
        payment::close_doc,
        payment::notify_wechat_doc,
        payment::notify_alipay_doc,
        billing::prices_doc,
        billing::price_write_doc,
        billing::price_update_doc,
        billing::price_archive_doc,
        billing::reconciliation_doc,
        billing::reconciliation_export_doc,
        agent::create_task_doc,
        agent::read_task_doc,
        agent::decide_approval_doc,
        rag::create_index_task_doc,
        rag::read_index_task_doc,
        rag::search_doc,
        chat::push_changes_doc,
        chat::pull_changes_doc,
        mcp::handle_doc,
    ),
    components(
        schemas(
            Exception,
            Health,
            HealthEnvelope,
            Liveness,
            LivenessEnvelope,
            Readiness,
            ReadinessEnvelope,
            DependencyCheck,
            EmptyR,
            EmptyEnvelope,
            SigninP,
            SigninR,
            SigninEnvelope,
            SigninSuccessExample,
            SigninErrorExample,
            SignupP,
            SignupR,
            SignupEnvelope,
            CaptchaP,
            CaptchaR,
            CaptchaEnvelope,
            OtpP,
            OtpChannel,
            PhoneSigninP,
            EmailSigninP,
            ForgotPasswordP,
            ResetPasswordP,
            PasswordP,
            ProfileP,
            ProfileR,
            ProfileEnvelope,
            AuthR,
            Avatar,
            Gender,
            WriteP,
            UpdateP,
            UserR,
            UserEnvelope,
            UserListEnvelope,
            UserAvatar,
            PreferenceP,
            PreferenceR,
            PreferenceEnvelope,
            ExceptionWriteP,
            ExceptionQueryP,
            ExceptionR,
            PageR,
            GroupR,
            GroupPageR,
            SummaryR,
            ExceptionEnvelope,
            ExceptionPageEnvelope,
            ExceptionGroupPageEnvelope,
            ExceptionSummaryEnvelope,
            ExceptionSourcesEnvelope,
            PrepareP,
            PrepareR,
            UploadedChunk,
            UploadPrepareEnvelope,
            HashP,
            HashR,
            UploadHashEnvelope,
            ChunkUploadForm,
            ChunkR,
            ChunkUploadEnvelope,
            FinalizeP,
            FinalizeR,
            FinalizeUploadEnvelope,
            ProgressR,
            UploadProgressEnvelope,
            FilesP,
            AssetR,
            FilesR,
            UploadFilesEnvelope,
            UploadStatus,
            Visibility,
            QueryP,
            TSchema,
            EmptySchema,
            ISchema,
            SuggestionR,
            SuggestionEnvelope,
            App,
            ApplicationEnvelope,
            Size,
            Shape,
            Component,
            Direction,
            TenantR,
            MemberR,
            TenantWriteP,
            TenantUpdateP,
            MemberWriteP,
            MemberUpdateP,
            TenantRole,
            TenantEnvelope,
            TenantListEnvelope,
            MemberEnvelope,
            MemberListEnvelope,
            SubscribeP,
            SubscriptionR,
            SubscriptionEnvelope,
            SubscriptionListEnvelope,
            QuotaR,
            QuotaEnvelope,
            ChatCompletionsP,
            ProviderR,
            ProviderWriteP,
            ProviderUpdateP,
            ModelR,
            ModelWriteP,
            ModelUpdateP,
            ProviderEnvelope,
            ProviderListEnvelope,
            ModelEnvelope,
            ModelListEnvelope,
            SelfQuotaP,
            SelfQuotaR,
            SelfQuotaEnvelope,
            PlanR,
            PlansR,
            PlansEnvelope,
            EmbeddingsP,
            ServiceTokenP,
            ServiceTokenR,
            SsoConnectionR,
            SsoConnectionWriteP,
            SsoConnectionUpdateP,
            SsoLoginR,
            SsoConnectionEnvelope,
            SsoConnectionListEnvelope,
            SsoLoginEnvelope,
            CatalogR,
            CatalogEnvelope,
            OrderP,
            OrderR,
            OrderEnvelope,
            OrderListEnvelope,
            PriceQueryP,
            PriceWriteP,
            PriceUpdateP,
            PriceR,
            PriceEnvelope,
            PriceListEnvelope,
            ReconcileQueryP,
            ReconcileExportP,
            ReconcileExportFormat,
            ReconcileTotalsR,
            ReconcileTenantR,
            ReconcileModelR,
            ReconcileExceptionR,
            ReconcileR,
            ReconcileEnvelope,
            TaskP,
            TaskR,
            TaskEnvelope,
            ApprovalP,
            ApprovalR,
            ApprovalEnvelope,
            IndexTaskP,
            IndexTaskR,
            IndexTaskEnvelope,
            ChatSyncP,
            ChatSessionP,
            ChatMessageP,
            ChatUsageP,
            ChatSyncR,
            ChatConflictR,
            ChatSessionR,
            ChatMessageR,
            ChatUsageR,
            ChatChangeBatchR,
            ChatChangesR,
            ChatSyncEnvelope,
            ChatChangesEnvelope,
        )
    ),
    tags(
        (name = "System", description = "系统级接口"),
        (name = "Auth", description = "认证与个人资料（图形验证码、OTP、密码/手机/邮箱登录）"),
        (name = "User", description = "后台用户管理（需 JWT）"),
        (name = "Console", description = "Backend Console 偏好（仅平台 ADMIN）"),
        (name = "Upload", description = "分片文件上传"),
        (name = "Engine", description = "搜索引擎代理"),
        (name = "Application", description = "应用入口（Mock）"),
        (name = "Tenant", description = "多租户组织与成员（需 JWT）"),
        (name = "Subscription", description = "个人租户订阅：免费/付费档位配额（需 JWT）"),
        (name = "Gateway", description = "模型网关：转发/配额/用量/审计（需 JWT）"),
        (name = "Service", description = "服务身份出站面：短期令牌与嵌入转发（仅内部服务进程，无 JWT）"),
        (name = "SSO", description = "单点登录（OIDC）"),
        (name = "Payment", description = "支付：档位/渠道目录、订单、渠道回调（下单需 JWT）"),
        (name = "Billing", description = "计费运维面：模型价目与计量对账（仅平台 ADMIN）"),
        (name = "Agent", description = "租户级自治 agent：长任务编排与台账（需 JWT + X-Tenant-ID）"),
        (name = "RAG", description = "RAG 索引任务：起任务 / 查任务（需 JWT + X-Tenant-ID）"),
        (name = "Chat", description = "会话同步：推一批 / 拉增量（需 JWT + X-Tenant-ID）"),
    ),
    modifiers(&ContractAddon),
    external_docs(
        url = "/guide/error-codes.md",
        description = "业务错误码说明"
    )
)]
pub struct OpenDoc;

/// 生成 OpenAPI JSON 字符串。
///
/// 输出必须规范化（所有对象键递归升序）：utoipa 的 `Extensions` 内部是 `HashMap`，
/// 直接序列化时键序随进程随机化——同一二进制连续运行会产出两种字节序列，
/// 会让「重新生成 + git diff」的漂移校验随机失败。排序由本函数自身保证，
/// 不依赖 `serde_json` 的 `preserve_order` 特性开关。
pub fn json_pretty() -> String {
    let mut spec = serde_json::to_value(OpenDoc::openapi()).expect("valid oas spec");
    sort_keys(&mut spec);
    serde_json::to_string_pretty(&spec).expect("valid oas spec")
}

fn sort_keys(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            let mut entries: Vec<(String, serde_json::Value)> =
                std::mem::take(map).into_iter().collect();
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            for (key, mut child) in entries {
                sort_keys(&mut child);
                map.insert(key, child);
            }
        }
        serde_json::Value::Array(items) => items.iter_mut().for_each(sort_keys),
        _ => {}
    }
}

/// 判断 spec 是否包含指定路由（method + path）
pub fn has_route(method: &str, path: &str, spec: &utoipa::openapi::OpenApi) -> bool {
    let Some(item) = spec.paths.paths.get(path) else {
        return false;
    };
    match method.to_uppercase().as_str() {
        "GET" => item.get.is_some(),
        "POST" => item.post.is_some(),
        "PUT" => item.put.is_some(),
        "DELETE" => item.delete.is_some(),
        "PATCH" => item.patch.is_some(),
        _ => false,
    }
}
