//! signboard_entry_asset：卡片 ↔ 本地 asset 附件（封面取 index 最小）。
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(SignboardEntryAsset::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SignboardEntryAsset::EntryId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SignboardEntryAsset::AssetId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SignboardEntryAsset::Index)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(SignboardEntryAsset::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .col(SignboardEntryAsset::EntryId)
                            .col(SignboardEntryAsset::AssetId),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_signboard_entry_asset_entry")
                            .from(
                                SignboardEntryAsset::Table,
                                SignboardEntryAsset::EntryId,
                            )
                            .to(SignboardEntry::Table, SignboardEntry::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_signboard_entry_asset_asset")
                            .from(
                                SignboardEntryAsset::Table,
                                SignboardEntryAsset::AssetId,
                            )
                            .to(Asset::Table, Asset::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        let db = manager.get_connection();
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_signboard_entry_asset_entry_id_index ON signboard_entry_asset (entry_id, \"index\")",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_signboard_entry_asset_asset_id ON signboard_entry_asset (asset_id)",
        )
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared("DROP INDEX IF EXISTS idx_signboard_entry_asset_asset_id")
            .await?;
        db.execute_unprepared(
            "DROP INDEX IF EXISTS idx_signboard_entry_asset_entry_id_index",
        )
        .await?;
        manager
            .drop_table(Table::drop().table(SignboardEntryAsset::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(Iden)]
enum SignboardEntryAsset {
    #[iden = "signboard_entry_asset"]
    Table,
    EntryId,
    AssetId,
    Index,
    CreatedAt,
}

#[derive(Iden)]
enum SignboardEntry {
    #[iden = "signboard_entry"]
    Table,
    Id,
}

#[derive(Iden)]
enum Asset {
    Table,
    Id,
}
