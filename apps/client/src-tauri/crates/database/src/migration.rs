use crate::migrations::migrations_v001;
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
        // 未发版阶段只有一个迁移文件：所有 DDL 都并入 v001，改完必须 fresh。
        vec![Box::new(migrations_v001::Migration)]
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
    use sea_orm::{ConnectionTrait, Database, DatabaseBackend, Statement};

    async fn fresh() -> Connection {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("connect in-memory sqlite");
        let connection = std::sync::Arc::new(db);
        run(&connection).await.expect("migration should succeed");
        connection
    }

    async fn scalar_i64(db: &Connection, sql: &str) -> i64 {
        let row = db
            .query_one(Statement::from_string(DatabaseBackend::Sqlite, sql))
            .await
            .expect("query should succeed")
            .expect("row should exist");
        row.try_get::<i64>("", "v")
            .or_else(|_| row.try_get::<i64>("", "V"))
            .expect("column v should exist")
    }

    async fn scalar_string(db: &Connection, sql: &str) -> String {
        let row = db
            .query_one(Statement::from_string(DatabaseBackend::Sqlite, sql))
            .await
            .expect("query should succeed")
            .expect("row should exist");
        row.try_get::<String>("", "v")
            .or_else(|_| row.try_get::<String>("", "V"))
            .expect("column v should exist")
    }

    #[tokio::test]
    async fn migration_runs_on_empty_sqlite() {
        let connection = fresh().await;
        check(&connection)
            .await
            .expect("migration status should be readable");
    }

    #[tokio::test]
    async fn only_single_v001_migration() {
        assert_eq!(AppMigrator::migrations().len(), 1);
    }

    #[tokio::test]
    async fn knowledge_tile_is_seeded() {
        let db = fresh().await;
        let component = scalar_string(
            &db,
            "SELECT component AS v FROM magneticTile WHERE id = '63e46df5-44a7-494f-a9ca-b4303186a511'",
        )
        .await;
        assert_eq!(component, "knowledge");
        let title = scalar_string(
            &db,
            "SELECT title AS v FROM magneticTile WHERE id = '63e46df5-44a7-494f-a9ca-b4303186a511'",
        )
        .await;
        assert_eq!(title, "知识库");
    }

    #[tokio::test]
    async fn merged_v002_v005_objects_exist() {
        let db = fresh().await;
        for table in ["album", "bookmark", "signboard_entry_asset"] {
            let count = scalar_i64(
                &db,
                &format!(
                    "SELECT count(*) AS v FROM sqlite_master WHERE type='table' AND name='{table}'"
                ),
            )
            .await;
            assert_eq!(count, 1, "{table} 应该存在");
        }
        let progress = scalar_i64(
            &db,
            "SELECT count(*) AS v FROM pragma_table_info('signboard_entry') WHERE name = 'progress'",
        )
        .await;
        assert_eq!(progress, 1);
        let role = scalar_i64(
            &db,
            "SELECT count(*) AS v FROM pragma_table_info('signboard_column') WHERE name = 'role'",
        )
        .await;
        assert_eq!(role, 1);
    }

    #[tokio::test]
    async fn knowledge_tables_and_fts_work() {
        let db = fresh().await;
        for table in [
            "knowledge_base",
            "knowledge_doc",
            "knowledge_index_state",
            "automation",
            "automation_run",
            "directive_draft",
        ] {
            let count = scalar_i64(
                &db,
                &format!(
                    "SELECT count(*) AS v FROM sqlite_master WHERE type='table' AND name='{table}'"
                ),
            )
            .await;
            assert_eq!(count, 1, "{table} 应该存在");
        }

        for statement in [
            "INSERT INTO knowledge_base (id,name,slug,\"rootPath\",\"createdAt\",\"updatedAt\") VALUES ('b1','默认','default','/tmp/kb',1,1)",
            "INSERT INTO knowledge_doc (id,\"baseId\",title,\"relPath\",hash,content,\"createdAt\",\"updatedAt\") VALUES ('d1','b1','知识库设计','a.md','h1','这是知识库正文内容',1,1)",
        ] {
            db.execute(Statement::from_string(
                DatabaseBackend::Sqlite,
                statement.to_string(),
            ))
            .await
            .expect("insert should succeed");
        }

        let hits = scalar_i64(
            &db,
            "SELECT count(*) AS v FROM knowledge_doc_fts WHERE knowledge_doc_fts MATCH '知识库'",
        )
        .await;
        assert_eq!(hits, 1);

        db.execute(Statement::from_string(
            DatabaseBackend::Sqlite,
            "DELETE FROM knowledge_doc WHERE id = 'd1'".to_string(),
        ))
        .await
        .expect("delete should succeed");
        let after = scalar_i64(
            &db,
            "SELECT count(*) AS v FROM knowledge_doc_fts WHERE knowledge_doc_fts MATCH '知识库'",
        )
        .await;
        assert_eq!(after, 0);
    }
}
