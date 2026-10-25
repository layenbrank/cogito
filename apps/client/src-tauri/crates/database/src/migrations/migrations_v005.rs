//! signboard_entry.progress + signboard_column.role
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            "ALTER TABLE signboard_entry ADD COLUMN progress INTEGER NOT NULL DEFAULT 0",
        )
        .await?;
        db.execute_unprepared("ALTER TABLE signboard_column ADD COLUMN role TEXT NULL").await?;
        // 按常见默认三列标题补 role（无匹配则保持 null）
        db.execute_unprepared(
            "UPDATE signboard_column SET role = 'todo' WHERE role IS NULL AND (title LIKE '%待办%' OR lower(title) LIKE '%todo%')",
        )
        .await?;
        db.execute_unprepared(
            "UPDATE signboard_column SET role = 'doing' WHERE role IS NULL AND (title LIKE '%进行%' OR lower(title) LIKE '%doing%' OR lower(title) LIKE '%progress%')",
        )
        .await?;
        db.execute_unprepared(
            "UPDATE signboard_column SET role = 'done' WHERE role IS NULL AND (title LIKE '%完成%' OR lower(title) LIKE '%done%')",
        )
        .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite 旧版不稳妥 drop column；破坏性重构允许仅 up
        let _ = manager;
        Ok(())
    }
}
