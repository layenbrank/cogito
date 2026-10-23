use actix_web::web;

use crate::guards::auth::Auth;
use crate::services::gateway::controller::GatewayController;
use crate::services::upload::controller::UploadController;

pub struct GatewayModule;

impl GatewayModule {
    /// 租户面：审计读取与导出挂在 `TenantModule` 的 `/tenants` scope 下。
    ///
    /// 只注册相对路径的 `web::resource`（与订阅/支付同一法则，见 `PaymentModule` 注释）：
    /// 自建 `/tenants/{id}/…` 前缀 scope 会与父级同级并列，actix 的 `ResourceMap`
    /// 只进先命中的前缀节点，后注册的那片永远 404。
    ///
    /// 日志表是网关域的，但「哪个租户」由路径决定，于是路由归这里、前缀归父级。
    pub fn configure_tenant(cfg: &mut web::ServiceConfig) {
        cfg.service(
            web::resource("/{id}/audit").route(web::get().to(GatewayController::tenant_audit)),
        )
        .service(
            web::resource("/{id}/audit/export")
                .route(web::get().to(GatewayController::tenant_audit_export)),
        );
    }

    pub fn configure(cfg: &mut web::ServiceConfig) {
        cfg.service(
            web::scope("/gateway")
                // 用户面：模型转发 + 可用模型列表 + 自助配额/档位（登录即可）
                .wrap(Auth::isRequired())
                .route("/chat/completions", web::post().to(GatewayController::chat))
                .route("/models", web::get().to(GatewayController::models))
                .route("/quota/me", web::get().to(GatewayController::quota_me))
                .route("/plans", web::get().to(GatewayController::plans))
                // 后台：供应商/模型/用量/审计（平台 ADMIN）
                .configure(admin_routes),
        )
        // 服务身份面：给受信服务进程（compute）用的出站端点。
        //
        // 单独成一个前缀而不是塞进 `/gateway`：那一层整层挂着 `Auth::isRequired()`，
        // 服务进程没有用户会话，套进去只会每个请求都 401。这里的身份由请求头承载，
        // 校验实现为 `FromRequest`（见 `guards::service`），不是中间件——
        // 端点是否受保护由 handler 的形参决定，改一处不会漏掉整层。
        .service(
            web::scope("/service")
                .route("/token", web::post().to(GatewayController::service_token))
                .route(
                    "/embeddings",
                    web::post().to(GatewayController::service_embeddings),
                )
                .route(
                    "/chat/completions",
                    web::post().to(GatewayController::service_chat),
                )
                // 资产内容：handler 住在 upload 域（读的是资产与 CAS），
                // 但路由必须注册在这里——`/service` 只能有一份注册点（见下）。
                .route(
                    "/assets/{id}/content",
                    web::get().to(UploadController::service_content),
                )
                // 资产可见性写入：同样住在 upload 域。这条路要 `asset-write` 令牌，
                // 而令牌里的可见性是**人批过的**（见 `GatewayController::service_token`）。
                .route(
                    "/assets/{id}/visibility",
                    web::put().to(UploadController::service_visibility),
                ),
        );
    }
}

/// 管理面路由：在上一层「登录校验」之外再要求平台 ADMIN 角色。
///
/// 逐条按 `web::resource` 注册，而不是再套一层 `web::scope("")`：同一层级出现两个
/// 空前缀 scope 时，actix 的 `ResourceMap` 只在第一个匹配节点内继续查找，后注册的
/// scope 永远不会被命中（管理面接口曾因此全部 404）。
fn admin_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::resource("/providers")
            .wrap(Auth::admin())
            .route(web::get().to(GatewayController::providers))
            .route(web::post().to(GatewayController::provider_write)),
    )
    .service(
        web::resource("/providers/{id}")
            .wrap(Auth::admin())
            .route(web::put().to(GatewayController::provider_update))
            .route(web::delete().to(GatewayController::provider_remove)),
    )
    .service(
        web::resource("/admin/models")
            .wrap(Auth::admin())
            .route(web::get().to(GatewayController::models_admin))
            .route(web::post().to(GatewayController::model_write)),
    )
    .service(
        web::resource("/admin/models/{id}")
            .wrap(Auth::admin())
            .route(web::put().to(GatewayController::model_update))
            .route(web::delete().to(GatewayController::model_remove)),
    )
    .service(
        web::resource("/usage")
            .wrap(Auth::admin())
            .route(web::get().to(GatewayController::usage)),
    )
    .service(
        web::resource("/audit")
            .wrap(Auth::admin())
            .route(web::get().to(GatewayController::audit)),
    )
    // 导出与列表同一层权限，但**必须是独立的 resource**：`/audit` 上挂的是
    // `web::get().to(handler)` 单端点，路径再长一段不会落进它。
    .service(
        web::resource("/audit/export")
            .wrap(Auth::admin())
            .route(web::get().to(GatewayController::audit_export)),
    );
}
