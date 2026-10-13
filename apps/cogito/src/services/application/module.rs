use actix_web::web;

use crate::middlewares::rate_limit::AuthGovernor;
use crate::services::{
    agent::module::AgentModule, application::controller::ApplicationController,
    auth::module::AuthModule, chat::module::ChatModule, engine::module::EngineModule,
    gateway::module::GatewayModule, payment::module::PaymentModule, rag::module::RagModule,
    sso::module::SsoModule, tenant::module::TenantModule, upload::module::UploadModule,
    user::module::UserModule,
};

pub struct ApplicationModule;

impl ApplicationModule {
    pub fn configure(cfg: &mut web::ServiceConfig, auth_governor: AuthGovernor) {
        cfg.service(
            web::scope("/api/v1")
                .configure(|c| AuthModule::configure(c, &auth_governor))
                .configure(UserModule::configure)
                .configure(UploadModule::configure)
                .configure(EngineModule::configure)
                .configure(TenantModule::configure)
                .configure(GatewayModule::configure)
                .configure(SsoModule::configure)
                // agent 任务：起任务 / 查任务（`/api/v1/agent/tasks`）
                .configure(AgentModule::configure)
                // rag 索引：起任务 / 查任务（`/api/v1/rag/index-tasks`）
                .configure(RagModule::configure)
                // 会话同步：推一批 / 拉增量（`/api/v1/chat/sync`）
                .configure(ChatModule::configure)
                // 支付渠道回调（匿名，验签在业务层完成）
                .configure(PaymentModule::configure_notify)
                // 计费运维面：价目管理与计量对账（平台 ADMIN）
                .configure(PaymentModule::configure_billing)
                .service(
                    web::scope("/application")
                        .route("/toRead", web::get().to(ApplicationController::toRead)),
                ),
        );
    }
}
