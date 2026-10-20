//! bookmark 表：树形书签库（文件夹 url 为空，链接有 url）。
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Bookmark::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(Bookmark::Id).string().not_null().primary_key())
                    .col(
                        ColumnDef::new(Bookmark::MirrorID)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(Bookmark::ParentID).string().null())
                    .col(ColumnDef::new(Bookmark::Title).string().not_null())
                    .col(ColumnDef::new(Bookmark::Url).string().null())
                    .col(
                        ColumnDef::new(Bookmark::Index)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(Bookmark::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(Bookmark::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        let db = manager.get_connection();
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_bookmark_mirror ON bookmark (mirrorID)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_bookmark_parent ON bookmark (parentID)",
        )
        .await?;
        db.execute_unprepared(
            "CREATE INDEX IF NOT EXISTS idx_bookmark_mirror_url ON bookmark (mirrorID, url)",
        )
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared("DROP INDEX IF EXISTS idx_bookmark_mirror_url")
            .await?;
        db.execute_unprepared("DROP INDEX IF EXISTS idx_bookmark_parent")
            .await?;
        db.execute_unprepared("DROP INDEX IF EXISTS idx_bookmark_mirror")
            .await?;
        manager
            .drop_table(Table::drop().table(Bookmark::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(Iden)]
enum Bookmark {
    Table,
    Id,
    #[iden = "mirrorID"]
    MirrorID,
    #[iden = "parentID"]
    ParentID,
    Title,
    Url,
    Index,
    #[iden = "createdAt"]
    CreatedAt,
    #[iden = "updatedAt"]
    UpdatedAt,
}
