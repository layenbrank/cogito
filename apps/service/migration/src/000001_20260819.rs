//! 单一世代迁移：一次性建出当前全部业务表。
//!
//! 项目处于开发期，迁移只保留这一代；`up` 会先整体清掉业务表再重建，
//! 因此改 schema 时直接改本文件即可（无需追加新版本）。

use sea_orm_migration::{prelude::*, schema::*};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "000001_20260819"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // 整体重建：按依赖倒序清掉全部业务表（含外键级联）
        manager
            .drop_table(
                Table::drop()
                    .if_exists()
                    // outbox / consumed_event 无外键，先清即可
                    .table(Outbox::Table)
                    .table(ConsumedEvent::Table)
                    // agent_task / rag_index_task 引用 tenant / auth / asset，排在它们之前
                    // （cascade 是兜底，顺序才是意图）
                    .table(AgentApproval::Table)
                    .table(AgentTask::Table)
                    .table(RagIndexTask::Table)
                    // chat_* 四表：消息指向会话，且都指向 tenant（cascade 是兜底，顺序才是意图）
                    .table(ChatSyncBatch::Table)
                    .table(ChatUsage::Table)
                    .table(ChatMessage::Table)
                    .table(ChatSession::Table)
                    .table(SsoConnection::Table)
                    .table(ConsolePreference::Table)
                    .table(Exception::Table)
                    .table(PaymentOrder::Table)
                    .table(BillingPrice::Table)
                    .table(Subscription::Table)
                    .table(GatewayAudit::Table)
                    .table(GatewayUsage::Table)
                    .table(GatewayModel::Table)
                    .table(GatewayProvider::Table)
                    .table(TenantMember::Table)
                    .table(Tenant::Table)
                    .table(Chunk::Table)
                    .table(Asset::Table)
                    .table(Auth::Table)
                    .cascade()
                    .to_owned(),
            )
            .await?;

        // ---------- auth ----------
        manager
            .create_table(
                Table::create()
                    .table(Auth::Table)
                    .if_not_exists()
                    .col(pk_uuid(Auth::Id))
                    .col(text_uniq(Auth::Username))
                    .col(text(Auth::Password))
                    .col(text_null(Auth::Email))
                    .col(text_null(Auth::Phone))
                    .col(integer_null(Auth::Age))
                    .col(text_null(Auth::Gender))
                    .col(date_null(Auth::Birthday))
                    .col(uuid_null(Auth::Avatar))
                    .col(text(Auth::Role).default("USER"))
                    .col(text(Auth::Status).default("ACTIVE"))
                    .col(timestamp_with_time_zone_null(Auth::ArchivedAt))
                    .col(timestamp_with_time_zone(Auth::CreatedAt))
                    .col(uuid_null(Auth::Creator))
                    .col(timestamp_with_time_zone(Auth::UpdatedAt))
                    .col(uuid_null(Auth::Updater))
                    .col(timestamp_with_time_zone_null(Auth::ExpiresAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_auth_creator")
                            .from(Auth::Table, Auth::Creator)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_auth_updater")
                            .from(Auth::Table, Auth::Updater)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // ---------- asset ----------
        manager
            .create_table(
                Table::create()
                    .table(Asset::Table)
                    .if_not_exists()
                    .col(pk_uuid(Asset::Id))
                    .col(text_null(Asset::TenantId))
                    .col(text_null(Asset::Kind))
                    .col(text(Asset::Hash))
                    .col(text_null(Asset::Sha))
                    .col(big_integer(Asset::Size))
                    .col(big_integer(Asset::Index).default(0))
                    .col(text(Asset::Mime))
                    .col(text_null(Asset::Extension))
                    .col(text(Asset::Name))
                    .col(text(Asset::Status))
                    .col(text(Asset::Visibility).default("PRIVATE"))
                    .col(json_binary_null(Asset::Viewers))
                    .col(integer(Asset::Chunk))
                    .col(integer(Asset::Total))
                    .col(timestamp_with_time_zone_null(Asset::ArchivedAt))
                    .col(timestamp_with_time_zone(Asset::CreatedAt))
                    .col(uuid_null(Asset::Creator))
                    .col(timestamp_with_time_zone(Asset::UpdatedAt))
                    .col(uuid_null(Asset::Updater))
                    .col(timestamp_with_time_zone_null(Asset::ExpiresAt))
                    .col(uuid_null(Asset::Superseded))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_asset_creator")
                            .from(Asset::Table, Asset::Creator)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_asset_updater")
                            .from(Asset::Table, Asset::Updater)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // ---------- chunk ----------
        manager
            .create_table(
                Table::create()
                    .table(Chunk::Table)
                    .if_not_exists()
                    .col(pk_uuid(Chunk::Id))
                    .col(uuid(Chunk::AssetId))
                    .col(integer(Chunk::Index))
                    .col(text(Chunk::Hash))
                    .col(big_integer(Chunk::Size))
                    .col(timestamp_with_time_zone(Chunk::CreatedAt))
                    .col(uuid_null(Chunk::Creator))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_chunk_asset")
                            .from(Chunk::Table, Chunk::AssetId)
                            .to(Asset::Table, Asset::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_chunk_creator")
                            .from(Chunk::Table, Chunk::Creator)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_asset_hash")
                    .table(Asset::Table)
                    .col(Asset::Hash)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_asset_tenant_id")
                    .table(Asset::Table)
                    .col(Asset::TenantId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_asset_creator")
                    .table(Asset::Table)
                    .col(Asset::Creator)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("uidx_chunk_asset_index")
                    .table(Chunk::Table)
                    .col(Chunk::AssetId)
                    .col(Chunk::Index)
                    .unique()
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_chunk_hash")
                    .table(Chunk::Table)
                    .col(Chunk::Hash)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_auth_phone")
                    .table(Auth::Table)
                    .col(Auth::Phone)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // auth ↔ asset 互相引用，故外键在两张表建好后再补
        manager
            .create_foreign_key(
                ForeignKey::create()
                    .name("fk_auth_avatar")
                    .from(Auth::Table, Auth::Avatar)
                    .to(Asset::Table, Asset::Id)
                    .on_delete(ForeignKeyAction::SetNull)
                    .on_update(ForeignKeyAction::Cascade)
                    .to_owned(),
            )
            .await?;

        manager
            .create_foreign_key(
                ForeignKey::create()
                    .name("fk_asset_superseded")
                    .from(Asset::Table, Asset::Superseded)
                    .to(Asset::Table, Asset::Id)
                    .on_delete(ForeignKeyAction::SetNull)
                    .on_update(ForeignKeyAction::Cascade)
                    .to_owned(),
            )
            .await?;

        // ---------- tenant ----------
        // 配额不落库：由「订阅档位 / 免费档 / 全局兜底」表达，见 gateway 模块。
        manager
            .create_table(
                Table::create()
                    .table(Tenant::Table)
                    .if_not_exists()
                    .col(pk_uuid(Tenant::Id))
                    .col(text(Tenant::Name))
                    .col(text_uniq(Tenant::Slug))
                    .col(text(Tenant::Status).default("ACTIVE"))
                    // PERSONAL（个人，走免费/订阅档位）/ TEAM（团队，走全局兜底）
                    .col(text(Tenant::Type).default("PERSONAL"))
                    .col(timestamp_with_time_zone_null(Tenant::ArchivedAt))
                    .col(timestamp_with_time_zone(Tenant::CreatedAt))
                    .col(uuid_null(Tenant::Creator))
                    .col(timestamp_with_time_zone(Tenant::UpdatedAt))
                    .col(uuid_null(Tenant::Updater))
                    .col(timestamp_with_time_zone_null(Tenant::ExpiresAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_tenant_creator")
                            .from(Tenant::Table, Tenant::Creator)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_tenant_updater")
                            .from(Tenant::Table, Tenant::Updater)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // ---------- tenant_member ----------
        manager
            .create_table(
                Table::create()
                    .table(TenantMember::Table)
                    .if_not_exists()
                    .col(pk_uuid(TenantMember::Id))
                    .col(uuid(TenantMember::TenantId))
                    .col(uuid(TenantMember::UserId))
                    .col(text(TenantMember::Role))
                    .col(text(TenantMember::Status).default("ACTIVE"))
                    .col(timestamp_with_time_zone_null(TenantMember::ArchivedAt))
                    .col(timestamp_with_time_zone(TenantMember::CreatedAt))
                    .col(uuid_null(TenantMember::Creator))
                    .col(timestamp_with_time_zone(TenantMember::UpdatedAt))
                    .col(uuid_null(TenantMember::Updater))
                    .col(timestamp_with_time_zone_null(TenantMember::ExpiresAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_tenant_member_tenant")
                            .from(TenantMember::Table, TenantMember::TenantId)
                            .to(Tenant::Table, Tenant::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_tenant_member_user")
                            .from(TenantMember::Table, TenantMember::UserId)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_tenant_member_creator")
                            .from(TenantMember::Table, TenantMember::Creator)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_tenant_member_updater")
                            .from(TenantMember::Table, TenantMember::Updater)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("uidx_tenant_member")
                    .table(TenantMember::Table)
                    .col(TenantMember::TenantId)
                    .col(TenantMember::UserId)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // ---------- subscription ----------
        manager
            .create_table(
                Table::create()
                    .table(Subscription::Table)
                    .if_not_exists()
                    .col(pk_uuid(Subscription::Id))
                    .col(uuid(Subscription::TenantId))
                    .col(text(Subscription::Plan))
                    .col(text(Subscription::Status).default("ACTIVE"))
                    // 到期时间；NULL = 永久有效（生效时间 = createdAt）
                    .col(timestamp_with_time_zone_null(Subscription::ExpiresAt))
                    .col(timestamp_with_time_zone_null(Subscription::ArchivedAt))
                    .col(timestamp_with_time_zone(Subscription::CreatedAt))
                    .col(uuid_null(Subscription::Creator))
                    .col(timestamp_with_time_zone(Subscription::UpdatedAt))
                    .col(uuid_null(Subscription::Updater))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_subscription_tenant")
                            .from(Subscription::Table, Subscription::TenantId)
                            .to(Tenant::Table, Tenant::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_subscription_tenant")
                    .table(Subscription::Table)
                    .col(Subscription::TenantId)
                    .to_owned(),
            )
            .await?;

        // 每个租户同一时刻最多一条 ACTIVE 订阅：业务不变量在 DB 层兜底。
        // SeaORM 的 Index builder 不支持部分索引（WHERE），只能用原始 SQL。
        manager
            .get_connection()
            .execute_unprepared(
                "CREATE UNIQUE INDEX IF NOT EXISTS uidx_subscription_active \
                 ON subscription (\"tenantID\") WHERE status = 'ACTIVE'",
            )
            .await?;

        // ---------- payment_order ----------
        manager
            .create_table(
                Table::create()
                    .table(PaymentOrder::Table)
                    .if_not_exists()
                    .col(pk_uuid(PaymentOrder::Id))
                    .col(text(PaymentOrder::OrderNo))
                    .col(uuid(PaymentOrder::TenantId))
                    .col(uuid(PaymentOrder::UserId))
                    .col(text(PaymentOrder::Plan))
                    .col(text(PaymentOrder::Channel))
                    // 金额（分）：下单时快照，回调核对以此为准
                    .col(big_integer(PaymentOrder::Amount))
                    .col(text(PaymentOrder::Currency).default("CNY"))
                    .col(text(PaymentOrder::Status).default("PENDING"))
                    // 开通时长（天）；NULL = 永久
                    .col(integer_null(PaymentOrder::DurationDays))
                    .col(text_null(PaymentOrder::TransactionId))
                    .col(text_null(PaymentOrder::CodeUrl))
                    .col(uuid_null(PaymentOrder::SubscriptionId))
                    .col(timestamp_with_time_zone_null(PaymentOrder::PaidAt))
                    .col(timestamp_with_time_zone(PaymentOrder::ExpiresAt))
                    .col(text_null(PaymentOrder::Remark))
                    .col(timestamp_with_time_zone_null(PaymentOrder::ArchivedAt))
                    .col(timestamp_with_time_zone(PaymentOrder::CreatedAt))
                    .col(uuid_null(PaymentOrder::Creator))
                    .col(timestamp_with_time_zone(PaymentOrder::UpdatedAt))
                    .col(uuid_null(PaymentOrder::Updater))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_payment_order_tenant")
                            .from(PaymentOrder::Table, PaymentOrder::TenantId)
                            .to(Tenant::Table, Tenant::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_payment_order_user")
                            .from(PaymentOrder::Table, PaymentOrder::UserId)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("uidx_payment_order_no")
                    .table(PaymentOrder::Table)
                    .col(PaymentOrder::OrderNo)
                    .unique()
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_payment_order_tenant")
                    .table(PaymentOrder::Table)
                    .col(PaymentOrder::TenantId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_payment_order_status")
                    .table(PaymentOrder::Table)
                    .col(PaymentOrder::Status)
                    .col(PaymentOrder::ExpiresAt)
                    .to_owned(),
            )
            .await?;

        // ---------- billing_price ----------
        // 模型价目表：网关只记用量（token 数），金额要由计费侧按「用量 × 单价」折算，
        // 所以价格单独成表。取价维度是 `(租户, 型号, 时间)`：
        // `"tenantID" IS NULL` 是平台默认价，非空是该租户的专属价（优先）。
        // 单价单位是**分 / 百万 token**，整数存储：折算只在乘加之后做一次四舍五入，
        // 全程无浮点，避免「0.1 + 0.2」式的对账尾差。
        manager
            .create_table(
                Table::create()
                    .table(BillingPrice::Table)
                    .if_not_exists()
                    .col(pk_uuid(BillingPrice::Id))
                    .col(uuid_null(BillingPrice::TenantId))
                    .col(uuid(BillingPrice::ModelId))
                    // 型号名的写入时快照：报告要显示可读名字，但不做跨能力 JOIN
                    // （网关的 `gateway_model` 可以改名或删除，历史对账不能被它牵动）
                    .col(text(BillingPrice::ModelName))
                    .col(text(BillingPrice::Currency).default("CNY"))
                    .col(big_integer(BillingPrice::InputPricePerMillion))
                    .col(big_integer(BillingPrice::OutputPricePerMillion))
                    // 生效区间 `[effectiveFrom, effectiveTo)`；`effectiveTo` 为 NULL = 至今。
                    // 同一 `(tenantID, modelID)` 的区间不得重叠（应用层校验），缺口即「未定价」，
                    // 会在对账报告里显式列出来，而不是静默按 0 计。
                    .col(timestamp_with_time_zone(BillingPrice::EffectiveFrom))
                    .col(timestamp_with_time_zone_null(BillingPrice::EffectiveTo))
                    .col(timestamp_with_time_zone_null(BillingPrice::ArchivedAt))
                    .col(timestamp_with_time_zone(BillingPrice::CreatedAt))
                    .col(uuid_null(BillingPrice::Creator))
                    .col(timestamp_with_time_zone(BillingPrice::UpdatedAt))
                    .col(uuid_null(BillingPrice::Updater))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_billing_price_tenant")
                            .from(BillingPrice::Table, BillingPrice::TenantId)
                            .to(Tenant::Table, Tenant::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // 取价路径是 `modelID` 等值 + 区间比较，故（型号, 生效时间）联合索引。
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_billing_price_model")
                    .table(BillingPrice::Table)
                    .col(BillingPrice::ModelId)
                    .col(BillingPrice::EffectiveFrom)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_billing_price_tenant")
                    .table(BillingPrice::Table)
                    .col(BillingPrice::TenantId)
                    .to_owned(),
            )
            .await?;

        // ---------- gateway ----------
        manager
            .create_table(
                Table::create()
                    .table(GatewayProvider::Table)
                    .if_not_exists()
                    .col(pk_uuid(GatewayProvider::Id))
                    .col(uuid_null(GatewayProvider::TenantId))
                    .col(text(GatewayProvider::Kind))
                    .col(text(GatewayProvider::Name))
                    .col(text(GatewayProvider::BaseUrl))
                    .col(text(GatewayProvider::ApiKeyEnc).default(""))
                    .col(text(GatewayProvider::Status).default("ACTIVE"))
                    .col(timestamp_with_time_zone_null(GatewayProvider::ArchivedAt))
                    .col(timestamp_with_time_zone(GatewayProvider::CreatedAt))
                    .col(uuid_null(GatewayProvider::Creator))
                    .col(timestamp_with_time_zone(GatewayProvider::UpdatedAt))
                    .col(uuid_null(GatewayProvider::Updater))
                    .col(timestamp_with_time_zone_null(GatewayProvider::ExpiresAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_gateway_provider_creator")
                            .from(GatewayProvider::Table, GatewayProvider::Creator)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_gateway_provider_updater")
                            .from(GatewayProvider::Table, GatewayProvider::Updater)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_gateway_provider_tenant")
                    .table(GatewayProvider::Table)
                    .col(GatewayProvider::TenantId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(GatewayModel::Table)
                    .if_not_exists()
                    .col(pk_uuid(GatewayModel::Id))
                    .col(uuid(GatewayModel::ProviderId))
                    .col(uuid_null(GatewayModel::TenantId))
                    .col(text(GatewayModel::Name))
                    .col(text(GatewayModel::Label))
                    .col(json_binary_null(GatewayModel::AllowRoles))
                    .col(boolean(GatewayModel::Enabled).default(true))
                    .col(big_integer(GatewayModel::DailyTokenQuota).default(0))
                    .col(json_binary_null(GatewayModel::Capabilities))
                    .col(big_integer_null(GatewayModel::ContextWindow))
                    .col(timestamp_with_time_zone_null(GatewayModel::ArchivedAt))
                    .col(timestamp_with_time_zone(GatewayModel::CreatedAt))
                    .col(uuid_null(GatewayModel::Creator))
                    .col(timestamp_with_time_zone(GatewayModel::UpdatedAt))
                    .col(uuid_null(GatewayModel::Updater))
                    .col(timestamp_with_time_zone_null(GatewayModel::ExpiresAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_gateway_model_provider")
                            .from(GatewayModel::Table, GatewayModel::ProviderId)
                            .to(GatewayProvider::Table, GatewayProvider::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_gateway_model_creator")
                            .from(GatewayModel::Table, GatewayModel::Creator)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_gateway_model_updater")
                            .from(GatewayModel::Table, GatewayModel::Updater)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_gateway_model_tenant")
                    .table(GatewayModel::Table)
                    .col(GatewayModel::TenantId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(GatewayUsage::Table)
                    .if_not_exists()
                    .col(pk_uuid(GatewayUsage::Id))
                    .col(uuid_null(GatewayUsage::TenantId))
                    .col(uuid(GatewayUsage::UserId))
                    .col(uuid(GatewayUsage::ProviderId))
                    .col(uuid(GatewayUsage::ModelId))
                    .col(big_integer(GatewayUsage::PromptTokens).default(0))
                    .col(big_integer(GatewayUsage::CompletionTokens).default(0))
                    .col(big_integer(GatewayUsage::TotalTokens).default(0))
                    .col(text(GatewayUsage::Status))
                    .col(big_integer(GatewayUsage::LatencyMs).default(0))
                    .col(timestamp_with_time_zone(GatewayUsage::CreatedAt))
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_gateway_usage_user")
                    .table(GatewayUsage::Table)
                    .col(GatewayUsage::UserId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_gateway_usage_model")
                    .table(GatewayUsage::Table)
                    .col(GatewayUsage::ModelId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_gateway_usage_created")
                    .table(GatewayUsage::Table)
                    .col(GatewayUsage::CreatedAt)
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(GatewayAudit::Table)
                    .if_not_exists()
                    .col(pk_uuid(GatewayAudit::Id))
                    .col(uuid_null(GatewayAudit::TenantId))
                    .col(uuid(GatewayAudit::Actor))
                    .col(text(GatewayAudit::Action))
                    .col(text(GatewayAudit::Resource))
                    .col(json_binary_null(GatewayAudit::Detail))
                    .col(text_null(GatewayAudit::Ip))
                    .col(timestamp_with_time_zone(GatewayAudit::CreatedAt))
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_gateway_audit_actor")
                    .table(GatewayAudit::Table)
                    .col(GatewayAudit::Actor)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_gateway_audit_created")
                    .table(GatewayAudit::Table)
                    .col(GatewayAudit::CreatedAt)
                    .to_owned(),
            )
            .await?;

        // ---------- sso_connection ----------
        manager
            .create_table(
                Table::create()
                    .table(SsoConnection::Table)
                    .if_not_exists()
                    .col(pk_uuid(SsoConnection::Id))
                    .col(uuid(SsoConnection::TenantId))
                    .col(text(SsoConnection::Provider))
                    .col(text(SsoConnection::Issuer))
                    .col(text(SsoConnection::ClientId))
                    .col(text(SsoConnection::ClientSecretEnc).default(""))
                    .col(text(SsoConnection::RedirectUri))
                    .col(text(SsoConnection::Status).default("ACTIVE"))
                    .col(timestamp_with_time_zone_null(SsoConnection::ArchivedAt))
                    .col(timestamp_with_time_zone(SsoConnection::CreatedAt))
                    .col(uuid_null(SsoConnection::Creator))
                    .col(timestamp_with_time_zone(SsoConnection::UpdatedAt))
                    .col(uuid_null(SsoConnection::Updater))
                    .col(timestamp_with_time_zone_null(SsoConnection::ExpiresAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_sso_connection_tenant")
                            .from(SsoConnection::Table, SsoConnection::TenantId)
                            .to(Tenant::Table, Tenant::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_sso_connection_creator")
                            .from(SsoConnection::Table, SsoConnection::Creator)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_sso_connection_updater")
                            .from(SsoConnection::Table, SsoConnection::Updater)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // ---------- console_preference（Backend Console 布局偏好） ----------
        // 平台运维面专用：一名 ADMIN 一行。无租户面，RLS 恒假，读写走 PlatformScope。
        manager
            .create_table(
                Table::create()
                    .table(ConsolePreference::Table)
                    .if_not_exists()
                    .col(pk_uuid(ConsolePreference::Id))
                    .col(uuid(ConsolePreference::UserId))
                    .col(json_binary(ConsolePreference::NavOrder))
                    .col(json_binary(ConsolePreference::PinnedNav))
                    .col(json_binary(ConsolePreference::DashboardWidgets))
                    .col(json_binary(ConsolePreference::Bookmarks))
                    .col(timestamp_with_time_zone(ConsolePreference::CreatedAt))
                    .col(uuid_null(ConsolePreference::Creator))
                    .col(timestamp_with_time_zone(ConsolePreference::UpdatedAt))
                    .col(uuid_null(ConsolePreference::Updater))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_console_preference_user")
                            .from(ConsolePreference::Table, ConsolePreference::UserId)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_console_preference_creator")
                            .from(ConsolePreference::Table, ConsolePreference::Creator)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_console_preference_updater")
                            .from(ConsolePreference::Table, ConsolePreference::Updater)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("uidx_console_preference_user")
                    .table(ConsolePreference::Table)
                    .col(ConsolePreference::UserId)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // ---------- exception（客户端异常上报） ----------
        // 平台运维面专用：无租户面，RLS 恒假，读写走 PlatformScope。
        // 事件不可变（无 updatedAt）；可选 creator 记录已登录上报者。
        manager
            .create_table(
                Table::create()
                    .table(Exception::Table)
                    .if_not_exists()
                    .col(pk_uuid(Exception::Id))
                    .col(text_uniq(Exception::EventId))
                    .col(text(Exception::Fingerprint))
                    .col(text(Exception::Source))
                    .col(text(Exception::Level).default("error"))
                    .col(text(Exception::Message))
                    .col(text_null(Exception::Stack))
                    .col(integer_null(Exception::Status))
                    .col(text_null(Exception::Method))
                    .col(text(Exception::Url))
                    .col(text_null(Exception::ReqId))
                    .col(text_null(Exception::Ip))
                    .col(text_null(Exception::UserAgent))
                    .col(text_null(Exception::UserId))
                    .col(text_null(Exception::Environment))
                    .col(text_null(Exception::Release))
                    .col(json_binary_null(Exception::Context))
                    .col(big_integer(Exception::Timestamp))
                    .col(timestamp_with_time_zone(Exception::ReceivedAt))
                    .col(uuid_null(Exception::Creator))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_exception_creator")
                            .from(Exception::Table, Exception::Creator)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_exception_received_at")
                    .table(Exception::Table)
                    .col(Exception::ReceivedAt)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_exception_fingerprint")
                    .table(Exception::Table)
                    .col(Exception::Fingerprint)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_exception_source_level")
                    .table(Exception::Table)
                    .col(Exception::Source)
                    .col(Exception::Level)
                    .to_owned(),
            )
            .await?;

        // ---------- outbox（事务性发件箱） ----------
        // 与聚合变更同事务写入，P4 的发布器只搬运、不判定业务；写入方是业务事务，读取方是特权连接。
        manager
            .create_table(
                Table::create()
                    .table(Outbox::Table)
                    .if_not_exists()
                    .col(pk_uuid(Outbox::Id))
                    // 单调递增序号：给消费者全局全序（时间戳会因时钟回拨产生并列）
                    .col(big_integer(Outbox::Seq).auto_increment())
                    // 聚合名（如 "subscription"），配合 aggregateID 构成分区键
                    .col(text(Outbox::Aggregate))
                    .col(uuid(Outbox::AggregateId))
                    // 不可变过去式事件名（如 "subscription.renewed"）
                    .col(text(Outbox::EventType))
                    .col(integer(Outbox::SchemaVersion))
                    .col(json_binary(Outbox::Payload))
                    .col(text_null(Outbox::Traceparent))
                    .col(uuid_null(Outbox::TenantId))
                    .col(timestamp_with_time_zone(Outbox::CreatedAt))
                    .col(timestamp_with_time_zone_null(Outbox::PublishedAt))
                    // 已投递尝试次数与最近一次失败原因：只用于可观测与退避判断，
                    // 不改变「至少一次」语义（去重永远靠事件的 id）
                    .col(integer(Outbox::Attempts).default(0))
                    .col(text_null(Outbox::LastError))
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_outbox_unpublished")
                    .table(Outbox::Table)
                    .col(Outbox::Seq)
                    .and_where(Expr::col(Outbox::PublishedAt).is_null())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_outbox_aggregate")
                    .table(Outbox::Table)
                    .col(Outbox::Aggregate)
                    .col(Outbox::AggregateId)
                    .col(Outbox::Seq)
                    .to_owned(),
            )
            .await?;

        // ---------- consumed_event（消费幂等去重） ----------
        manager
            .create_table(
                Table::create()
                    .table(ConsumedEvent::Table)
                    .if_not_exists()
                    // 消费者标识（服务名/进程组），与 eventID 一起构成幂等键
                    .col(text(ConsumedEvent::Consumer))
                    .col(uuid(ConsumedEvent::EventId))
                    .col(timestamp_with_time_zone(ConsumedEvent::ConsumedAt))
                    .primary_key(
                        Index::create()
                            .name("pk_consumed_event")
                            .col(ConsumedEvent::Consumer)
                            .col(ConsumedEvent::EventId),
                    )
                    .to_owned(),
            )
            .await?;

        // ---------- agent_task（服务端 agent 台账） ----------
        // 「谁在哪个租户下起了一次什么任务」的唯一记录。编排实例历史在 durable 自己的 schema 里，
        // 模型用量在 gateway_usage / gateway_audit —— 这里只留台账，不重复别人的事实。
        manager
            .create_table(
                Table::create()
                    .table(AgentTask::Table)
                    .if_not_exists()
                    .col(pk_uuid(AgentTask::Id))
                    .col(uuid(AgentTask::TenantId))
                    // 发起人；服务身份（无会话）触发时为空
                    .col(uuid_null(AgentTask::UserId))
                    // RUNNING / SUCCEEDED / FAILED（词汇见 crates/agent）
                    .col(text(AgentTask::Status).default("RUNNING"))
                    .col(text(AgentTask::Objective))
                    .col(text(AgentTask::Model))
                    .col(integer(AgentTask::MaxSteps))
                    // 工具白名单；空数组 = 不给工具（与「没记录」不同，故非空）
                    .col(json_binary(AgentTask::AllowedTools))
                    // 编排实例标识（`agent-{id}`）
                    .col(text(AgentTask::InstanceId))
                    .col(integer(AgentTask::Steps).default(0))
                    // 终态输出快照
                    .col(json_binary_null(AgentTask::Result))
                    // 终态失败原因
                    .col(text_null(AgentTask::Error))
                    .col(timestamp_with_time_zone(AgentTask::CreatedAt))
                    .col(timestamp_with_time_zone(AgentTask::UpdatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_agent_task_tenant")
                            .from(AgentTask::Table, AgentTask::TenantId)
                            .to(Tenant::Table, Tenant::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_agent_task_user")
                            .from(AgentTask::Table, AgentTask::UserId)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_agent_task_tenant")
                    .table(AgentTask::Table)
                    .col(AgentTask::TenantId)
                    .col(AgentTask::CreatedAt)
                    .to_owned(),
            )
            .await?;

        // ---------- agent_approval（审批台账：人做的决定） ----------
        // 记的是**人做了什么**，不是「最后怎么了」：最后结局在 agent_task.result 的
        // `approvals[]` 快照里（工具执行失败、决定送晚了而算超时，都只改结局不改这条记录），
        // 两者一比对就能看出「批了但没赶上」这类裂缝。
        //
        // 主键是编排确定性生成的审批标识（`<taskID>:<步骤>:<第几次调用>`）而不是代理键：
        // 同一次调用天然只有一行，重复提交靠主键撞上既有行来识别（同决定=补投，异决定=拒绝）。
        manager
            .create_table(
                Table::create()
                    .table(AgentApproval::Table)
                    .if_not_exists()
                    .col(text(AgentApproval::Id).primary_key())
                    .col(uuid(AgentApproval::TenantId))
                    // 所属任务：任务没了，它的审批记录也没有独立意义
                    .col(uuid(AgentApproval::TaskId))
                    .col(integer(AgentApproval::Step))
                    .col(text(AgentApproval::Tool))
                    // 参数原文，不解析成 jsonb：解析失败不该让「人批过什么」落不了库
                    .col(text(AgentApproval::Arguments))
                    // APPROVED / REJECTED（人的两种决定；EXPIRED 是编排的结局，不落这张表）
                    .col(text(AgentApproval::State))
                    .col(uuid_null(AgentApproval::DecidedBy))
                    .col(timestamp_with_time_zone(AgentApproval::DecidedAt))
                    .col(text_null(AgentApproval::Reason))
                    // 这次待办的逾期时间（编排给的）
                    .col(timestamp_with_time_zone(AgentApproval::ExpiresAt))
                    // 决定送进编排邮箱的时刻；NULL = 已提交但还没送达
                    .col(timestamp_with_time_zone_null(AgentApproval::AppliedAt))
                    .col(timestamp_with_time_zone(AgentApproval::CreatedAt))
                    .col(timestamp_with_time_zone(AgentApproval::UpdatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_agent_approval_tenant")
                            .from(AgentApproval::Table, AgentApproval::TenantId)
                            .to(Tenant::Table, Tenant::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_agent_approval_task")
                            .from(AgentApproval::Table, AgentApproval::TaskId)
                            .to(AgentTask::Table, AgentTask::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_agent_approval_decider")
                            .from(AgentApproval::Table, AgentApproval::DecidedBy)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_agent_approval_task")
                    .table(AgentApproval::Table)
                    .col(AgentApproval::TaskId)
                    .col(AgentApproval::DecidedAt)
                    .to_owned(),
            )
            .await?;

        // ---------- rag_index_task（RAG 索引任务台账） ----------
        // 「哪个租户的哪份资产正在/曾经被索引」的唯一记录。切块与向量在 compute 的库里，
        // 编排实例历史在 durable 自己的 schema 里 —— 这里只留台账，不重复别人的事实。
        manager
            .create_table(
                Table::create()
                    .table(RagIndexTask::Table)
                    .if_not_exists()
                    .col(pk_uuid(RagIndexTask::Id))
                    .col(uuid(RagIndexTask::TenantId))
                    // 发起人；服务身份（无会话）触发时为空
                    .col(uuid_null(RagIndexTask::UserId))
                    // 被索引的资产。资产是本表的输入而非所有者，子资源形态（同一资产可多次重建索引）
                    .col(uuid(RagIndexTask::AssetId))
                    // RUNNING / SUCCEEDED / FAILED（词汇见 crates/rag）
                    .col(text(RagIndexTask::Status).default("RUNNING"))
                    // 编排实例标识（`rag-index-{id}`）
                    .col(text(RagIndexTask::InstanceId))
                    // 终态输出快照（IndexAssetOutput）
                    .col(json_binary_null(RagIndexTask::Result))
                    // 终态失败原因
                    .col(text_null(RagIndexTask::Error))
                    .col(timestamp_with_time_zone(RagIndexTask::CreatedAt))
                    .col(timestamp_with_time_zone(RagIndexTask::UpdatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_rag_index_task_tenant")
                            .from(RagIndexTask::Table, RagIndexTask::TenantId)
                            .to(Tenant::Table, Tenant::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_rag_index_task_asset")
                            .from(RagIndexTask::Table, RagIndexTask::AssetId)
                            .to(Asset::Table, Asset::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_rag_index_task_user")
                            .from(RagIndexTask::Table, RagIndexTask::UserId)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_rag_index_task_tenant")
                    .table(RagIndexTask::Table)
                    .col(RagIndexTask::TenantId)
                    .col(RagIndexTask::CreatedAt)
                    .to_owned(),
            )
            .await?;

        // 同一租户的同一资产同时只能有一个在跑的索引任务。SeaORM 的 Index builder 表达不了
        // 部分索引（WHERE），只能用原始 SQL —— 与 uidx_subscription_active 同一理由。
        manager
            .get_connection()
            .execute_unprepared(
                r#"CREATE UNIQUE INDEX IF NOT EXISTS uidx_rag_index_task_running
                   ON rag_index_task ("tenantID", "assetID") WHERE status = 'RUNNING'"#,
            )
            .await?;

        // ---------- chat_*（客户端会话/消息/用量的同步面） ----------
        // 本地为主、服务端只负责「接住并单调编号」：这里没有业务解读（消息内容是不透明的），
        // 只有 `revision` 这一份服务端独占的事实，它是增量拉取的游标。
        manager
            .create_table(
                Table::create()
                    .table(ChatSession::Table)
                    .if_not_exists()
                    .col(pk_uuid(ChatSession::Id))
                    .col(uuid(ChatSession::TenantId))
                    // 创建者；同步由本人发起时非空
                    .col(uuid_null(ChatSession::UserId))
                    .col(text(ChatSession::Title))
                    .col(boolean(ChatSession::Pinned).default(false))
                    // 客户端的工作区标识（服务端不解读）
                    .col(text_null(ChatSession::WorkspaceId))
                    // 服务端分配的同步水位
                    .col(big_integer(ChatSession::Revision))
                    // 客户端改写时间（毫秒，本地时钟）
                    .col(big_integer(ChatSession::ClientUpdatedAt))
                    // 删除墓碑（客户端毫秒）；非空即已删，行不真删
                    .col(big_integer_null(ChatSession::ArchivedAt))
                    .col(timestamp_with_time_zone(ChatSession::CreatedAt))
                    .col(timestamp_with_time_zone(ChatSession::UpdatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_chat_session_tenant")
                            .from(ChatSession::Table, ChatSession::TenantId)
                            .to(Tenant::Table, Tenant::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_chat_session_user")
                            .from(ChatSession::Table, ChatSession::UserId)
                            .to(Auth::Table, Auth::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(ChatMessage::Table)
                    .if_not_exists()
                    .col(pk_uuid(ChatMessage::Id))
                    .col(uuid(ChatMessage::TenantId))
                    .col(uuid(ChatMessage::SessionId))
                    // 父消息；**不做外键**：消息逐批同步，父行可能落在别的批次，
                    // 拿外键拦住整批不值得，树的形状交给客户端校验
                    .col(uuid_null(ChatMessage::ParentId))
                    // 内容格式标识（如 ith/thread-message-like）
                    .col(text(ChatMessage::Format))
                    // 内容原文；服务端不解析
                    .col(text(ChatMessage::Content))
                    // 客户端生成时间（毫秒）：展示与排序的基准，避免多设备时钟各说各话
                    .col(big_integer(ChatMessage::ClientCreatedAt))
                    .col(big_integer(ChatMessage::Revision))
                    .col(big_integer_null(ChatMessage::ArchivedAt))
                    .col(timestamp_with_time_zone(ChatMessage::CreatedAt))
                    .col(timestamp_with_time_zone(ChatMessage::UpdatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_chat_message_tenant")
                            .from(ChatMessage::Table, ChatMessage::TenantId)
                            .to(Tenant::Table, Tenant::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_chat_message_session")
                            .from(ChatMessage::Table, ChatMessage::SessionId)
                            .to(ChatSession::Table, ChatSession::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(ChatUsage::Table)
                    .if_not_exists()
                    .col(pk_uuid(ChatUsage::Id))
                    .col(uuid(ChatUsage::TenantId))
                    // 所属会话；**不做外键**：用量是账本，会话行缺失不该让整批落不了库
                    .col(uuid_null(ChatUsage::SessionId))
                    // 运行标识；与 tenantID 一起构成幂等键
                    .col(text(ChatUsage::RunId))
                    .col(text_null(ChatUsage::ProviderId))
                    .col(text_null(ChatUsage::Model))
                    .col(text_null(ChatUsage::Source))
                    .col(text_null(ChatUsage::Outcome))
                    // token 数；未上报为 NULL（与 0 不同）
                    .col(integer_null(ChatUsage::InputTokens))
                    .col(integer_null(ChatUsage::OutputTokens))
                    .col(integer_null(ChatUsage::TotalTokens))
                    .col(big_integer(ChatUsage::ClientCreatedAt))
                    .col(big_integer(ChatUsage::Revision))
                    .col(timestamp_with_time_zone(ChatUsage::CreatedAt))
                    .col(timestamp_with_time_zone(ChatUsage::UpdatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_chat_usage_tenant")
                            .from(ChatUsage::Table, ChatUsage::TenantId)
                            .to(Tenant::Table, Tenant::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // 同步批次台账：幂等凭据 + 该批占用的水位。表行本身就是「这批已经处理过」的证据，
        // 重发同批时直接回放它记下的 revision / applied，不再动任何数据行。
        manager
            .create_table(
                Table::create()
                    .table(ChatSyncBatch::Table)
                    .if_not_exists()
                    .col(uuid(ChatSyncBatch::TenantId))
                    // 客户端生成的批次标识
                    .col(text(ChatSyncBatch::ClientBatchId))
                    .col(big_integer(ChatSyncBatch::Revision))
                    // 本批写入的行数（含墓碑）
                    .col(integer(ChatSyncBatch::Applied).default(0))
                    // 本批冲突快照；重发回放用，避免丢失 conflicts
                    .col(json_binary_null(ChatSyncBatch::Conflicts))
                    .col(timestamp_with_time_zone(ChatSyncBatch::CreatedAt))
                    .primary_key(
                        Index::create()
                            .name("pk_chat_sync_batch")
                            .col(ChatSyncBatch::TenantId)
                            .col(ChatSyncBatch::ClientBatchId),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_chat_sync_batch_tenant")
                            .from(ChatSyncBatch::Table, ChatSyncBatch::TenantId)
                            .to(Tenant::Table, Tenant::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // 增量拉取都是「租户 + 水位上升序」，三张表各配一条同样的索引
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_chat_session_revision")
                    .table(ChatSession::Table)
                    .col(ChatSession::TenantId)
                    .col(ChatSession::Revision)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_chat_message_revision")
                    .table(ChatMessage::Table)
                    .col(ChatMessage::TenantId)
                    .col(ChatMessage::Revision)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_chat_usage_revision")
                    .table(ChatUsage::Table)
                    .col(ChatUsage::TenantId)
                    .col(ChatUsage::Revision)
                    .to_owned(),
            )
            .await?;

        // 按会话读消息（客户端导出 / 单会话重建）走（会话, 客户端时间）
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_chat_message_session")
                    .table(ChatMessage::Table)
                    .col(ChatMessage::SessionId)
                    .col(ChatMessage::ClientCreatedAt)
                    .to_owned(),
            )
            .await?;

        // 同一次运行只记一笔：重发（客户端重试、多设备同时上报）靠这个唯一索引收敛
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("uidx_chat_usage_run")
                    .table(ChatUsage::Table)
                    .col(ChatUsage::TenantId)
                    .col(ChatUsage::RunId)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // 水位在租户内唯一：两个并发批次撞上同一个水位时，后到的那个（23505）重试即可
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("uidx_chat_sync_batch_revision")
                    .table(ChatSyncBatch::Table)
                    .col(ChatSyncBatch::TenantId)
                    .col(ChatSyncBatch::Revision)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // ---------- 租户隔离（RLS） ----------
        // 隔离从"调用约定"下沉为数据库机制：应用角色即便漏传条件也拿不到别人的行。
        for (function, setting) in [
            ("app_current_tenant_id", TENANT_SETTING),
            ("app_current_user_id", USER_SETTING),
            ("app_current_sso_connection_id", SSO_CONNECTION_SETTING),
        ] {
            manager
                .get_connection()
                .execute_unprepared(&scope_reader(function, setting))
                .await?;
        }

        manager
            .get_connection()
            .execute_unprepared(&text_scope_reader(
                "app_current_asset_hash",
                ASSET_HASH_SETTING,
            ))
            .await?;

        // 严格隔离：只见本租户行；"tenantID" 为 NULL 的行不属于任何租户作用域
        for table in STRICT_TENANT_TABLES {
            enable_rls(
                manager,
                table,
                r#""tenantID" = app_current_tenant_id()"#,
                r#""tenantID" = app_current_tenant_id()"#,
            )
            .await?;
        }

        // 用量与审计允许落在**没有租户**的账号上：新账号尚未建租户时走全局配额，
        // 这些行的 "tenantID" 为 NULL，严格租户策略下既读不到也写不进。
        // 因此额外放开「自己那一份」：`"tenantID" IS NULL` 且行归属当前账号（`userID` / `actor`）。
        // 两个方向都只放宽到本人：别人的无租户行照旧不可见、不可写，租户作用域也看不到它们。
        for (table, owner_column) in [
            ("gateway_usage", r#""userID""#),
            ("gateway_audit", r#""actor""#),
        ] {
            let clause = format!(
                r#""tenantID" = app_current_tenant_id()
                   OR ("tenantID" IS NULL AND {owner_column} = app_current_user_id())"#
            );
            enable_rls(manager, table, &clause, &clause).await?;
        }

        // 订单表在严格隔离之上多一条**能力键**分支：支付渠道回调是匿名端点，没有会话，
        // 只有一个由渠道回传、等价于一次性凭证的订单号，因此必须先用订单号反解出租户。
        // 该分支只放宽 `USING`（且只放行那一行**未归档**订单的可见性），`WITH CHECK` 仍是租户限定：
        // 拿到订单号也写不进任何一行，写入照旧必须先建立租户作用域。
        // 反解不到（订单号未知 / 已归档 / 变量未设置）时 `current_setting(..., true)` 为 NULL，
        // 条件恒不成立——fail-closed。
        let payment_order_using = format!(
            r#""tenantID" = app_current_tenant_id()
               OR ("orderNo" = current_setting('{ORDER_SETTING}', true) AND "archivedAt" IS NULL)"#
        );
        enable_rls(
            manager,
            "payment_order",
            &payment_order_using,
            r#""tenantID" = app_current_tenant_id()"#,
        )
        .await?;

        // 成员关系额外允许"只读自己"：未进入任何租户时，账号作用域仍能列出自己的成员关系
        // （`/tenants` 需要它）；写入一律要求租户作用域。
        enable_rls(
            manager,
            "tenant_member",
            r#""tenantID" = app_current_tenant_id() OR "userID" = app_current_user_id()"#,
            r#""tenantID" = app_current_tenant_id()"#,
        )
        .await?;

        // SSO 连接比严格租户隔离多一条**能力键**分支：OIDC 的 authorize / callback 是匿名端点
        // ——浏览器从第三方 IdP 跳回来时没有我们的会话，唯一能当凭证的就是回调地址里的连接 id。
        // 该分支只放宽 `USING`（且只放行那一行**未归档**连接），`WITH CHECK` 仍是租户限定：
        // 拿到连接 id 也写不进任何一行，后台管理面照旧走平台特权通道。
        // 变量未设置（或不是 uuid）时读取器返回 NULL，条件恒不成立——fail-closed。
        let sso_connection_using = format!(
            r#""tenantID" = app_current_tenant_id()
               OR ("id" = app_current_sso_connection_id() AND "archivedAt" IS NULL)"#
        );
        enable_rls(
            manager,
            "sso_connection",
            &sso_connection_using,
            r#""tenantID" = app_current_tenant_id()"#,
        )
        .await?;

        // asset 是**内容寻址**的资源：同一份字节被多个账号各自持有一行（秒传克隆），
        // 所以它的可见性不是「一个租户一份」，而要按四条通道分层：
        //   1. 创建者永远看得见自己的行（上传会话、我的文件、下载自己的文件）；
        //   2. 同租户（`"tenantID"` 是 text 历史列型，比较时显式转型）；
        //   3. 公开分发（`PUBLIC`）对匿名可读，也是唯一对匿名开放的分支；
        //   4. 白名单分发（`RESTRICTED`）额外放行 `viewers` 里点到名的账号
        //      （`viewers` 是 uuid 字符串数组，`?` 判定数组成员）。
        // 再加一条**能力键**分支给秒传：跨账号读到同一份内容必须靠 hash，
        // 所以只有 hash 命中且那一行 `COMPLETED` 时才借出；未完成会话照旧读不到
        // （否则猜到 hash 的人就能续传别人的上传会话）。变量未设置时读取器返回 NULL，
        // 条件恒不成立——fail-closed。
        // `WITH CHECK` 只认创建者：任何写入都必须是「我自己的行」。秒传克隆出来的副本
        // `"tenantID"` 为 NULL，租户分支写不进去，创建者分支才写得进。
        let asset_using = r#""creator" = app_current_user_id()
               OR "tenantID" = app_current_tenant_id()::text
               OR "visibility" = 'PUBLIC'
               OR "viewers" ? app_current_user_id()::text
               OR ("hash" = app_current_asset_hash() AND "status" = 'COMPLETED')"#;
        enable_rls(
            manager,
            "asset",
            asset_using,
            r#""creator" = app_current_user_id()"#,
        )
        .await?;

        // 全局目录：内置行（"tenantID" IS NULL）对所有租户可见；WITH CHECK 只放行本租户行，
        // 应用角色因此无法在租户作用域内新建全局行（全局行的写入属于特权连接）
        for table in ["gateway_provider", "gateway_model"] {
            enable_rls(
                manager,
                table,
                r#""tenantID" IS NULL OR "tenantID" = app_current_tenant_id()"#,
                r#""tenantID" = app_current_tenant_id()"#,
            )
            .await?;
        }

        // 价目表与上面两张目录表不同：它**没有任何租户面**。
        // 价格是商业信息，租户作用域既不该读到（否则租户能反推别人的专属价与成本），
        // 也不该写到（改写价格 = 改写账单口径）。因此策略恒假：租户面 fail-closed，
        // 读写一律走平台特权连接（`cogito_platform`，BYPASSRLS）。
        enable_rls(manager, "billing_price", "false", "false").await?;

        // Backend Console 偏好：同样无租户面，只允许平台特权读写。
        enable_rls(manager, "console_preference", "false", "false").await?;

        // 异常事件：平台运维观测台；租户面 fail-closed，读写一律走 PlatformScope。
        enable_rls(manager, "exception", "false", "false").await?;

        // tenant 自身按主键隔离：只能读写自己那一行；新建租户时作用域就是新租户 id，
        // 因此插入能自洽通过 WITH CHECK（创建者随后在同一事务里补上 OWNER 成员行）。
        // 额外允许"只读自己加入的租户"：账号作用域下可按 id 读回自己的租户行（列表页需要）。
        enable_rls(
            manager,
            "tenant",
            r#"id = app_current_tenant_id()
               OR id IN (
                   SELECT "tenantID" FROM tenant_member
                   WHERE "userID" = app_current_user_id() AND status = 'ACTIVE'
               )"#,
            "id = app_current_tenant_id()",
        )
        .await?;

        // 特权通道的角色也在这里就位（超级用户迁移账号下自建；否则只告警）
        ensure_platform_role(manager).await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .if_exists()
                    .table(Outbox::Table)
                    .table(ConsumedEvent::Table)
                    .table(AgentTask::Table)
                    .table(RagIndexTask::Table)
                    .table(ChatSyncBatch::Table)
                    .table(ChatUsage::Table)
                    .table(ChatMessage::Table)
                    .table(ChatSession::Table)
                    .table(SsoConnection::Table)
                    .table(ConsolePreference::Table)
                    .table(PaymentOrder::Table)
                    .table(BillingPrice::Table)
                    .table(Subscription::Table)
                    .table(GatewayAudit::Table)
                    .table(GatewayUsage::Table)
                    .table(GatewayModel::Table)
                    .table(GatewayProvider::Table)
                    .table(TenantMember::Table)
                    .table(Tenant::Table)
                    .table(Chunk::Table)
                    .table(Asset::Table)
                    .table(Auth::Table)
                    .cascade()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

/// 会话级作用域变量名。
///
/// 必须与 `cogito::databases::scope` 的常量一致（迁移 crate 不能依赖 service）；
/// 两边一旦漂移，隔离用例会立刻失败。
const TENANT_SETTING: &str = "app.tenant_id";
const USER_SETTING: &str = "app.user_id";
/// 支付回调的能力键（订单号）作用域变量：只被 `payment_order` 的只读分支识别。
const ORDER_SETTING: &str = "app.order_no";
/// 内容寻址（秒传）的能力键作用域变量：文件 hash。
///
/// 只被 `asset` 的只读分支识别，且只借出 hash 命中那一行**已完成**资产：
/// 同一份字节被多个账号各自持有一行，秒传必须先看到内容才知道要克隆什么。
const ASSET_HASH_SETTING: &str = "app.asset_hash";
/// SSO 登录流程的能力键作用域变量：SSO 连接 id。
///
/// OIDC 的 authorize / callback 是**匿名**端点（浏览器从第三方 IdP 跳回来，没有我们的会话），
/// 只有回调地址里的连接 id 可以当凭证用：它只借出那一行未归档连接，写入仍要求租户作用域。
const SSO_CONNECTION_SETTING: &str = "app.sso_connection_id";
/// 平台运维角色：唯一一条绕过行级策略的通道。
///
/// 必须与 `cogito::databases::scope::PLATFORM_ROLE` 一致（迁移 crate 不能依赖 service）。
const PLATFORM_ROLE: &str = "cogito_platform";

/// 作用域的读取器：未设置或不是合法 uuid 时一律返回 `NULL`（fail-closed）。
///
/// `STABLE` 保证同语句内多次引用只求值一次，并允许调用方在事务内用
/// `set_config('<setting>', $1, true)` 设定作用域。
fn scope_reader(function: &str, setting: &str) -> String {
    format!(
        r#"CREATE OR REPLACE FUNCTION {function}() RETURNS uuid
LANGUAGE sql STABLE AS $fn$
    SELECT CASE
        WHEN current_setting('{setting}', true)
             ~ '^[0-9a-fA-F]{{8}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{12}}$'
        THEN current_setting('{setting}', true)::uuid
        ELSE NULL
    END
$fn$"#
    )
}

/// 文本型能力键的读取器：未设置或不是 64 位十六进制时一律返回 `NULL`（fail-closed）。
///
/// 与 [`scope_reader`] 分开是必须的：hash 不是 uuid，用 uuid 读取器会永远读不出来，
/// 而把 `scope_reader` 改成文本又会破坏 `"tenantID" = app_current_tenant_id()`（uuid 列）的比较。
fn text_scope_reader(function: &str, setting: &str) -> String {
    format!(
        r#"CREATE OR REPLACE FUNCTION {function}() RETURNS text
LANGUAGE sql STABLE AS $fn$
    SELECT CASE
        WHEN current_setting('{setting}', true) ~ '^[0-9a-fA-F]{{64}}$'
        THEN current_setting('{setting}', true)
        ELSE NULL
    END
$fn$"#
    )
}

/// 严格按 `"tenantID" = app_current_tenant_id()` 隔离的表。
///
/// 不在其中的表都另有分支，见 `up()`：
/// - `tenant_member`："只读自己"（账号作用域下列出自己的成员关系）；
/// - `payment_order`：按订单号（能力键）反解租户的只读分支；
/// - `sso_connection`：按连接 id（能力键）读回匿名 OIDC 流程的那一行；
/// - `gateway_usage` / `gateway_audit`：无租户行的归属分支（NULL 租户 + 本人）。
const STRICT_TENANT_TABLES: [&str; 9] = [
    "subscription",
    "outbox",
    "agent_task",
    "agent_approval",
    "rag_index_task",
    // 同步面：会话 / 消息 / 用量 / 批次台账都只属于一个租户，没有全局行也没有能力键分支
    "chat_session",
    "chat_message",
    "chat_usage",
    "chat_sync_batch",
];

/// 逐表启用行级安全：`ENABLE` 约束普通角色，`FORCE` 连表属主一起约束，
/// 单角色直连部署下也不会失效；策略用固定名，重跑时可先删后建。
async fn enable_rls(
    manager: &SchemaManager<'_>,
    table: &str,
    using: &str,
    with_check: &str,
) -> Result<(), DbErr> {
    let conn = manager.get_connection();
    // sqlx 扩展协议不接受多语句，逐条执行
    let statements = [
        format!("ALTER TABLE {table} ENABLE ROW LEVEL SECURITY"),
        format!("ALTER TABLE {table} FORCE ROW LEVEL SECURITY"),
        format!("DROP POLICY IF EXISTS tenant_isolation ON {table}"),
        format!(
            "CREATE POLICY tenant_isolation ON {table} USING ({using}) WITH CHECK ({with_check})"
        ),
    ];
    for statement in statements {
        conn.execute_unprepared(&statement).await?;
    }
    Ok(())
}

/// 就位平台运维角色（`BYPASSRLS` 只能由超级用户授予，因此这里是**尽力而为**）。
///
/// 顺序：角色不存在则创建（`NOLOGIN`：只能被 `SET ROLE` 进入，不能独立登录）→
/// 迁移账号还不是它的成员则补授权 → 授予表权限（`SET ROLE` 之后权限判定用的是该角色**自己**的权限）。
/// 任何一步因权限不足失败都只告警：运维面会明确报错，租户面不受影响；
/// 生产环境通常由 DBA 预先执行同样的语句（见 `guide/database.md`）。
async fn ensure_platform_role(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    let statement = format!(
        r#"DO $do$
BEGIN
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{PLATFORM_ROLE}') THEN
            EXECUTE 'CREATE ROLE {PLATFORM_ROLE} NOLOGIN BYPASSRLS';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM pg_auth_members m
            JOIN pg_roles r ON r.oid = m.roleid
            WHERE r.rolname = '{PLATFORM_ROLE}'
              AND m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
        ) THEN
            EXECUTE format('GRANT {PLATFORM_ROLE} TO %I', current_user);
        END IF;
        EXECUTE 'GRANT USAGE ON SCHEMA public TO {PLATFORM_ROLE}';
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {PLATFORM_ROLE}';
        EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {PLATFORM_ROLE}';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE WARNING '平台角色 {PLATFORM_ROLE} 未就位（权限不足）：运维面不可用，请由超级用户创建该角色并授予应用角色';
    END;
END
$do$"#
    );

    manager
        .get_connection()
        .execute_unprepared(&statement)
        .await?;
    Ok(())
}

#[derive(DeriveIden)]
enum Auth {
    Table,
    Id,
    Username,
    Password,
    Email,
    Phone,
    Age,
    Gender,
    Birthday,
    Avatar,
    Role,
    Status,
    #[sea_orm(iden = "archivedAt")]
    ArchivedAt,
    #[sea_orm(iden = "createdAt")]
    CreatedAt,
    Creator,
    #[sea_orm(iden = "updatedAt")]
    UpdatedAt,
    Updater,
    #[sea_orm(iden = "expiresAt")]
    ExpiresAt,
}

#[derive(DeriveIden)]
enum Asset {
    Table,
    Id,
    #[sea_orm(iden = "tenantID")]
    TenantId,
    Kind,
    Hash,
    Sha,
    Size,
    Index,
    Mime,
    Extension,
    Name,
    Status,
    Visibility,
    Viewers,
    Chunk,
    Total,
    #[sea_orm(iden = "archivedAt")]
    ArchivedAt,
    #[sea_orm(iden = "createdAt")]
    CreatedAt,
    Creator,
    #[sea_orm(iden = "updatedAt")]
    UpdatedAt,
    Updater,
    #[sea_orm(iden = "expiresAt")]
    ExpiresAt,
    Superseded,
}

#[derive(DeriveIden)]
enum Chunk {
    Table,
    Id,
    #[sea_orm(iden = "assetID")]
    AssetId,
    Index,
    Hash,
    Size,
    #[sea_orm(iden = "createdAt")]
    CreatedAt,
    Creator,
}

#[derive(DeriveIden)]
enum Tenant {
    Table,
    Id,
    Name,
    Slug,
    Status,
    Type,
    #[sea_orm(iden = "archivedAt")]
    ArchivedAt,
    #[sea_orm(iden = "createdAt")]
    CreatedAt,
    Creator,
    #[sea_orm(iden = "updatedAt")]
    UpdatedAt,
    Updater,
    #[sea_orm(iden = "expiresAt")]
    ExpiresAt,
}

#[derive(DeriveIden)]
enum TenantMember {
    Table,
    Id,
    #[sea_orm(iden = "tenantID")]
    TenantId,
    #[sea_orm(iden = "userID")]
    UserId,
    Role,
    Status,
    #[sea_orm(iden = "archivedAt")]
    ArchivedAt,
    #[sea_orm(iden = "createdAt")]
    CreatedAt,
    Creator,
    #[sea_orm(iden = "updatedAt")]
    UpdatedAt,
    Updater,
    #[sea_orm(iden = "expiresAt")]
    ExpiresAt,
}

#[derive(DeriveIden)]
enum Subscription {
    Table,
    Id,
    #[sea_orm(iden = "tenantID")]
    TenantId,
    Plan,
    Status,
    #[sea_orm(iden = "expiresAt")]
    ExpiresAt,
    #[sea_orm(iden = "archivedAt")]
    ArchivedAt,
    #[sea_orm(iden = "createdAt")]
    CreatedAt,
    Creator,
    #[sea_orm(iden = "updatedAt")]
    UpdatedAt,
    Updater,
}

#[derive(DeriveIden)]
enum GatewayProvider {
    Table,
    Id,
    #[sea_orm(iden = "tenantID")]
    TenantId,
    Kind,
    Name,
    #[sea_orm(iden = "baseURL")]
    BaseUrl,
    #[sea_orm(iden = "apiKeyEnc")]
    ApiKeyEnc,
    Status,
    #[sea_orm(iden = "archivedAt")]
    ArchivedAt,
    #[sea_orm(iden = "createdAt")]
    CreatedAt,
    Creator,
    #[sea_orm(iden = "updatedAt")]
    UpdatedAt,
    Updater,
    #[sea_orm(iden = "expiresAt")]
    ExpiresAt,
}

#[derive(DeriveIden)]
enum GatewayModel {
    Table,
    Id,
    #[sea_orm(iden = "providerID")]
    ProviderId,
    #[sea_orm(iden = "tenantID")]
    TenantId,
    Name,
    Label,
    #[sea_orm(iden = "allowRoles")]
    AllowRoles,
    Enabled,
    #[sea_orm(iden = "dailyTokenQuota")]
    DailyTokenQuota,
    Capabilities,
    #[sea_orm(iden = "contextWindow")]
    ContextWindow,
    #[sea_orm(iden = "archivedAt")]
    ArchivedAt,
    #[sea_orm(iden = "createdAt")]
    CreatedAt,
    Creator,
    #[sea_orm(iden = "updatedAt")]
    UpdatedAt,
    Updater,
    #[sea_orm(iden = "expiresAt")]
    ExpiresAt,
}

#[derive(DeriveIden)]
enum GatewayUsage {
    Table,
    Id,
    #[sea_orm(iden = "tenantID")]
    TenantId,
    #[sea_orm(iden = "userID")]
    UserId,
    #[sea_orm(iden = "providerID")]
    ProviderId,
    #[sea_orm(iden = "modelID")]
    ModelId,
    #[sea_orm(iden = "promptTokens")]
    PromptTokens,
    #[sea_orm(iden = "completionTokens")]
    CompletionTokens,
    #[sea_orm(iden = "totalTokens")]
    TotalTokens,
    Status,
    #[sea_orm(iden = "latencyMs")]
    LatencyMs,
    #[sea_orm(iden = "createdAt")]
    CreatedAt,
}

#[derive(DeriveIden)]
enum GatewayAudit {
    Table,
    Id,
    #[sea_orm(iden = "tenantID")]
    TenantId,
    Actor,
    Action,
    Resource,
    Detail,
    Ip,
    #[sea_orm(iden = "createdAt")]
    CreatedAt,
}

#[derive(DeriveIden)]
enum SsoConnection {
    Table,
    Id,
    #[sea_orm(iden = "tenantID")]
    TenantId,
    Provider,
    Issuer,
    #[sea_orm(iden = "clientID")]
    ClientId,
    #[sea_orm(iden = "clientSecretEnc")]
    ClientSecretEnc,
    #[sea_orm(iden = "redirectUri")]
    RedirectUri,
    Status,
    #[sea_orm(iden = "archivedAt")]
    ArchivedAt,
    #[sea_orm(iden = "createdAt")]
    CreatedAt,
    Creator,
    #[sea_orm(iden = "updatedAt")]
    UpdatedAt,
    Updater,
    #[sea_orm(iden = "expiresAt")]
    ExpiresAt,
}

#[derive(DeriveIden)]
enum ConsolePreference {
    Table,
    Id,
    #[sea_orm(iden = "userID")]
    UserId,
    #[sea_orm(iden = "navOrder")]
    NavOrder,
    #[sea_orm(iden = "pinnedNav")]
    PinnedNav,
    #[sea_orm(iden = "dashboardWidgets")]
    DashboardWidgets,
    Bookmarks,
    #[sea_orm(iden = "createdAt")]
    CreatedAt,
    Creator,
    #[sea_orm(iden = "updatedAt")]
    UpdatedAt,
    Updater,
}

/// 客户端异常上报事件。
#[derive(DeriveIden)]
enum Exception {
    Table,
    Id,
    #[sea_orm(iden = "eventID")]
    EventId,
    Fingerprint,
    Source,
    Level,
    Message,
    Stack,
    Status,
    Method,
    Url,
    #[sea_orm(iden = "reqID")]
    ReqId,
    Ip,
    #[sea_orm(iden = "userAgent")]
    UserAgent,
    #[sea_orm(iden = "userID")]
    UserId,
    Environment,
    Release,
    Context,
    Timestamp,
    #[sea_orm(iden = "receivedAt")]
    ReceivedAt,
    Creator,
}

#[derive(DeriveIden)]
enum PaymentOrder {
    Table,
    Id,
    #[sea_orm(iden = "orderNo")]
    OrderNo,
    #[sea_orm(iden = "tenantID")]
    TenantId,
    #[sea_orm(iden = "userID")]
    UserId,
    Plan,
    Channel,
    Amount,
    Currency,
    Status,
    #[sea_orm(iden = "durationDays")]
    DurationDays,
    #[sea_orm(iden = "transactionID")]
    TransactionId,
    #[sea_orm(iden = "codeUrl")]
    CodeUrl,
    #[sea_orm(iden = "subscriptionID")]
    SubscriptionId,
    #[sea_orm(iden = "paidAt")]
    PaidAt,
    #[sea_orm(iden = "expiresAt")]
    ExpiresAt,
    Remark,
    #[sea_orm(iden = "archivedAt")]
    ArchivedAt,
    #[sea_orm(iden = "createdAt")]
    CreatedAt,
    Creator,
    #[sea_orm(iden = "updatedAt")]
    UpdatedAt,
    Updater,
}

/// 模型价目表：`(租户, 型号, 有效区间)` → 单价（分 / 百万 token）。
///
/// 不指向 `gateway_model` 的外键：价格是账单依据，型号被删/改名都不能让历史价格消失，
/// 型号名的可读副本在写入时快照进 `modelName`。
#[derive(DeriveIden)]
enum BillingPrice {
    Table,
    Id,
    #[sea_orm(iden = "tenantID")]
    TenantId,
    #[sea_orm(iden = "modelID")]
    ModelId,
    #[sea_orm(iden = "modelName")]
    ModelName,
    Currency,
    #[sea_orm(iden = "inputPricePerMillion")]
    InputPricePerMillion,
    #[sea_orm(iden = "outputPricePerMillion")]
    OutputPricePerMillion,
    #[sea_orm(iden = "effectiveFrom")]
    EffectiveFrom,
    #[sea_orm(iden = "effectiveTo")]
    EffectiveTo,
    #[sea_orm(iden = "archivedAt")]
    ArchivedAt,
    #[sea_orm(iden = "createdAt")]
    CreatedAt,
    Creator,
    #[sea_orm(iden = "updatedAt")]
    UpdatedAt,
    Updater,
}

/// 事务性发件箱：事件是历史事实，不随聚合级联删除，故无外键。
#[derive(DeriveIden)]
enum Outbox {
    Table,
    Id,
    Seq,
    Aggregate,
    #[sea_orm(iden = "aggregateID")]
    AggregateId,
    #[sea_orm(iden = "eventType")]
    EventType,
    #[sea_orm(iden = "schemaVersion")]
    SchemaVersion,
    Payload,
    Traceparent,
    #[sea_orm(iden = "tenantID")]
    TenantId,
    #[sea_orm(iden = "createdAt")]
    CreatedAt,
    #[sea_orm(iden = "publishedAt")]
    PublishedAt,
    Attempts,
    #[sea_orm(iden = "lastError")]
    LastError,
}

/// 消费幂等去重表：每个消费者对每个事件最多处理一次。
#[derive(DeriveIden)]
enum ConsumedEvent {
    Table,
    Consumer,
    #[sea_orm(iden = "eventID")]
    EventId,
    #[sea_orm(iden = "consumedAt")]
    ConsumedAt,
}

/// 服务端 agent 任务台账。
#[derive(DeriveIden)]
enum AgentTask {
    Table,
    Id,
    #[sea_orm(iden = "tenantID")]
    TenantId,
    #[sea_orm(iden = "userID")]
    UserId,
    Status,
    Objective,
    Model,
    #[sea_orm(iden = "maxSteps")]
    MaxSteps,
    #[sea_orm(iden = "allowedTools")]
    AllowedTools,
    #[sea_orm(iden = "instanceID")]
    InstanceId,
    Steps,
    Result,
    Error,
    #[sea_orm(iden = "createdAt")]
    CreatedAt,
    #[sea_orm(iden = "updatedAt")]
    UpdatedAt,
}

/// 服务端 agent 的审批台账。
#[derive(DeriveIden)]
enum AgentApproval {
    Table,
    Id,
    #[sea_orm(iden = "tenantID")]
    TenantId,
    #[sea_orm(iden = "taskID")]
    TaskId,
    Step,
    Tool,
    Arguments,
    State,
    #[sea_orm(iden = "decidedBy")]
    DecidedBy,
    #[sea_orm(iden = "decidedAt")]
    DecidedAt,
    Reason,
    #[sea_orm(iden = "expiresAt")]
    ExpiresAt,
    #[sea_orm(iden = "appliedAt")]
    AppliedAt,
    #[sea_orm(iden = "createdAt")]
    CreatedAt,
    #[sea_orm(iden = "updatedAt")]
    UpdatedAt,
}

/// RAG 索引任务台账。
#[derive(DeriveIden)]
enum RagIndexTask {
    Table,
    Id,
    #[sea_orm(iden = "tenantID")]
    TenantId,
    #[sea_orm(iden = "userID")]
    UserId,
    #[sea_orm(iden = "assetID")]
    AssetId,
    Status,
    #[sea_orm(iden = "instanceID")]
    InstanceId,
    Result,
    Error,
    #[sea_orm(iden = "createdAt")]
    CreatedAt,
    #[sea_orm(iden = "updatedAt")]
    UpdatedAt,
}

/// 会话（客户端同步上来的头部）。
#[derive(DeriveIden)]
enum ChatSession {
    Table,
    Id,
    #[sea_orm(iden = "tenantID")]
    TenantId,
    #[sea_orm(iden = "userID")]
    UserId,
    Title,
    Pinned,
    #[sea_orm(iden = "workspaceID")]
    WorkspaceId,
    Revision,
    #[sea_orm(iden = "clientUpdatedAt")]
    ClientUpdatedAt,
    #[sea_orm(iden = "archivedAt")]
    ArchivedAt,
    #[sea_orm(iden = "createdAt")]
    CreatedAt,
    #[sea_orm(iden = "updatedAt")]
    UpdatedAt,
}

/// 消息（内容不透明，服务端只存不解析）。
#[derive(DeriveIden)]
enum ChatMessage {
    Table,
    Id,
    #[sea_orm(iden = "tenantID")]
    TenantId,
    #[sea_orm(iden = "sessionID")]
    SessionId,
    #[sea_orm(iden = "parentID")]
    ParentId,
    Format,
    Content,
    #[sea_orm(iden = "clientCreatedAt")]
    ClientCreatedAt,
    Revision,
    #[sea_orm(iden = "archivedAt")]
    ArchivedAt,
    #[sea_orm(iden = "createdAt")]
    CreatedAt,
    #[sea_orm(iden = "updatedAt")]
    UpdatedAt,
}

/// 用量（客户端自报的会话账，与 `gateway_usage` 口径不同）。
#[derive(DeriveIden)]
enum ChatUsage {
    Table,
    Id,
    #[sea_orm(iden = "tenantID")]
    TenantId,
    #[sea_orm(iden = "sessionID")]
    SessionId,
    #[sea_orm(iden = "runID")]
    RunId,
    #[sea_orm(iden = "providerID")]
    ProviderId,
    Model,
    Source,
    Outcome,
    #[sea_orm(iden = "inputTokens")]
    InputTokens,
    #[sea_orm(iden = "outputTokens")]
    OutputTokens,
    #[sea_orm(iden = "totalTokens")]
    TotalTokens,
    #[sea_orm(iden = "clientCreatedAt")]
    ClientCreatedAt,
    Revision,
    #[sea_orm(iden = "createdAt")]
    CreatedAt,
    #[sea_orm(iden = "updatedAt")]
    UpdatedAt,
}

/// 同步批次台账（幂等凭据 + 水位）。
#[derive(DeriveIden)]
enum ChatSyncBatch {
    Table,
    #[sea_orm(iden = "tenantID")]
    TenantId,
    #[sea_orm(iden = "clientBatchID")]
    ClientBatchId,
    Revision,
    Applied,
    Conflicts,
    #[sea_orm(iden = "createdAt")]
    CreatedAt,
}
