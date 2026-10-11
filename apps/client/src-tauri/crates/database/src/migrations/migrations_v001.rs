//! Agent workspace schema（aiWorkspace / aiWorkspaceFolder / aiProvider）。
//! 未发版阶段以本文件为唯一真相；若本地库仍是旧 aiCollection 结构，请删除应用数据库后重建。
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

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
                            .default("001"),
                    )
                    .col(
                        ColumnDef::new(Asset::Version)
                            .big_integer()
                            .not_null()
                            .default(1),
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
                    .table(User::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(User::Id).string().not_null().primary_key())
                    .col(ColumnDef::new(User::Username).string().not_null())
                    .col(ColumnDef::new(User::Password).string().not_null())
                    .col(ColumnDef::new(User::Avatar).string().not_null().default(""))
                    .col(ColumnDef::new(User::DeviceId).string().not_null())
                    .col(ColumnDef::new(User::ArchivedAt).big_integer().null())
                    .col(ColumnDef::new(User::CreatedAt).big_integer().not_null())
                    .col(ColumnDef::new(User::UpdatedAt).big_integer().not_null())
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(Notification::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Notification::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Notification::Type).string().not_null())
                    .col(ColumnDef::new(Notification::Title).string().not_null())
                    .col(ColumnDef::new(Notification::Body).string().not_null())
                    .col(ColumnDef::new(Notification::TenantId).string().null())
                    .col(
                        ColumnDef::new(Notification::Version)
                            .big_integer()
                            .not_null()
                            .default(1),
                    )
                    .col(ColumnDef::new(Notification::DeviceId).string().not_null())
                    .col(
                        ColumnDef::new(Notification::ArchivedAt)
                            .big_integer()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(Notification::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(Notification::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(Comment::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Comment::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Comment::TenantId).string().not_null())
                    .col(ColumnDef::new(Comment::Username).string().not_null())
                    .col(
                        ColumnDef::new(Comment::Avatar)
                            .string()
                            .not_null()
                            .default(""),
                    )
                    .col(ColumnDef::new(Comment::Description).string().not_null())
                    .col(
                        ColumnDef::new(Comment::Version)
                            .big_integer()
                            .not_null()
                            .default(1),
                    )
                    .col(ColumnDef::new(Comment::DeviceId).string().not_null())
                    .col(ColumnDef::new(Comment::ArchivedAt).big_integer().null())
                    .col(ColumnDef::new(Comment::CreatedAt).big_integer().not_null())
                    .col(ColumnDef::new(Comment::UpdatedAt).big_integer().not_null())
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

        // ── magnetic tile 种子数据 ──
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('d50246f5-1a28-4659-b002-a31448c1382d',0,'书签',NULL,'12px',NULL,'bookmark','书签','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('a9908a07-e685-49d9-a517-0caf7ce27e75',1,'日历',NULL,'12px',NULL,'calendar','日历','{"color":"#FFFFFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('b0ed3c9e-9bec-409f-9303-e4b51f361d0d',2,'时钟',NULL,'12px',NULL,'clock','时钟','{"color":"#FFFFFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('0dac7ddf-c4ee-46cd-88cf-802d0f32ee08',3,'倒计时',NULL,'12px',NULL,'countdown','倒计时','{"color":"#FFFFFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('9c06aee0-dfa2-4807-bd8b-d51cde7d5687',4,'代码',NULL,'12px',NULL,'code','代码','{"color":"#E2E8F0"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('5c03e12b-f7c1-4312-a9f5-ebe410915f1e',5,'Clipchamp',NULL,'12px',NULL,'clipchamp','Clipchamp','{"color":"#DBEAFE"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','1E3A8A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('9ba4c4a7-ccd7-4965-b447-5d74a9f96b56',6,'应用集合',NULL,'12px',NULL,'collection','应用集合','{"color":"#E0E7FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','312E81',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('bc55915c-5552-4e65-95c6-bb88c28f8060',7,'应用商店',NULL,'12px',NULL,'marketplace','应用商店','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','1E40AF',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('63e46df5-44a7-494f-a9ca-b4303186a511',8,'备忘录',NULL,'12px',NULL,'markdown','备忘录','{"color":"#ECFDF5"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','065F46',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('447f9800-edaa-4f85-a0f1-97b76e375706',9,'morph',NULL,'12px',NULL,'morph','morph','{"color":"#F5F3FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','5B21B6',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('705ad233-7068-4c45-a079-967e5a79a6d6',10,'设置',NULL,'12px',NULL,'settings','设置','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('f3ed970a-b07c-44bc-b54d-4bdfb454f207',11,'AI Hub',NULL,'12px',NULL,'agent','AI Hub','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','3730A3',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('4079625f-fbf4-4c29-8b1a-3b2236aeaf37',12,'开发者',NULL,'12px',NULL,'developer','开发者','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','334155',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('34bca8e6-b96f-498b-a0f1-86aba76663db',13,'图库',NULL,'12px',NULL,'gallery','图库','{"color":"#FFF7ED"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','9A3412',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('83bbda55-d029-4a24-bb76-328843d616f9',14,'看板',NULL,'12px',NULL,'signboard','看板','{"color":"#FEF3C7"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','92400E',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('f4e10078-03d0-45b8-86f9-4f7cab94abf9',15,'截屏',NULL,'12px',NULL,'capture','截屏','{"color":"#F0FDFA"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','115E59',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('b2c3d4e5-6f70-4a81-9b2c-3d4e5f6a7b8c',16,'指令',NULL,'12px',NULL,'directive','指令','{"color":"#F5F3FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','5B21B6',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('6f7714eb-bfa1-4b15-b56f-d095ff9100a3',17,'百度','https://www.baidu.com','12px',NULL,'navigation','百度','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('4bd86ab9-4212-4558-a4c2-38db37f591e3',18,'谷歌','https://www.google.com','12px',NULL,'navigation','谷歌','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('f2e2547d-9745-4197-b349-8638d278cc36',19,'必应','https://cn.bing.com','12px',NULL,'navigation','必应','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('03e9bb30-3691-4a07-8c74-80efd5c853b8',20,'搜狗','https://www.sogou.com','12px',NULL,'navigation','搜狗','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('17431d5f-1c90-45e5-bf5e-e9ffa4adea1d',21,'淘宝','https://www.taobao.com','12px',NULL,'navigation','淘宝','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('23b6ab4b-a8fd-4ce1-86b7-27026b72b255',22,'天猫','https://www.tmall.com','12px',NULL,'navigation','天猫','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('efe7323e-ca08-4271-a722-2520a04cf9cb',23,'京东','https://www.jd.com','12px',NULL,'navigation','京东','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('351a16cb-fc35-470e-bfd1-99bc596269ad',24,'拼多多','https://www.pinduoduo.com','12px',NULL,'navigation','拼多多','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('af6c2295-6a68-41bf-a5c9-d57e690c5b75',25,'唯品会','https://www.vip.com','12px',NULL,'navigation','唯品会','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('aa1a8732-390b-4855-b82c-c9d10720cfd6',26,'苏宁','https://www.suning.com','12px',NULL,'navigation','苏宁','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('bc096178-12f6-4693-9b1b-70d58b92b67c',27,'亚马逊','https://www.amazon.cn','12px',NULL,'navigation','亚马逊','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('95ac781e-cefa-4cdd-bf13-395b241e3f0a',28,'微博','https://www.weibo.com','12px',NULL,'navigation','微博','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('24c0121d-bd8a-487c-89c5-361a9b09bf00',29,'知乎','https://www.zhihu.com','12px',NULL,'navigation','知乎','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('e9905858-0692-49d3-bcdf-4c232c9f79b1',30,'豆瓣','https://www.douban.com','12px',NULL,'navigation','豆瓣','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('1577b2b3-4dc3-4ad4-a23d-a5761523824a',31,'小红书','https://www.xiaohongshu.com','12px',NULL,'navigation','小红书','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('d42bfd7a-9995-4a5e-84c4-023069d14e16',32,'抖音','https://www.douyin.com','12px',NULL,'navigation','抖音','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('c414e0b5-fabf-4608-b09d-fcca0f75e687',33,'快手','https://www.kuaishou.com','12px',NULL,'navigation','快手','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('eea094dc-8069-4f53-9786-a095c0359dee',34,'哔哩哔哩','https://www.bilibili.com','12px',NULL,'navigation','哔哩哔哩','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('19773bd4-226b-4c9c-b2ee-8b86388218a7',35,'爱奇艺','https://www.iqiyi.com','12px',NULL,'navigation','爱奇艺','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('31445583-32e0-4cdc-95eb-0037d5a9430f',36,'优酷','https://www.youku.com','12px',NULL,'navigation','优酷','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('a80858a7-e4db-44f5-8915-51912c54718d',37,'腾讯视频','https://v.qq.com','12px',NULL,'navigation','腾讯视频','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('3419baa2-01dc-42b5-8f6e-ffe6dea0f07d',38,'芒果TV','https://www.mgtv.com','12px',NULL,'navigation','芒果TV','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('7a9354a9-9994-49be-8b02-18c4e3a265a5',39,'网易云音乐','https://music.163.com','12px',NULL,'navigation','网易云音乐','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('8e3f9f3e-0021-4844-8d2d-4d2b34d64a6a',40,'QQ音乐','https://y.qq.com','12px',NULL,'navigation','QQ音乐','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('7a5b8084-26f7-40d7-a23d-650219517e67',41,'喜马拉雅','https://www.ximalaya.com','12px',NULL,'navigation','喜马拉雅','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('9d4925e5-4900-4141-8c5d-f3cb459b1de2',42,'今日头条','https://www.toutiao.com','12px',NULL,'navigation','今日头条','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('79697495-caa5-411c-ac92-b0d04696a140',43,'澎湃新闻','https://www.thepaper.cn','12px',NULL,'navigation','澎湃新闻','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('86261827-496d-4547-aacc-01421ca564bc',44,'新浪','https://www.sina.com.cn','12px',NULL,'navigation','新浪','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('6a53ed91-1feb-4dc8-914d-95ee39f7c093',45,'网易','https://www.163.com','12px',NULL,'navigation','网易','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('6f32556e-2bc8-4705-bc5e-cfaa399bf3fe',46,'搜狐','https://www.sohu.com','12px',NULL,'navigation','搜狐','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('65ac9a9a-3c2f-4ab8-a69d-3a0526ce03c2',47,'凤凰网','https://www.ifeng.com','12px',NULL,'navigation','凤凰网','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('1af5dae8-7e3d-47ac-a5fd-e6d34194b2ca',48,'央视网','https://www.cctv.com','12px',NULL,'navigation','央视网','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('6b26ffde-9706-43b3-9cab-99c0ddf35a3f',49,'人民网','https://www.people.com.cn','12px',NULL,'navigation','人民网','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('13be255a-ef23-4db2-bee7-41f223680518',50,'新华网','https://www.xinhuanet.com','12px',NULL,'navigation','新华网','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('41b66840-d6a6-4f98-8aba-f669b9140e1f',51,'QQ','https://www.qq.com','12px',NULL,'navigation','QQ','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('1531bce3-d3d1-4adb-8dd5-263622278aa7',52,'微信','https://weixin.qq.com','12px',NULL,'navigation','微信','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('068d74e8-e37f-4e29-9d6d-c41a6c3a1b53',53,'美团','https://www.meituan.com','12px',NULL,'navigation','美团','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('579cc41b-bd2a-40a4-b616-eb583136bb2f',54,'大众点评','https://www.dianping.com','12px',NULL,'navigation','大众点评','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('c970652c-d2b7-4d11-93e8-1520cd6444a0',55,'饿了么','https://www.ele.me','12px',NULL,'navigation','饿了么','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('fdaadd19-0457-4a5d-8a46-b0c07d7486f3',56,'携程','https://www.ctrip.com','12px',NULL,'navigation','携程','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('0088a65f-3778-44b1-81c5-7e9d89942476',57,'去哪儿','https://www.qunar.com','12px',NULL,'navigation','去哪儿','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('eefce361-dcae-4bee-bdfb-b9f674b58a37',58,'飞猪','https://www.fliggy.com','12px',NULL,'navigation','飞猪','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('7204a70e-c65e-4fee-8b93-2aa939c397ee',59,'12306','https://www.12306.cn','12px',NULL,'navigation','12306','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('c422c1de-1ed0-49c8-afd2-3ed1f583b403',60,'高德地图','https://www.amap.com','12px',NULL,'navigation','高德地图','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('3fe7ac92-5a3e-43a1-8c11-57fe951b23d2',61,'百度地图','https://map.baidu.com','12px',NULL,'navigation','百度地图','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('1612badf-f7fa-4754-96fa-330f584a1143',62,'滴滴','https://www.didiglobal.com','12px',NULL,'navigation','滴滴','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('782a6f99-65db-48e4-8e0b-bef5366ba6dd',63,'GitHub','https://github.com','12px',NULL,'navigation','GitHub','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('1c09b1b2-f445-492a-9a3b-165e3c340e0a',64,'Gitee','https://gitee.com','12px',NULL,'navigation','Gitee','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('5c8532e2-ec5d-4e9b-acdd-36d6312e8ce4',65,'GitLab','https://gitlab.com','12px',NULL,'navigation','GitLab','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('e05d0af1-afcd-468a-8c41-a7b18a6b29a5',66,'Stack Overflow','https://stackoverflow.com','12px',NULL,'navigation','Stack Overflow','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('42da558d-e8e6-4dd4-99a7-b8e9ecdafc88',67,'MDN','https://developer.mozilla.org','12px',NULL,'navigation','MDN','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('af4721f2-a8bf-4ac8-af07-ab882e87a0f3',68,'npm','https://www.npmjs.com','12px',NULL,'navigation','npm','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('b8eabeb4-26f6-4a2b-b820-eab21a0ef3dc',69,'Rust','https://www.rust-lang.org','12px',NULL,'navigation','Rust','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('7960facb-f64c-4f8c-a613-53cfd9d094df',70,'Vue','https://vuejs.org','12px',NULL,'navigation','Vue','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('497fdc3a-5a3a-41ba-9432-d3c97cc8565c',71,'React','https://react.dev','12px',NULL,'navigation','React','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('57ddf3b0-d1a5-4e03-9f08-d20320f7f49b',72,'TypeScript','https://www.typescriptlang.org','12px',NULL,'navigation','TypeScript','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('08941c90-b9bb-4a10-ad18-d23c20467c16',73,'Vite','https://vitejs.dev','12px',NULL,'navigation','Vite','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('73d3133a-1640-4af0-99a5-49170390c17d',74,'Tailwind','https://tailwindcss.com','12px',NULL,'navigation','Tailwind','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('efa65bcb-c9be-453e-b208-bec00b010d26',75,'Ant Design','https://ant.design','12px',NULL,'navigation','Ant Design','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('7d2462fb-3e50-4535-9c67-d108f38af375',76,'Element Plus','https://element-plus.org','12px',NULL,'navigation','Element Plus','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('50696631-41c9-49db-b43f-71edcd25ad1d',77,'Iconify','https://icon-sets.iconify.design','12px',NULL,'navigation','Iconify','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('4b2a5c18-47bc-46ac-b30f-831a1b8f137a',78,'Can I Use','https://caniuse.com','12px',NULL,'navigation','Can I Use','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('3690f123-7b55-4914-9d18-15e14a74d6dc',79,'正则101','https://regex101.com','12px',NULL,'navigation','正则101','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('718b6155-26ff-4170-9457-c81f15e803f8',80,'JSON','https://json.cn','12px',NULL,'navigation','JSON','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('5db1b934-a452-49e0-b1c3-000f5990d4f5',81,'Excalidraw','https://excalidraw.com','12px',NULL,'navigation','Excalidraw','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('c2285e63-91ac-453a-8783-08ef2304875c',82,'Figma','https://www.figma.com','12px',NULL,'navigation','Figma','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('376c0894-8fcd-468d-b96e-14e4bfe2c519',83,'Notion','https://www.notion.so','12px',NULL,'navigation','Notion','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('b0cefb37-33db-4992-a453-2607296d46ac',84,'语雀','https://www.yuque.com','12px',NULL,'navigation','语雀','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('baaef2e9-1a81-4c6b-962d-b33284272f73',85,'飞书','https://www.feishu.cn','12px',NULL,'navigation','飞书','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('c3b1e910-7ac7-4526-ba3d-cf3d0a903006',86,'钉钉','https://www.dingtalk.com','12px',NULL,'navigation','钉钉','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('5d29ccb2-933d-43f7-94f6-1d6334b1c5f9',87,'腾讯文档','https://docs.qq.com','12px',NULL,'navigation','腾讯文档','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('2a876e1a-1996-466d-af46-a99a21774aa8',88,'石墨文档','https://shimo.im','12px',NULL,'navigation','石墨文档','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('f57e37ee-4335-42f7-91fb-8417e31e61c6',89,'CSDN','https://www.csdn.net','12px',NULL,'navigation','CSDN','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('c8e69a5a-42c1-4fcb-9976-2d595b5c39bf',90,'掘金','https://juejin.cn','12px',NULL,'navigation','掘金','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('66e368ae-5e33-49fb-a36a-431b543c2e42',91,'思否','https://segmentfault.com','12px',NULL,'navigation','思否','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('cf964a4c-6485-4bae-b145-6781ffe9ec68',92,'开源中国','https://www.oschina.net','12px',NULL,'navigation','开源中国','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('a07875e7-1345-4e50-b675-59ef91eb8ddd',93,'V2EX','https://www.v2ex.com','12px',NULL,'navigation','V2EX','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('3fb55802-a145-4c75-9371-997acc3ddae5',94,'少数派','https://sspai.com','12px',NULL,'navigation','少数派','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('8018c361-dc2b-45d2-8b6b-e451b55db7fb',95,'即刻','https://web.okjike.com','12px',NULL,'navigation','即刻','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('fdc45c93-cf66-46e2-b830-70141de8cf47',96,'YouTube','https://www.youtube.com','12px',NULL,'navigation','YouTube','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('2b5259a5-d66b-41f1-81c8-8dc3e57ceb14',97,'Twitter','https://x.com','12px',NULL,'navigation','Twitter','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('c5198173-723f-4bc0-8042-91130566c8d2',98,'Reddit','https://www.reddit.com','12px',NULL,'navigation','Reddit','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('a43096ef-c9df-4e08-a57a-ba4020937de7',99,'Wikipedia','https://www.wikipedia.org','12px',NULL,'navigation','Wikipedia','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('48b51c2e-7f61-43c6-9cf8-e10fb45ef799',100,'ChatGPT','https://chatgpt.com','12px',NULL,'navigation','ChatGPT','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('1afca13c-c686-41ed-9d91-8837126bd8c4',101,'Claude','https://claude.ai','12px',NULL,'navigation','Claude','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('a4dbc3e2-15e7-4423-be57-ce708a05de0b',102,'Gemini','https://gemini.google.com','12px',NULL,'navigation','Gemini','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('0d7669f0-1ada-4064-9251-cc71289fe714',103,'DeepSeek','https://chat.deepseek.com','12px',NULL,'navigation','DeepSeek','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('d0fe983b-2db5-4137-9169-16f8cd457b32',104,'通义千问','https://tongyi.aliyun.com','12px',NULL,'navigation','通义千问','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('732bddb5-1fbf-4f4a-9ae5-08d1d82a34d2',105,'Kimi','https://kimi.moonshot.cn','12px',NULL,'navigation','Kimi','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('c55e845f-7d06-4578-9e7e-ff1c43649a38',106,'文心一言','https://yiyan.baidu.com','12px',NULL,'navigation','文心一言','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('4a53f95d-7ec8-4454-b371-cc7f64eb37a9',107,'智谱清言','https://chatglm.cn','12px',NULL,'navigation','智谱清言','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('07c5ecd9-27be-48da-943e-209d8f5b5b47',108,'LeetCode','https://leetcode.cn','12px',NULL,'navigation','LeetCode','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('6081db3b-97c2-4f55-be8b-88f751c50bb2',109,'牛客','https://www.nowcoder.com','12px',NULL,'navigation','牛客','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('82b7457d-93ca-4052-9ed3-39f1577b85b4',110,'Coursera','https://www.coursera.org','12px',NULL,'navigation','Coursera','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('3c6fdafd-c293-4548-a97d-8c3579d6d60a',111,'B站课堂','https://www.bilibili.com/cheese','12px',NULL,'navigation','B站课堂','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('5aa8b078-f8b4-4ce2-b2b6-1f90314c36fc',112,'中国大学MOOC','https://www.icourse163.org','12px',NULL,'navigation','中国大学MOOC','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('1cdc2c31-cad1-4eea-b492-ffbc47dcc348',113,'支付宝','https://www.alipay.com','12px',NULL,'navigation','支付宝','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('af30a364-b8e7-4afe-a315-af4212b141a4',114,'招商银行','https://www.cmbchina.com','12px',NULL,'navigation','招商银行','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('634b63c3-ca81-476a-99b0-ce0c07276c3c',115,'东方财富','https://www.eastmoney.com','12px',NULL,'navigation','东方财富','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('b1b9d20b-9e23-4ae1-8698-d2911b7326df',116,'雪球','https://xueqiu.com','12px',NULL,'navigation','雪球','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('d758f23a-cd1d-4a42-abd8-b15392229546',117,'闲鱼','https://www.goofish.com','12px',NULL,'navigation','闲鱼','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('3aa9d82c-8d67-4f13-a902-d75ef3633794',118,'什么值得买','https://www.smzdm.com','12px',NULL,'navigation','什么值得买','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('d6023a0a-adeb-4776-b8be-edee221a8f6f',119,'汽车之家','https://www.autohome.com.cn','12px',NULL,'navigation','汽车之家','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('907a747c-8636-4499-afd5-4146eace73c7',120,'安居客','https://www.anjuke.com','12px',NULL,'navigation','安居客','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('b57cf7f4-a8e3-4501-87b7-8a9e333e8768',121,'链家','https://www.lianjia.com','12px',NULL,'navigation','链家','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('36cbdf06-95dc-479c-a6c6-6c705de8f4a5',122,'Boss直聘','https://www.zhipin.com','12px',NULL,'navigation','Boss直聘','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('f0f4b870-d4ca-461d-bbda-f2de3aa67c0b',123,'智联招聘','https://www.zhaopin.com','12px',NULL,'navigation','智联招聘','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('be436f78-a7c2-438b-8250-327a6b0eadf3',124,'拉勾','https://www.lagou.com','12px',NULL,'navigation','拉勾','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('10bcf04e-a64b-47f3-92f8-83d72f0eb93a',125,'译学馆','https://www.yxgapp.com','12px',NULL,'navigation','译学馆','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('83d74d02-594b-451c-8847-9531eae3fd93',126,'IconFont','https://www.iconfont.cn','12px',NULL,'navigation','IconFont','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('aaac07f3-2964-4884-8381-64590cd75748',127,'Unsplash','https://unsplash.com','12px',NULL,'navigation','Unsplash','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('b3c4fddc-458d-414f-9a31-eb1c311591e6',128,'Pexels','https://www.pexels.com','12px',NULL,'navigation','Pexels','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('73c5f14c-025d-4e68-8f05-669c81e4afae',129,'Dribbble','https://dribbble.com','12px',NULL,'navigation','Dribbble','{"color":"#EFF6FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('18fe5caa-c810-433c-9321-65f30293e5ea',130,'Product Hunt','https://www.producthunt.com','12px',NULL,'navigation','Product Hunt','{"color":"#F8FAFC"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('d52d0323-da74-4261-9157-ba46a89ab7a7',131,'Hacker News','https://news.ycombinator.com','12px',NULL,'navigation','Hacker News','{"color":"#F1F5F9"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('47a04baa-646e-4e5d-9434-2731d32f9819',132,'Arch Wiki','https://wiki.archlinux.org','12px',NULL,'navigation','Arch Wiki','{"color":"#EEF2FF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('621382a2-0911-448b-8ef2-a3980e09ddce',133,'Docker Hub','https://hub.docker.com','12px',NULL,'navigation','Docker Hub','{"color":"#F0FDF4"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('29bb5423-6f90-4520-957a-503d9e541d2b',134,'Cloudflare','https://www.cloudflare.com','12px',NULL,'navigation','Cloudflare','{"color":"#FFFBEB"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('ea161ec5-391a-49ce-9d78-fe91f96519bd',135,'Vercel','https://vercel.com','12px',NULL,'navigation','Vercel','{"color":"#FDF2F8"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;
        db.execute_unprepared(r##"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('3175fa5c-195f-4311-9d18-ecbc7c29f6d5',136,'Netlify','https://www.netlify.com','12px',NULL,'navigation','Netlify','{"color":"#ECFEFF"}',NULL,'b7bc5d50-3b4a-46d7-b834-2938df56de24','0F172A',NULL,1,'square','vertical',0,NULL,1785423438774,1785423438774)"##).await?;

        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_magnetic_tile_mirror ON magneticTile (mirrorID)",
        )
        .await?;
        db.execute_unprepared("CREATE INDEX IF NOT EXISTS idx_asset_hash ON asset (hash)")
            .await?;
        db.execute_unprepared("CREATE INDEX IF NOT EXISTS idx_asset_path ON asset (filePath)")
            .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_notif_tenant ON notification (tenantID)",
        )
        .await?;
        db.execute_unprepared("CREATE INDEX IF NOT EXISTS idx_cmt_tenant ON comment (tenantID)")
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

        // ── aiWorkspace / aiWorkspaceFolder / aiSession / aiMessage ──
        manager
            .create_table(
                Table::create()
                    .table(AiWorkspace::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AiWorkspace::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(AiWorkspace::Title).string().not_null())
                    .col(
                        ColumnDef::new(AiWorkspace::Icon)
                            .string()
                            .not_null()
                            .default("folder"),
                    )
                    .col(
                        ColumnDef::new(AiWorkspace::Color)
                            .string()
                            .not_null()
                            .default("#166534"),
                    )
                    .col(
                        ColumnDef::new(AiWorkspace::Pinned)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(ColumnDef::new(AiWorkspace::ArchivedAt).big_integer().null())
                    .col(
                        ColumnDef::new(AiWorkspace::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AiWorkspace::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(AiWorkspaceFolder::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AiWorkspaceFolder::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(AiWorkspaceFolder::WorkspaceID)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(AiWorkspaceFolder::Path).string().not_null())
                    .col(
                        ColumnDef::new(AiWorkspaceFolder::IsPrimary)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(
                        ColumnDef::new(AiWorkspaceFolder::Sort)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(AiWorkspaceFolder::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AiWorkspaceFolder::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_aiWorkspaceFolder_workspaceID")
                            .from(AiWorkspaceFolder::Table, AiWorkspaceFolder::WorkspaceID)
                            .to(AiWorkspace::Table, AiWorkspace::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::NoAction),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(AiSession::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AiSession::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(AiSession::Title).string().not_null())
                    .col(
                        ColumnDef::new(AiSession::Pinned)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(ColumnDef::new(AiSession::WorkspaceID).string().null())
                    .col(
                        ColumnDef::new(AiSession::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AiSession::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_aiSession_workspaceID")
                            .from(AiSession::Table, AiSession::WorkspaceID)
                            .to(AiWorkspace::Table, AiWorkspace::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::NoAction),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(AiMessage::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AiMessage::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(AiMessage::Identity).string().not_null())
                    .col(ColumnDef::new(AiMessage::Fragment).text().not_null())
                    .col(ColumnDef::new(AiMessage::Thinking).text().null())
                    .col(ColumnDef::new(AiMessage::Parts).text().null())
                    .col(ColumnDef::new(AiMessage::SessionID).string().not_null())
                    .col(
                        ColumnDef::new(AiMessage::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AiMessage::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_aiMessage_sessionID")
                            .from(AiMessage::Table, AiMessage::SessionID)
                            .to(AiSession::Table, AiSession::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::NoAction),
                    )
                    .to_owned(),
            )
            .await?;

        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_aiWorkspace_archivedAt ON aiWorkspace (archivedAt)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_aiWorkspaceFolder_workspaceID ON aiWorkspaceFolder (workspaceID)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_aiSession_workspaceID ON aiSession (workspaceID)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_aiSession_updatedAt ON aiSession (updatedAt)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_aiMessage_sessionID ON aiMessage (sessionID)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_aiMessage_createdAt ON aiMessage (createdAt)",
        )
        .await?;

        // ── aiProvider（模型接入配置；apiKey 不落库，存 plugin-store） ──
        manager
            .create_table(
                Table::create()
                    .table(AiProvider::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AiProvider::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(AiProvider::Kind).string().not_null())
                    .col(ColumnDef::new(AiProvider::Name).string().not_null())
                    .col(ColumnDef::new(AiProvider::BaseUrl).string().null())
                    .col(ColumnDef::new(AiProvider::Models).text().null())
                    .col(ColumnDef::new(AiProvider::Model).string().null())
                    .col(
                        ColumnDef::new(AiProvider::Enabled)
                            .boolean()
                            .not_null()
                            .default(true),
                    )
                    .col(
                        ColumnDef::new(AiProvider::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AiProvider::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_aiProvider_kind ON aiProvider (kind)",
        )
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
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
            .drop_table(Table::drop().table(Comment::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Notification::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(User::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Asset::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Countdown::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(AiMessage::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(AiSession::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(AiWorkspaceFolder::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(AiWorkspace::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(AiProvider::Table).to_owned())
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
    Version,
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
enum User {
    Table,
    Id,
    Username,
    Password,
    Avatar,
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
enum Notification {
    Table,
    Id,
    Type,
    Title,
    Body,
    #[iden = "archivedAt"]
    ArchivedAt,
    #[iden = "tenantID"]
    TenantId,
    Version,
    #[iden = "deviceID"]
    DeviceId,
    #[iden = "createdAt"]
    CreatedAt,
    #[iden = "updatedAt"]
    UpdatedAt,
}

#[derive(Iden)]
enum Comment {
    Table,
    Id,
    #[iden = "tenantID"]
    TenantId,
    Username,
    Avatar,
    Description,
    Version,
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
enum AiWorkspace {
    #[iden = "aiWorkspace"]
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
enum AiWorkspaceFolder {
    #[iden = "aiWorkspaceFolder"]
    Table,
    Id,
    #[iden = "workspaceID"]
    WorkspaceID,
    Path,
    #[iden = "isPrimary"]
    IsPrimary,
    Sort,
    #[iden = "createdAt"]
    CreatedAt,
    #[iden = "updatedAt"]
    UpdatedAt,
}

#[derive(Iden)]
enum AiSession {
    #[iden = "aiSession"]
    Table,
    Id,
    Title,
    Pinned,
    #[iden = "workspaceID"]
    WorkspaceID,
    #[iden = "createdAt"]
    CreatedAt,
    #[iden = "updatedAt"]
    UpdatedAt,
}

#[derive(Iden)]
enum AiMessage {
    #[iden = "aiMessage"]
    Table,
    Id,
    Identity,
    Fragment,
    Thinking,
    Parts,
    #[iden = "sessionID"]
    SessionID,
    #[iden = "createdAt"]
    CreatedAt,
    #[iden = "updatedAt"]
    UpdatedAt,
}

#[derive(Iden)]
enum AiProvider {
    #[iden = "aiProvider"]
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
