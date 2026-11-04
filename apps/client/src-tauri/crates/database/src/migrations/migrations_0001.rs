//! 0001：客户端本地库唯一基线（schema + 种子）。开发期改本文件后 `migrate:fresh`。
//!
//! 真相归属：**运行期以 `crates/database/src/entity/*.rs` 为准**，本文件的 DDL 必须与之逐列对齐；
//! `migration::tests::entity_columns_match_ddl` 做双向比对（entity 多列 / DDL 多列都报错）。
use sea_orm_migration::prelude::*;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "0001"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared("PRAGMA journal_mode=WAL").await?;
        db.execute_unprepared("PRAGMA foreign_keys=ON").await?;

        manager
            .create_table(
                Table::create()
                    .table(Mirror::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(Mirror::Id).string().not_null().primary_key())
                    .col(ColumnDef::new(Mirror::Title).string().not_null())
                    .col(ColumnDef::new(Mirror::Index).big_integer().not_null())
                    .col(ColumnDef::new(Mirror::Mark).string().not_null().default(""))
                    .col(
                        ColumnDef::new(Mirror::Description)
                            .string()
                            .not_null()
                            .default("暂无描述"),
                    )
                    .col(
                        ColumnDef::new(Mirror::Overlay)
                            .string()
                            .not_null()
                            .default(""),
                    )
                    .col(ColumnDef::new(Mirror::Background).string().null())
                    .col(ColumnDef::new(Mirror::Backdrop).string().null())
                    .col(ColumnDef::new(Mirror::ArchivedAt).big_integer().null())
                    .col(ColumnDef::new(Mirror::CreatedAt).big_integer().not_null())
                    .col(ColumnDef::new(Mirror::UpdatedAt).big_integer().not_null())
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(MagneticTile::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(MagneticTile::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(MagneticTile::Index).big_integer().not_null())
                    .col(ColumnDef::new(MagneticTile::Title).string().not_null())
                    .col(ColumnDef::new(MagneticTile::Url).string().null())
                    .col(ColumnDef::new(MagneticTile::Round).string().null())
                    .col(ColumnDef::new(MagneticTile::Mark).string().null())
                    .col(ColumnDef::new(MagneticTile::Component).string().not_null())
                    .col(ColumnDef::new(MagneticTile::Description).string().null())
                    .col(ColumnDef::new(MagneticTile::Background).string().null())
                    .col(ColumnDef::new(MagneticTile::Backdrop).string().null())
                    .col(ColumnDef::new(MagneticTile::MirrorID).string().not_null())
                    .col(ColumnDef::new(MagneticTile::TextColor).string().null())
                    .col(ColumnDef::new(MagneticTile::CollectionID).string().null())
                    .col(
                        ColumnDef::new(MagneticTile::Size)
                            .integer()
                            .not_null()
                            .default(3),
                    )
                    .col(
                        ColumnDef::new(MagneticTile::Shape)
                            .string()
                            .not_null()
                            .default("rectangle"),
                    )
                    .col(
                        ColumnDef::new(MagneticTile::Direction)
                            .string()
                            .not_null()
                            .default("horizontal"),
                    )
                    .col(
                        ColumnDef::new(MagneticTile::DownloadCount)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(MagneticTile::ArchivedAt)
                            .big_integer()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(MagneticTile::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MagneticTile::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(Asset::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(Asset::Id).string().not_null().primary_key())
                    .col(ColumnDef::new(Asset::TenantId).string().null())
                    .col(ColumnDef::new(Asset::Kind).string().null())
                    .col(ColumnDef::new(Asset::Hash).string().null())
                    .col(
                        ColumnDef::new(Asset::Sha)
                            .string()
                            .not_null()
                            .default("sha256"),
                    )
                    .col(ColumnDef::new(Asset::Size).big_integer().null())
                    .col(
                        ColumnDef::new(Asset::Index)
                            .big_integer()
                            .not_null()
                            .default(1),
                    )
                    .col(ColumnDef::new(Asset::Mime).string().not_null())
                    .col(ColumnDef::new(Asset::Extension).string().null())
                    .col(ColumnDef::new(Asset::FileName).string().not_null())
                    .col(ColumnDef::new(Asset::FilePath).string().not_null())
                    .col(ColumnDef::new(Asset::Metadata).string().null())
                    .col(
                        ColumnDef::new(Asset::Status)
                            .string()
                            .not_null()
                            .default("029"),
                    )
                    .col(ColumnDef::new(Asset::DeviceId).string().null())
                    .col(ColumnDef::new(Asset::ArchivedAt).big_integer().null())
                    .col(ColumnDef::new(Asset::CreatedAt).big_integer().not_null())
                    .col(ColumnDef::new(Asset::UpdatedAt).big_integer().not_null())
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(Countdown::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Countdown::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(Countdown::WorkStart)
                            .string()
                            .not_null()
                            .default("09:00"),
                    )
                    .col(
                        ColumnDef::new(Countdown::WorkEnd)
                            .string()
                            .not_null()
                            .default("18:00"),
                    )
                    .col(
                        ColumnDef::new(Countdown::WorkDays)
                            .string()
                            .not_null()
                            .default("[1,2,3,4,5]"),
                    )
                    .col(
                        ColumnDef::new(Countdown::MonthlySalary)
                            .double()
                            .not_null()
                            .default(0.0),
                    )
                    .col(
                        ColumnDef::new(Countdown::PayDay)
                            .integer()
                            .not_null()
                            .default(15),
                    )
                    .col(ColumnDef::new(Countdown::ArchivedAt).big_integer().null())
                    .col(
                        ColumnDef::new(Countdown::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(Countdown::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        // reminder must exist before calendar (FK)
        manager
            .create_table(
                Table::create()
                    .table(Reminder::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Reminder::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Reminder::Title).string().not_null())
                    .col(
                        ColumnDef::new(Reminder::Notes)
                            .string()
                            .not_null()
                            .default(""),
                    )
                    .col(ColumnDef::new(Reminder::DueAt).big_integer().null())
                    .col(ColumnDef::new(Reminder::EndAt).big_integer().null())
                    .col(ColumnDef::new(Reminder::FireTime).string().null())
                    .col(
                        ColumnDef::new(Reminder::WeekDays)
                            .string()
                            .not_null()
                            .default("[]"),
                    )
                    .col(
                        ColumnDef::new(Reminder::EntireDay)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(
                        ColumnDef::new(Reminder::Enabled)
                            .boolean()
                            .not_null()
                            .default(true),
                    )
                    .col(ColumnDef::new(Reminder::SnoozeUntil).big_integer().null())
                    .col(ColumnDef::new(Reminder::LastFiredAt).big_integer().null())
                    .col(
                        ColumnDef::new(Reminder::Priority)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(ColumnDef::new(Reminder::ArchivedAt).big_integer().null())
                    .col(ColumnDef::new(Reminder::CreatedAt).big_integer().not_null())
                    .col(ColumnDef::new(Reminder::UpdatedAt).big_integer().not_null())
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(Calendar::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Calendar::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Calendar::Title).string().not_null())
                    .col(
                        ColumnDef::new(Calendar::Notes)
                            .string()
                            .not_null()
                            .default(""),
                    )
                    .col(ColumnDef::new(Calendar::StartAt).big_integer().not_null())
                    .col(ColumnDef::new(Calendar::EndAt).big_integer().not_null())
                    .col(
                        ColumnDef::new(Calendar::EntireDay)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(ColumnDef::new(Calendar::Color).string().null())
                    .col(ColumnDef::new(Calendar::ReminderID).string().null())
                    .col(ColumnDef::new(Calendar::ArchivedAt).big_integer().null())
                    .col(ColumnDef::new(Calendar::CreatedAt).big_integer().not_null())
                    .col(ColumnDef::new(Calendar::UpdatedAt).big_integer().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_calendar_reminder")
                            .from(Calendar::Table, Calendar::ReminderID)
                            .to(Reminder::Table, Reminder::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        db.execute_unprepared(
            "INSERT OR IGNORE INTO countdown \
             (id, workStart, workEnd, workDays, monthlySalary, payDay, archivedAt, createdAt, updatedAt) \
             VALUES ('00000000-0000-0000-0000-000000000001', '09:00', '18:00', '[1,2,3,4,5]', 0.0, 15, NULL, \
             CAST(strftime('%s', 'now') AS INTEGER) * 1000, \
             CAST(strftime('%s', 'now') AS INTEGER) * 1000)",
        )
        .await?;

        // ── mirror 种子数据（与 magneticTile.mirrorID 对齐）──
        db.execute_unprepared(
            "INSERT OR IGNORE INTO mirror \
             (id, title, [index], mark, description, overlay, background, backdrop, archivedAt, createdAt, updatedAt) \
             VALUES ('b7bc5d50-3b4a-46d7-b834-2938df56de24', '镜像-01', 0, '', '默认镜像', '#000000AA', NULL, NULL, NULL, 1785423438774, 1785423438774)",
        )
        .await?;

        // ── 自研磁贴种子（见 builtin_seed.rs）──
        for statement in super::builtin_seed::insert_statements() {
            db.execute_unprepared(&statement).await?;
        }

        // ── navigation 种子（表驱动，见 navigation_seed.rs）──
        for statement in super::navigation_seed::insert_statements() {
            db.execute_unprepared(&statement).await?;
        }

        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_magnetic_tile_mirror ON magneticTile (mirrorID)",
        )
        .await?;
        db.execute_unprepared("CREATE INDEX IF NOT EXISTS idx_asset_hash ON asset (hash)")
            .await?;
        db.execute_unprepared("CREATE INDEX IF NOT EXISTS idx_asset_path ON asset (filePath)")
            .await?;
        db.execute_unprepared("CREATE INDEX IF NOT EXISTS idx_reminder_dueAt ON reminder (dueAt)")
            .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_reminder_fireTime ON reminder (fireTime)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_reminder_enabled ON reminder (enabled)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_reminder_archivedAt ON reminder (archivedAt)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_calendar_startAt ON calendar (startAt)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_calendar_reminderID ON calendar (reminderID)",
        )
        .await?;

        // ── overlay（浮层项，逐行结构化存储，kind 区分 texture/tile） ──
        manager
            .create_table(
                Table::create()
                    .table(Overlay::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Overlay::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Overlay::Kind).string().not_null())
                    .col(ColumnDef::new(Overlay::X).double().not_null())
                    .col(ColumnDef::new(Overlay::Y).double().not_null())
                    .col(ColumnDef::new(Overlay::W).double().not_null())
                    .col(ColumnDef::new(Overlay::H).double().not_null())
                    .col(ColumnDef::new(Overlay::Z).big_integer().not_null())
                    .col(ColumnDef::new(Overlay::Src).string().null())
                    .col(ColumnDef::new(Overlay::Opacity).double().null())
                    .col(ColumnDef::new(Overlay::TenantId).string().null())
                    .col(ColumnDef::new(Overlay::Component).string().null())
                    .col(ColumnDef::new(Overlay::Size).integer().null())
                    .col(ColumnDef::new(Overlay::Shape).string().null())
                    .col(ColumnDef::new(Overlay::Direction).string().null())
                    .col(ColumnDef::new(Overlay::Round).string().null())
                    .col(ColumnDef::new(Overlay::Background).string().null())
                    .col(
                        ColumnDef::new(Overlay::Title)
                            .string()
                            .not_null()
                            .default(""),
                    )
                    .col(ColumnDef::new(Overlay::Mark).string().null())
                    .col(
                        ColumnDef::new(Overlay::Scale)
                            .double()
                            .not_null()
                            .default(1.0),
                    )
                    .col(ColumnDef::new(Overlay::ArchivedAt).big_integer().null())
                    .col(ColumnDef::new(Overlay::CreatedAt).big_integer().not_null())
                    .col(ColumnDef::new(Overlay::UpdatedAt).big_integer().not_null())
                    .to_owned(),
            )
            .await?;

        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_overlay_archivedAt ON overlay (archivedAt)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_overlay_tenantID ON overlay (tenantID)",
        )
        .await?;

        // ── agent_workspace / agent_workspace_folder / agent_session / agent_message ──
        manager
            .create_table(
                Table::create()
                    .table(AgentWorkspace::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AgentWorkspace::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(AgentWorkspace::Title).string().not_null())
                    .col(
                        ColumnDef::new(AgentWorkspace::Icon)
                            .string()
                            .not_null()
                            .default("folder"),
                    )
                    .col(
                        ColumnDef::new(AgentWorkspace::Color)
                            .string()
                            .not_null()
                            .default("#166534"),
                    )
                    .col(
                        ColumnDef::new(AgentWorkspace::Pinned)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(
                        ColumnDef::new(AgentWorkspace::ArchivedAt)
                            .big_integer()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(AgentWorkspace::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AgentWorkspace::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(AgentWorkspaceFolder::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AgentWorkspaceFolder::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(AgentWorkspaceFolder::WorkspaceID)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AgentWorkspaceFolder::Path)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AgentWorkspaceFolder::Sort)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(AgentWorkspaceFolder::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AgentWorkspaceFolder::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_agent_workspace_folder_workspaceID")
                            .from(
                                AgentWorkspaceFolder::Table,
                                AgentWorkspaceFolder::WorkspaceID,
                            )
                            .to(AgentWorkspace::Table, AgentWorkspace::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::NoAction),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(AgentSession::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AgentSession::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(AgentSession::Title).string().not_null())
                    .col(
                        ColumnDef::new(AgentSession::Pinned)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(ColumnDef::new(AgentSession::ProviderId).string().null())
                    .col(ColumnDef::new(AgentSession::WorkspaceID).string().null())
                    .col(
                        ColumnDef::new(AgentSession::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AgentSession::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_agent_session_workspaceID")
                            .from(AgentSession::Table, AgentSession::WorkspaceID)
                            .to(AgentWorkspace::Table, AgentWorkspace::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::NoAction),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(AgentMessage::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AgentMessage::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(AgentMessage::Content).text().not_null())
                    .col(ColumnDef::new(AgentMessage::ParentId).string().null())
                    .col(
                        ColumnDef::new(AgentMessage::Format)
                            .string()
                            .not_null()
                            .default("ith/thread-message-like"),
                    )
                    .col(ColumnDef::new(AgentMessage::SessionID).string().not_null())
                    .col(
                        ColumnDef::new(AgentMessage::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AgentMessage::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_agent_message_sessionID")
                            .from(AgentMessage::Table, AgentMessage::SessionID)
                            .to(AgentSession::Table, AgentSession::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::NoAction),
                    )
                    .to_owned(),
            )
            .await?;

        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_agent_workspace_archivedAt ON agent_workspace (archivedAt)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_agent_workspace_folder_workspaceID ON agent_workspace_folder (workspaceID)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_agent_session_workspaceID ON agent_session (workspaceID)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_agent_session_updatedAt ON agent_session (updatedAt)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_agent_message_sessionID ON agent_message (sessionID)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_agent_message_createdAt ON agent_message (createdAt)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_agent_message_parentID ON agent_message (parentID)",
        )
        .await?;

        // ── agent_provider（模型接入配置；apiKey 不落库，存 plugin-store） ──
        manager
            .create_table(
                Table::create()
                    .table(AgentProvider::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AgentProvider::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(AgentProvider::Kind).string().not_null())
                    .col(ColumnDef::new(AgentProvider::Name).string().not_null())
                    .col(ColumnDef::new(AgentProvider::BaseUrl).string().null())
                    .col(ColumnDef::new(AgentProvider::Models).text().null())
                    .col(ColumnDef::new(AgentProvider::Model).string().null())
                    .col(
                        ColumnDef::new(AgentProvider::Enabled)
                            .boolean()
                            .not_null()
                            .default(true),
                    )
                    .col(
                        ColumnDef::new(AgentProvider::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AgentProvider::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_agent_provider_kind ON agent_provider (kind)",
        )
        .await?;

        // ── agent_usage（一次模型运行的用量账本；runID 唯一） ──
        manager
            .create_table(
                Table::create()
                    .table(AgentUsage::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AgentUsage::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(AgentUsage::RunId)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .col(ColumnDef::new(AgentUsage::SessionId).string().null())
                    .col(ColumnDef::new(AgentUsage::ProviderId).string().null())
                    .col(ColumnDef::new(AgentUsage::Model).string().not_null())
                    .col(
                        ColumnDef::new(AgentUsage::InputTokens)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AgentUsage::OutputTokens)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AgentUsage::TotalTokens)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AgentUsage::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_agent_usage_sessionID ON agent_usage (sessionID)",
        )
        .await?;

        // ── signboard（看板：column / entry / tag / tagged / check / automation）──
        manager
            .create_table(
                Table::create()
                    .table(Signboard::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Signboard::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Signboard::Title).string().not_null())
                    .col(
                        ColumnDef::new(Signboard::Index)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(ColumnDef::new(Signboard::ArchivedAt).big_integer().null())
                    .col(ColumnDef::new(Signboard::SyncedAt).big_integer().null())
                    .col(
                        ColumnDef::new(Signboard::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(Signboard::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(SignboardColumn::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SignboardColumn::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(SignboardColumn::BoardId).string().not_null())
                    .col(ColumnDef::new(SignboardColumn::Title).string().not_null())
                    .col(
                        ColumnDef::new(SignboardColumn::Index)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(ColumnDef::new(SignboardColumn::Color).string().null())
                    .col(ColumnDef::new(SignboardColumn::WipLimit).integer().null())
                    .col(ColumnDef::new(SignboardColumn::Role).string().null())
                    .col(
                        ColumnDef::new(SignboardColumn::ArchivedAt)
                            .big_integer()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(SignboardColumn::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SignboardColumn::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_signboard_column_board")
                            .from(SignboardColumn::Table, SignboardColumn::BoardId)
                            .to(Signboard::Table, Signboard::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(SignboardEntry::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SignboardEntry::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(SignboardEntry::ColumnId).string().not_null())
                    .col(ColumnDef::new(SignboardEntry::Title).string().not_null())
                    .col(
                        ColumnDef::new(SignboardEntry::Notes)
                            .string()
                            .not_null()
                            .default(""),
                    )
                    .col(
                        ColumnDef::new(SignboardEntry::Index)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(ColumnDef::new(SignboardEntry::DueAt).big_integer().null())
                    .col(ColumnDef::new(SignboardEntry::StartAt).big_integer().null())
                    .col(ColumnDef::new(SignboardEntry::ReminderId).string().null())
                    .col(
                        ColumnDef::new(SignboardEntry::Priority)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(ColumnDef::new(SignboardEntry::Color).string().null())
                    .col(
                        ColumnDef::new(SignboardEntry::Progress)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(SignboardEntry::ArchivedAt)
                            .big_integer()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(SignboardEntry::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SignboardEntry::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_signboard_entry_column")
                            .from(SignboardEntry::Table, SignboardEntry::ColumnId)
                            .to(SignboardColumn::Table, SignboardColumn::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_signboard_entry_reminder")
                            .from(SignboardEntry::Table, SignboardEntry::ReminderId)
                            .to(Reminder::Table, Reminder::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(SignboardTag::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SignboardTag::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(SignboardTag::BoardId).string().not_null())
                    .col(ColumnDef::new(SignboardTag::Title).string().not_null())
                    .col(ColumnDef::new(SignboardTag::Color).string().null())
                    .col(
                        ColumnDef::new(SignboardTag::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SignboardTag::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_signboard_tag_board")
                            .from(SignboardTag::Table, SignboardTag::BoardId)
                            .to(Signboard::Table, Signboard::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(SignboardTagged::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(SignboardTagged::EntryId).string().not_null())
                    .col(ColumnDef::new(SignboardTagged::TagId).string().not_null())
                    .primary_key(
                        Index::create()
                            .col(SignboardTagged::EntryId)
                            .col(SignboardTagged::TagId),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_signboard_tagged_entry")
                            .from(SignboardTagged::Table, SignboardTagged::EntryId)
                            .to(SignboardEntry::Table, SignboardEntry::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_signboard_tagged_tag")
                            .from(SignboardTagged::Table, SignboardTagged::TagId)
                            .to(SignboardTag::Table, SignboardTag::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(SignboardCheck::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SignboardCheck::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(SignboardCheck::EntryId).string().not_null())
                    .col(ColumnDef::new(SignboardCheck::Title).string().not_null())
                    .col(
                        ColumnDef::new(SignboardCheck::Done)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(
                        ColumnDef::new(SignboardCheck::Index)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(SignboardCheck::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SignboardCheck::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_signboard_check_entry")
                            .from(SignboardCheck::Table, SignboardCheck::EntryId)
                            .to(SignboardEntry::Table, SignboardEntry::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(SignboardAutomation::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SignboardAutomation::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(SignboardAutomation::BoardId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SignboardAutomation::Title)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SignboardAutomation::Enabled)
                            .boolean()
                            .not_null()
                            .default(true),
                    )
                    .col(
                        ColumnDef::new(SignboardAutomation::Trigger)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SignboardAutomation::ConditionJson)
                            .string()
                            .not_null()
                            .default("{}"),
                    )
                    .col(
                        ColumnDef::new(SignboardAutomation::ActionJson)
                            .string()
                            .not_null()
                            .default("[]"),
                    )
                    .col(
                        ColumnDef::new(SignboardAutomation::Index)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(SignboardAutomation::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SignboardAutomation::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_signboard_automation_board")
                            .from(SignboardAutomation::Table, SignboardAutomation::BoardId)
                            .to(Signboard::Table, Signboard::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        let db = manager.get_connection();
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_signboard_index ON signboard (\"index\")",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_signboard_column_board_id_index ON signboard_column (board_id, \"index\")",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_signboard_entry_column_id_index ON signboard_entry (column_id, \"index\")",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_signboard_entry_reminder_id ON signboard_entry (reminder_id)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_signboard_entry_due_at ON signboard_entry (due_at)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_signboard_entry_start_at ON signboard_entry (start_at)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_signboard_tag_board_id ON signboard_tag (board_id)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_signboard_tag_board_id_title ON signboard_tag (board_id, title)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_signboard_tagged_tag_id ON signboard_tagged (tag_id)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_signboard_check_entry_id_index ON signboard_check (entry_id, \"index\")",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_signboard_automation_board_id_index ON signboard_automation (board_id, \"index\")",
        )
        .await?;

        // ── 原先的 v002–v005 已并入本文件（不再有独立迁移文件）──
        for statement in [
            // v002：album（捕获库相簿）
            "CREATE TABLE IF NOT EXISTS album (\
                 id TEXT PRIMARY KEY NOT NULL, \
                 name TEXT NOT NULL, \
                 \"index\" INTEGER NOT NULL DEFAULT 0, \
                 \"coverAssetID\" TEXT NULL, \
                 status TEXT NOT NULL DEFAULT '029', \
                 \"archivedAt\" INTEGER NULL, \
                 \"createdAt\" INTEGER NOT NULL, \
                 \"updatedAt\" INTEGER NOT NULL)",
            "CREATE INDEX IF NOT EXISTS idx_album_archivedAt ON album (\"archivedAt\")",
            "CREATE INDEX IF NOT EXISTS idx_album_index ON album (\"index\")",
            // v003：bookmark（树形书签库）
            "CREATE TABLE IF NOT EXISTS bookmark (\
                 id TEXT PRIMARY KEY NOT NULL, \
                 \"mirrorID\" TEXT NOT NULL, \
                 \"parentID\" TEXT NULL, \
                 title TEXT NOT NULL, \
                 url TEXT NULL, \
                 \"index\" INTEGER NOT NULL DEFAULT 0, \
                 \"createdAt\" INTEGER NOT NULL, \
                 \"updatedAt\" INTEGER NOT NULL)",
            "CREATE INDEX IF NOT EXISTS idx_bookmark_mirror ON bookmark (\"mirrorID\")",
            "CREATE INDEX IF NOT EXISTS idx_bookmark_parent ON bookmark (\"parentID\")",
            "CREATE INDEX IF NOT EXISTS idx_bookmark_mirror_url ON bookmark (\"mirrorID\", url)",
            // v004：signboard_entry_asset（卡片 ↔ 本地 asset）
            "CREATE TABLE IF NOT EXISTS signboard_entry_asset (\
                 entry_id TEXT NOT NULL, \
                 asset_id TEXT NOT NULL, \
                 \"index\" INTEGER NOT NULL DEFAULT 0, \
                 \"createdAt\" INTEGER NOT NULL, \
                 PRIMARY KEY (entry_id, asset_id), \
                 CONSTRAINT fk_signboard_entry_asset_entry FOREIGN KEY (entry_id) \
                     REFERENCES signboard_entry (id) ON DELETE CASCADE ON UPDATE CASCADE, \
                 CONSTRAINT fk_signboard_entry_asset_asset FOREIGN KEY (asset_id) \
                     REFERENCES asset (id) ON DELETE CASCADE ON UPDATE CASCADE)",
            "CREATE INDEX IF NOT EXISTS idx_signboard_entry_asset_entry_id_index ON signboard_entry_asset (entry_id, \"index\")",
            "CREATE INDEX IF NOT EXISTS idx_signboard_entry_asset_asset_id ON signboard_entry_asset (asset_id)",
            // 看板进度与列角色
            // ── Knowledge（知识库）──
            // scope=user 属个人；scope=tenant 为团队共享（用 \"tenantId\" 圈定租户）
            "CREATE TABLE IF NOT EXISTS knowledge_base (\
                 id TEXT PRIMARY KEY NOT NULL, \
                 name TEXT NOT NULL, \
                 slug TEXT NOT NULL, \
                 description TEXT NULL, \
                 scope TEXT NOT NULL DEFAULT '012', \
                 \"tenantId\" TEXT NULL, \
                 \"rootPath\" TEXT NOT NULL, \
                 \"autoUpdate\" INTEGER NOT NULL DEFAULT 0, \
                 \"autoExport\" INTEGER NOT NULL DEFAULT 0, \
                 citation INTEGER NOT NULL DEFAULT 1, \
                 \"cloudModel\" TEXT NULL, \
                 \"cloudDimensions\" INTEGER NULL, \
                 \"archivedAt\" INTEGER NULL, \
                 \"createdAt\" INTEGER NOT NULL, \
                 \"updatedAt\" INTEGER NOT NULL)",
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_base_slug ON knowledge_base (slug)",
            "CREATE INDEX IF NOT EXISTS idx_knowledge_base_scope ON knowledge_base (scope, \"tenantId\")",
            "CREATE TABLE IF NOT EXISTS knowledge_doc (\
                 id TEXT PRIMARY KEY NOT NULL, \
                 \"baseId\" TEXT NOT NULL, \
                 title TEXT NOT NULL, \
                 \"relPath\" TEXT NOT NULL, \
                 hash TEXT NOT NULL, \
                 content TEXT NOT NULL, \
                 size INTEGER NOT NULL DEFAULT 0, \
                 \"wordCount\" INTEGER NOT NULL DEFAULT 0, \
                 revision INTEGER NOT NULL DEFAULT 0, \
                 status TEXT NOT NULL DEFAULT '001', \
                 source TEXT NOT NULL DEFAULT '003', \
                 error TEXT NULL, \
                 \"sessionId\" TEXT NULL, \
                 \"assetId\" TEXT NULL, \
                 \"assetHash\" TEXT NULL, \
                 \"archivedAt\" INTEGER NULL, \
                 \"createdAt\" INTEGER NOT NULL, \
                 \"updatedAt\" INTEGER NOT NULL, \
                 CONSTRAINT fk_knowledge_doc_base FOREIGN KEY (\"baseId\") \
                     REFERENCES knowledge_base (id) ON DELETE CASCADE ON UPDATE CASCADE)",
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_doc_base_path ON knowledge_doc (\"baseId\", \"relPath\")",
            "CREATE INDEX IF NOT EXISTS idx_knowledge_doc_base_updated ON knowledge_doc (\"baseId\", \"updatedAt\")",
            "CREATE INDEX IF NOT EXISTS idx_knowledge_doc_status ON knowledge_doc (status)",
            // FTS5 外部内容表：正文由 knowledge_doc.content 镜像，触发器保持同步
            "CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_doc_fts USING fts5(\
                 title, content, tokenize='trigram', content='knowledge_doc', content_rowid='rowid')",
            "CREATE TRIGGER IF NOT EXISTS knowledge_doc_ai AFTER INSERT ON knowledge_doc BEGIN \
                 INSERT INTO knowledge_doc_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content); \
             END",
            "CREATE TRIGGER IF NOT EXISTS knowledge_doc_ad AFTER DELETE ON knowledge_doc BEGIN \
                 INSERT INTO knowledge_doc_fts(knowledge_doc_fts, rowid, title, content) \
                 VALUES ('delete', old.rowid, old.title, old.content); \
             END",
            "CREATE TRIGGER IF NOT EXISTS knowledge_doc_au AFTER UPDATE ON knowledge_doc BEGIN \
                 INSERT INTO knowledge_doc_fts(knowledge_doc_fts, rowid, title, content) \
                 VALUES ('delete', old.rowid, old.title, old.content); \
                 INSERT INTO knowledge_doc_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content); \
             END",
            "CREATE TABLE IF NOT EXISTS knowledge_index_state (\
                 \"docId\" TEXT PRIMARY KEY NOT NULL, \
                 \"baseId\" TEXT NOT NULL, \
                 \"tenantId\" TEXT NULL, \
                 \"localIndexedAt\" INTEGER NULL, \
                 \"cloudStatus\" TEXT NOT NULL DEFAULT '007', \
                 \"cloudAssetId\" TEXT NULL, \
                 \"cloudAssetHash\" TEXT NULL, \
                 \"cloudModel\" TEXT NULL, \
                 \"cloudDimensions\" INTEGER NULL, \
                 \"cloudIndexedAt\" INTEGER NULL, \
                 \"lastError\" TEXT NULL, \
                 \"createdAt\" INTEGER NOT NULL, \
                 \"updatedAt\" INTEGER NOT NULL)",
            "CREATE INDEX IF NOT EXISTS idx_knowledge_index_state_cloud ON knowledge_index_state (\"cloudStatus\", \"updatedAt\")",
            // ── 自动化 ──
            // owner=client 由本机 worker 跑；owner=cloud 时 \"remoteId\" 记服务端任务 id，本地只镜像状态。
            // \"runAsKind\"=user 以创建者身份跑（需校验仍是租户成员）；=tenant 以租户服务身份跑（团队共享库）。
            "CREATE TABLE IF NOT EXISTS automation (\
                 id TEXT PRIMARY KEY NOT NULL, \
                 name TEXT NOT NULL, \
                 prompt TEXT NOT NULL, \
                 \"knowledgeBaseId\" TEXT NULL, \
                 schedule TEXT NOT NULL, \
                 timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai', \
                 enabled INTEGER NOT NULL DEFAULT 1, \
                 owner TEXT NOT NULL DEFAULT '021', \
                 \"runAsKind\" TEXT NOT NULL DEFAULT '024', \
                 \"runAsUserId\" TEXT NULL, \
                 \"tenantId\" TEXT NULL, \
                 \"remoteId\" TEXT NULL, \
                 \"nextRunAt\" INTEGER NULL, \
                 \"lastRunAt\" INTEGER NULL, \
                 \"lastStatus\" TEXT NULL, \
                 \"lastError\" TEXT NULL, \
                 \"createdAt\" INTEGER NOT NULL, \
                 \"updatedAt\" INTEGER NOT NULL)",
            "CREATE INDEX IF NOT EXISTS idx_automation_due ON automation (enabled, \"nextRunAt\")",
            // \"triggerKind\" 区分准点 / 手动 / 重启补跑（补跑只补一次）；
            // \"runAsKind\"+\"runAsUserId\" 留档本次实际以谁的身份执行。
            "CREATE TABLE IF NOT EXISTS automation_run (\
                 id TEXT PRIMARY KEY NOT NULL, \
                 \"automationId\" TEXT NOT NULL, \
                 \"scheduledFor\" INTEGER NOT NULL, \
                 \"triggerKind\" TEXT NOT NULL DEFAULT '018', \
                 \"runAsKind\" TEXT NOT NULL DEFAULT '024', \
                 \"runAsUserId\" TEXT NULL, \
                 \"startedAt\" INTEGER NULL, \
                 \"finishedAt\" INTEGER NULL, \
                 status TEXT NOT NULL DEFAULT '014', \
                 output TEXT NULL, \
                 error TEXT NULL, \
                 \"createdAt\" INTEGER NOT NULL, \
                 CONSTRAINT fk_automation_run_automation FOREIGN KEY (\"automationId\") \
                     REFERENCES automation (id) ON DELETE CASCADE ON UPDATE CASCADE)",
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_run_slot ON automation_run (\"automationId\", \"scheduledFor\")",
            "CREATE INDEX IF NOT EXISTS idx_automation_run_status ON automation_run (status, \"createdAt\")",
            // ── 指令草稿收件箱（agent 生成，用户确认后才写入 corex.db）──
            "CREATE TABLE IF NOT EXISTS directive_draft (\
                 id TEXT PRIMARY KEY NOT NULL, \
                 \"threadId\" TEXT NULL, \
                 \"workspaceId\" TEXT NULL, \
                 name TEXT NOT NULL, \
                 definition TEXT NOT NULL, \
                 status TEXT NOT NULL DEFAULT '026', \
                 error TEXT NULL, \
                 \"createdAt\" INTEGER NOT NULL, \
                 \"updatedAt\" INTEGER NOT NULL)",
            "CREATE INDEX IF NOT EXISTS idx_directive_draft_status ON directive_draft (status, \"updatedAt\")",
        ] {
            db.execute_unprepared(statement).await?;
        }

        for statement in super::agent_plan_schema::statements() {
            db.execute_unprepared(statement).await?;
        }

        for statement in super::dict_seed::statements() {
            db.execute_unprepared(&statement).await?;
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        // 本文件新增的表：先删依赖方，再走原有的删表顺序（索引/触发器随表一起消失）
        for table in [
            "knowledge_doc_fts",
            "agent_goal",
            "agent_plan",
            "directive_draft",
            "automation_run",
            "automation",
            "knowledge_index_state",
            "knowledge_doc",
            "knowledge_base",
            "dict_tenant_item",
            "dict_type_item",
            "dict_item",
            "dict_type",
            "signboard_entry_asset",
            "bookmark",
            "album",
        ] {
            db.execute_unprepared(&format!("DROP TABLE IF EXISTS {table}"))
                .await?;
        }
        for index in [
            "idx_signboard_automation_board_id_index",
            "idx_signboard_check_entry_id_index",
            "idx_signboard_tagged_tag_id",
            "idx_signboard_tag_board_id_title",
            "idx_signboard_tag_board_id",
            "idx_signboard_entry_start_at",
            "idx_signboard_entry_due_at",
            "idx_signboard_entry_reminder_id",
            "idx_signboard_entry_column_id_index",
            "idx_signboard_column_board_id_index",
            "idx_signboard_index",
        ] {
            db.execute_unprepared(&format!("DROP INDEX IF EXISTS {index}"))
                .await?;
        }

        manager
            .drop_table(Table::drop().table(SignboardAutomation::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(SignboardCheck::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(SignboardTagged::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(SignboardTag::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(SignboardEntry::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(SignboardColumn::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Signboard::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Calendar::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Reminder::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(MagneticTile::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Mirror::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Asset::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Countdown::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(AgentUsage::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(AgentMessage::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(AgentSession::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(AgentWorkspaceFolder::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(AgentWorkspace::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(AgentProvider::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Overlay::Table).to_owned())
            .await?;

        Ok(())
    }
}

#[derive(Iden)]
enum Countdown {
    Table,
    Id,
    #[iden = "workStart"]
    WorkStart,
    #[iden = "workEnd"]
    WorkEnd,
    #[iden = "workDays"]
    WorkDays,
    #[iden = "monthlySalary"]
    MonthlySalary,
    #[iden = "payDay"]
    PayDay,
    #[iden = "archivedAt"]
    ArchivedAt,
    #[iden = "createdAt"]
    CreatedAt,
    #[iden = "updatedAt"]
    UpdatedAt,
}

#[derive(Iden)]
enum Reminder {
    Table,
    Id,
    Title,
    Notes,
    #[iden = "dueAt"]
    DueAt,
    #[iden = "endAt"]
    EndAt,
    #[iden = "fireTime"]
    FireTime,
    #[iden = "weekDays"]
    WeekDays,
    #[iden = "entireDay"]
    EntireDay,
    Enabled,
    #[iden = "snoozeUntil"]
    SnoozeUntil,
    #[iden = "lastFiredAt"]
    LastFiredAt,
    Priority,
    #[iden = "archivedAt"]
    ArchivedAt,
    #[iden = "createdAt"]
    CreatedAt,
    #[iden = "updatedAt"]
    UpdatedAt,
}

#[derive(Iden)]
enum Calendar {
    Table,
    Id,
    Title,
    Notes,
    #[iden = "startAt"]
    StartAt,
    #[iden = "endAt"]
    EndAt,
    #[iden = "entireDay"]
    EntireDay,
    Color,
    #[iden = "reminderID"]
    ReminderID,
    #[iden = "archivedAt"]
    ArchivedAt,
    #[iden = "createdAt"]
    CreatedAt,
    #[iden = "updatedAt"]
    UpdatedAt,
}

#[derive(Iden)]
enum Mirror {
    Table,
    Id,
    Title,
    Index,
    Mark,
    Description,
    Overlay,
    Background,
    Backdrop,
    #[iden = "archivedAt"]
    ArchivedAt,
    #[iden = "createdAt"]
    CreatedAt,
    #[iden = "updatedAt"]
    UpdatedAt,
}

#[derive(Iden)]
enum MagneticTile {
    #[iden = "magneticTile"]
    Table,
    Id,
    Index,
    Title,
    Round,
    Url,
    Mark,
    Component,
    Description,
    Background,
    Backdrop,
    Size,
    Shape,
    Direction,

    #[iden = "downloadCount"]
    DownloadCount,
    #[iden = "textColor"]
    TextColor,
    #[iden = "mirrorID"]
    MirrorID,
    #[iden = "collectionID"]
    CollectionID,
    #[iden = "archivedAt"]
    ArchivedAt,
    #[iden = "createdAt"]
    CreatedAt,
    #[iden = "updatedAt"]
    UpdatedAt,
}

#[derive(Iden)]
enum Asset {
    Table,
    Id,
    #[iden = "tenantID"]
    TenantId,
    Kind,
    Hash,
    Sha,
    Size,
    Index,
    Mime,
    Extension,
    #[iden = "fileName"]
    FileName,
    #[iden = "filePath"]
    FilePath,
    Metadata,
    Status,
    #[iden = "deviceID"]
    DeviceId,
    #[iden = "archivedAt"]
    ArchivedAt,
    #[iden = "createdAt"]
    CreatedAt,
    #[iden = "updatedAt"]
    UpdatedAt,
}

#[derive(Iden)]
enum Overlay {
    Table,
    Id,
    Kind,
    X,
    Y,
    W,
    H,
    Z,
    Src,
    Opacity,
    #[iden = "tenantID"]
    TenantId,
    Component,
    Size,
    Shape,
    Direction,
    Round,
    Background,
    Title,
    Mark,
    Scale,
    #[iden = "archivedAt"]
    ArchivedAt,
    #[iden = "createdAt"]
    CreatedAt,
    #[iden = "updatedAt"]
    UpdatedAt,
}

#[derive(Iden)]
enum AgentWorkspace {
    #[iden = "agent_workspace"]
    Table,
    Id,
    Title,
    Icon,
    Color,
    Pinned,
    #[iden = "archivedAt"]
    ArchivedAt,
    #[iden = "createdAt"]
    CreatedAt,
    #[iden = "updatedAt"]
    UpdatedAt,
}

#[derive(Iden)]
enum AgentWorkspaceFolder {
    #[iden = "agent_workspace_folder"]
    Table,
    Id,
    #[iden = "workspaceID"]
    WorkspaceID,
    Path,
    Sort,
    #[iden = "createdAt"]
    CreatedAt,
    #[iden = "updatedAt"]
    UpdatedAt,
}

#[derive(Iden)]
enum AgentSession {
    #[iden = "agent_session"]
    Table,
    Id,
    Title,
    Pinned,
    #[iden = "providerID"]
    ProviderId,
    #[iden = "workspaceID"]
    WorkspaceID,
    #[iden = "createdAt"]
    CreatedAt,
    #[iden = "updatedAt"]
    UpdatedAt,
}

#[derive(Iden)]
enum AgentMessage {
    #[iden = "agent_message"]
    Table,
    Id,
    Content,
    #[iden = "parentID"]
    ParentId,
    Format,
    #[iden = "sessionID"]
    SessionID,
    #[iden = "createdAt"]
    CreatedAt,
    #[iden = "updatedAt"]
    UpdatedAt,
}

#[derive(Iden)]
enum AgentProvider {
    #[iden = "agent_provider"]
    Table,
    Id,
    Kind,
    Name,
    #[iden = "baseUrl"]
    BaseUrl,
    Models,
    Model,
    Enabled,
    #[iden = "createdAt"]
    CreatedAt,
    #[iden = "updatedAt"]
    UpdatedAt,
}

#[derive(Iden)]
enum AgentUsage {
    #[iden = "agent_usage"]
    Table,
    Id,
    #[iden = "runID"]
    RunId,
    #[iden = "sessionID"]
    SessionId,
    #[iden = "providerID"]
    ProviderId,
    Model,
    #[iden = "inputTokens"]
    InputTokens,
    #[iden = "outputTokens"]
    OutputTokens,
    #[iden = "totalTokens"]
    TotalTokens,
    #[iden = "createdAt"]
    CreatedAt,
}

#[derive(Iden)]
enum Signboard {
    Table,
    Id,
    Title,
    Index,
    ArchivedAt,
    SyncedAt,
    CreatedAt,
    UpdatedAt,
}

#[derive(Iden)]
enum SignboardColumn {
    #[iden = "signboard_column"]
    Table,
    Id,
    BoardId,
    Title,
    Index,
    Color,
    WipLimit,
    Role,
    ArchivedAt,
    CreatedAt,
    UpdatedAt,
}

#[derive(Iden)]
enum SignboardEntry {
    #[iden = "signboard_entry"]
    Table,
    Id,
    ColumnId,
    Title,
    Notes,
    Index,
    DueAt,
    StartAt,
    ReminderId,
    Priority,
    Color,
    Progress,
    ArchivedAt,
    CreatedAt,
    UpdatedAt,
}

#[derive(Iden)]
enum SignboardTag {
    #[iden = "signboard_tag"]
    Table,
    Id,
    BoardId,
    Title,
    Color,
    CreatedAt,
    UpdatedAt,
}

#[derive(Iden)]
enum SignboardTagged {
    #[iden = "signboard_tagged"]
    Table,
    EntryId,
    TagId,
}

#[derive(Iden)]
enum SignboardCheck {
    #[iden = "signboard_check"]
    Table,
    Id,
    EntryId,
    Title,
    Done,
    Index,
    CreatedAt,
    UpdatedAt,
}

#[derive(Iden)]
enum SignboardAutomation {
    #[iden = "signboard_automation"]
    Table,
    Id,
    BoardId,
    Title,
    Enabled,
    Trigger,
    ConditionJson,
    ActionJson,
    Index,
    CreatedAt,
    UpdatedAt,
}
