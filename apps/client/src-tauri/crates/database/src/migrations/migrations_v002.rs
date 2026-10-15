//! album 表：捕获库相簿定义（成员在 asset.metadata.albums）。
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Album::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(Album::Id).string().not_null().primary_key())
                    .col(ColumnDef::new(Album::Name).string().not_null())
                    .col(
                        ColumnDef::new(Album::Index)
                            .big_integer()
                            .not_null()
                            .default(0),
                    )
                    .col(ColumnDef::new(Album::CoverAssetID).string().null())
                    .col(
                        ColumnDef::new(Album::Status)
                            .string()
                            .not_null()
                            .default("001"),
                    )
                    .col(ColumnDef::new(Album::ArchivedAt).big_integer().null())
                    .col(ColumnDef::new(Album::CreatedAt).big_integer().not_null())
                    .col(ColumnDef::new(Album::UpdatedAt).big_integer().not_null())
                    .to_owned(),
            )
            .await?;

        let db = manager.get_connection();
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_album_archivedAt ON album (archivedAt)",
        )
        .await?;
        db.execute_unprepared("CREATE INDEX IF NOT EXISTS idx_album_index ON album (\"index\")")
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared("DROP INDEX IF EXISTS idx_album_index")
            .await?;
        db.execute_unprepared("DROP INDEX IF EXISTS idx_album_archivedAt")
            .await?;
        manager
            .drop_table(Table::drop().table(Album::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(Iden)]
enum Album {
    Table,
    Id,
    Name,
    Index,
    #[iden = "coverAssetID"]
    CoverAssetID,
    Status,
    #[iden = "archivedAt"]
    ArchivedAt,
    #[iden = "createdAt"]
    CreatedAt,
    #[iden = "updatedAt"]
    UpdatedAt,
}
