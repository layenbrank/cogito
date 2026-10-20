//! Signboard 看板：board / column / card / tag / cardTag。
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Signboard::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(Signboard::Id).string().not_null().primary_key())
                    .col(ColumnDef::new(Signboard::Title).string().not_null())
                    .col(
                        ColumnDef::new(Signboard::Index)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(ColumnDef::new(Signboard::ArchivedAt).big_integer().null())
                    .col(ColumnDef::new(Signboard::SyncedAt).big_integer().null())
                    .col(ColumnDef::new(Signboard::CreatedAt).big_integer().not_null())
                    .col(ColumnDef::new(Signboard::UpdatedAt).big_integer().not_null())
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
                    .col(ColumnDef::new(SignboardColumn::BoardID).string().not_null())
                    .col(ColumnDef::new(SignboardColumn::Title).string().not_null())
                    .col(
                        ColumnDef::new(SignboardColumn::Index)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(ColumnDef::new(SignboardColumn::Color).string().null())
                    .col(ColumnDef::new(SignboardColumn::WipLimit).integer().null())
                    .col(ColumnDef::new(SignboardColumn::ArchivedAt).big_integer().null())
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
                            .name("fk_signboardColumn_board")
                            .from(SignboardColumn::Table, SignboardColumn::BoardID)
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
                    .table(SignboardCard::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SignboardCard::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(SignboardCard::ColumnID).string().not_null())
                    .col(ColumnDef::new(SignboardCard::Title).string().not_null())
                    .col(
                        ColumnDef::new(SignboardCard::Notes)
                            .string()
                            .not_null()
                            .default(""),
                    )
                    .col(
                        ColumnDef::new(SignboardCard::Index)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(ColumnDef::new(SignboardCard::DueAt).big_integer().null())
                    .col(ColumnDef::new(SignboardCard::ReminderID).string().null())
                    .col(
                        ColumnDef::new(SignboardCard::Priority)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(ColumnDef::new(SignboardCard::Color).string().null())
                    .col(ColumnDef::new(SignboardCard::ArchivedAt).big_integer().null())
                    .col(
                        ColumnDef::new(SignboardCard::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SignboardCard::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_signboardCard_column")
                            .from(SignboardCard::Table, SignboardCard::ColumnID)
                            .to(SignboardColumn::Table, SignboardColumn::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_signboardCard_reminder")
                            .from(SignboardCard::Table, SignboardCard::ReminderID)
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
                    .col(ColumnDef::new(SignboardTag::BoardID).string().not_null())
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
                            .name("fk_signboardTag_board")
                            .from(SignboardTag::Table, SignboardTag::BoardID)
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
                    .table(SignboardCardTag::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(SignboardCardTag::CardID).string().not_null())
                    .col(ColumnDef::new(SignboardCardTag::TagID).string().not_null())
                    .primary_key(
                        Index::create()
                            .col(SignboardCardTag::CardID)
                            .col(SignboardCardTag::TagID),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_signboardCardTag_card")
                            .from(SignboardCardTag::Table, SignboardCardTag::CardID)
                            .to(SignboardCard::Table, SignboardCard::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_signboardCardTag_tag")
                            .from(SignboardCardTag::Table, SignboardCardTag::TagID)
                            .to(SignboardTag::Table, SignboardTag::Id)
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
            "CREATE INDEX IF NOT EXISTS idx_signboardColumn_boardID_index ON signboardColumn (boardID, \"index\")",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_signboardCard_columnID_index ON signboardCard (columnID, \"index\")",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_signboardCard_reminderID ON signboardCard (reminderID)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_signboardCard_dueAt ON signboardCard (dueAt)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_signboardTag_boardID ON signboardTag (boardID)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_signboardTag_boardID_title ON signboardTag (boardID, title)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_signboardCardTag_tagID ON signboardCardTag (tagID)",
        )
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        for index in [
            "idx_signboardCardTag_tagID",
            "idx_signboardTag_boardID_title",
            "idx_signboardTag_boardID",
            "idx_signboardCard_dueAt",
            "idx_signboardCard_reminderID",
            "idx_signboardCard_columnID_index",
            "idx_signboardColumn_boardID_index",
            "idx_signboard_index",
        ] {
            db.execute_unprepared(&format!("DROP INDEX IF EXISTS {index}"))
                .await?;
        }

        manager
            .drop_table(Table::drop().table(SignboardCardTag::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(SignboardTag::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(SignboardCard::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(SignboardColumn::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Signboard::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(Iden)]
enum Signboard {
    Table,
    Id,
    Title,
    Index,
    #[iden = "archivedAt"]
    ArchivedAt,
    #[iden = "syncedAt"]
    SyncedAt,
    #[iden = "createdAt"]
    CreatedAt,
    #[iden = "updatedAt"]
    UpdatedAt,
}

#[derive(Iden)]
enum SignboardColumn {
    #[iden = "signboardColumn"]
    Table,
    Id,
    #[iden = "boardID"]
    BoardID,
    Title,
    Index,
    Color,
    #[iden = "wipLimit"]
    WipLimit,
    #[iden = "archivedAt"]
    ArchivedAt,
    #[iden = "createdAt"]
    CreatedAt,
    #[iden = "updatedAt"]
    UpdatedAt,
}

#[derive(Iden)]
enum SignboardCard {
    #[iden = "signboardCard"]
    Table,
    Id,
    #[iden = "columnID"]
    ColumnID,
    Title,
    Notes,
    Index,
    #[iden = "dueAt"]
    DueAt,
    #[iden = "reminderID"]
    ReminderID,
    Priority,
    Color,
    #[iden = "archivedAt"]
    ArchivedAt,
    #[iden = "createdAt"]
    CreatedAt,
    #[iden = "updatedAt"]
    UpdatedAt,
}

#[derive(Iden)]
enum SignboardTag {
    #[iden = "signboardTag"]
    Table,
    Id,
    #[iden = "boardID"]
    BoardID,
    Title,
    Color,
    #[iden = "createdAt"]
    CreatedAt,
    #[iden = "updatedAt"]
    UpdatedAt,
}

#[derive(Iden)]
enum SignboardCardTag {
    #[iden = "signboardCardTag"]
    Table,
    #[iden = "cardID"]
    CardID,
    #[iden = "tagID"]
    TagID,
}

#[derive(Iden)]
enum Reminder {
    Table,
    Id,
}
