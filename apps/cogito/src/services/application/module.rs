use actix_web::web;

use crate::middlewares::rate_limit::AuthGovernor;
use crate::services::{
    agent::module::AgentModule, application::controller::ApplicationController,
    auth::module::AuthModule, chat::module::ChatModule, console::module::ConsoleModule,
    engine::module::EngineModule, exception::module::ExceptionModule,
    gateway::module::GatewayModule, mcp::module::McpModule, payment::module::PaymentModule,
    rag::module::RagModule, sso::module::SsoModule, tenant::module::TenantModule,
    upload::module::UploadModule, user::module::UserModule,
};

pub struct ApplicationModule;

impl ApplicationModule {
    pub fn configure(cfg: &mut web::ServiceConfig, auth_governor: AuthGovernor) {
        cfg.service(
            web::scope("/api/v1")
                .configure(|c| AuthModule::configure(c, &auth_governor))
                .configure(UserModule::configure)
                .configure(ConsoleModule::configure)
                // 异常上报（POST 可匿名）与运维查询（ADMIN）
                .configure(ExceptionModule::configure)
                .configure(UploadModule::configure)
                .configure(EngineModule::configure)
                .configure(TenantModule::configure)
                // 平台运维面：全量租户（与「我的租户」/tenants 分离）
                .configure(TenantModule::configure_admin)
                .configure(GatewayModule::configure)
                .configure(SsoModule::configure)
                // agent 任务：起任务 / 查任务（`/api/v1/agent/tasks`）
                .configure(AgentModule::configure)
                // rag 索引：起任务 / 查任务（`/api/v1/rag/index-tasks`）
                .configure(RagModule::configure)
                // 会话同步：推一批 / 拉增量（`/api/v1/chat/sync`）
                .configure(ChatModule::configure)
                // MCP：JSON-RPC 端点（`/api/v1/mcp`）
                .configure(McpModule::configure)
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
