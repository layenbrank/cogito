use crate::migrations::{migrations_v001, migrations_v002};
use crate::storage::Connection;
use sea_orm::DbErr;
use sea_orm::sea_query::IntoIden;
use sea_orm_migration::MigratorTrait;
use tracing::{error, info};

pub struct AppMigrator;

impl MigratorTrait for AppMigrator {
    fn migration_table_name() -> sea_orm::DynIden {
        sea_orm::sea_query::Alias::new("migrations").into_iden()
    }

    fn migrations() -> Vec<Box<dyn sea_orm_migration::MigrationTrait>> {
        vec![
            Box::new(migrations_v001::Migration),
            Box::new(migrations_v002::Migration),
        ]
    }
}

pub async fn run(db: &Connection) -> Result<(), DbErr> {
    info!("开始执行数据库迁移...");
    match AppMigrator::up(&**db, None).await {
        Ok(_) => info!("数据库迁移完成"),
        Err(e) => {
            error!("数据库迁移失败: {}", e);
            return Err(e);
        }
    }
    Ok(())
}

pub async fn rollback(db: &Connection, steps: u32) -> Result<(), DbErr> {
    AppMigrator::down(&**db, Some(steps)).await
}

pub async fn check(db: &Connection) -> Result<(), DbErr> {
    let status = AppMigrator::get_migration_with_status(&**db).await?;
    info!("迁移状态条目数量: {}", status.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::Database;

    #[tokio::test]
    async fn migration_runs_on_empty_sqlite() {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("connect in-memory sqlite");
        let connection = std::sync::Arc::new(db);
        run(&connection).await.expect("migration should succeed");
        check(&connection)
            .await
            .expect("migration status should be readable");
    }
}
