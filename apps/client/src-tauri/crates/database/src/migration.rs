use crate::migrations::{dict_seed, migrations_0001};
use crate::storage::Connection;
use sea_orm::{ConnectionTrait, DatabaseBackend, DbErr, Statement};
use sea_orm::sea_query::IntoIden;
use sea_orm_migration::MigratorTrait;
use tracing::{error, info};

pub struct AppMigrator;

impl MigratorTrait for AppMigrator {
    fn migration_table_name() -> sea_orm::DynIden {
        sea_orm::sea_query::Alias::new("migrations").into_iden()
    }

    fn migrations() -> Vec<Box<dyn sea_orm_migration::MigrationTrait>> {
        vec![Box::new(migrations_0001::Migration)]
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
    // 单文件 0001 已打标记后追加的表不会再跑；dict seed 全是 IF NOT EXISTS / OR IGNORE，启动兜底补齐。
    ensure_dict(db).await?;
    Ok(())
}

/// 补建状态字典表并写入缺省条目（已存在则跳过）。
async fn ensure_dict(db: &Connection) -> Result<(), DbErr> {
    for statement in dict_seed::statements() {
        db.execute(Statement::from_string(DatabaseBackend::Sqlite, statement))
            .await?;
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
    use crate::entity::{
        AgentMessageEntity, AgentProviderEntity, AgentSessionEntity, AgentUsageEntity,
        AgentWorkspaceEntity, AgentWorkspaceFolderEntity, AlbumEntity, AssetEntity, AutomationEntity,
        AutomationRunEntity, BookmarkEntity,
        CalendarEntity, CountdownEntity, DictItemEntity, DictTenantItemEntity, DictTypeEntity,
        DictTypeItemEntity, DirectiveDraftEntity,
        KnowledgeBaseEntity, KnowledgeDocEntity, KnowledgeIndexStateEntity, MagneticTileEntity,
        MirrorEntity,
        OverlayEntity, ReminderEntity, SignboardAutomationEntity, SignboardCheckEntity,
        SignboardColumnEntity, SignboardEntity, SignboardEntryAssetEntity, SignboardEntryEntity,
        SignboardTagEntity, SignboardTaggedEntity,
    };
    use sea_orm::{
        ConnectionTrait, Database, DatabaseBackend, EntityTrait, IdenStatic, Iterable, Statement,
        entity::prelude::*,
    };

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
    async fn migrations_include_only_0001() {
        assert_eq!(AppMigrator::migrations().len(), 1);
        assert_eq!(
            AppMigrator::migrations()[0].name(),
            "0001"
        );
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
        let background = scalar_string(
            &db,
            "SELECT background AS v FROM magneticTile WHERE id = '63e46df5-44a7-494f-a9ca-b4303186a511'",
        )
        .await;
        assert_eq!(background, r##"{"color":"#047857"}"##);

        let agent_title = scalar_string(
            &db,
            "SELECT title AS v FROM magneticTile WHERE id = 'f3ed970a-b07c-44bc-b54d-4bdfb454f207'",
        )
        .await;
        assert_eq!(agent_title, "Agent");
        let calendar_bg = scalar_string(
            &db,
            "SELECT background AS v FROM magneticTile WHERE id = 'a9908a07-e685-49d9-a517-0caf7ce27e75'",
        )
        .await;
        assert_eq!(calendar_bg, r##"{"color":"#FFFFFF"}"##);
        let countdown_bg = scalar_string(
            &db,
            "SELECT background AS v FROM magneticTile WHERE id = '0dac7ddf-c4ee-46cd-88cf-802d0f32ee08'",
        )
        .await;
        assert_eq!(countdown_bg, r##"{"color":"#FFFFFF"}"##);
        let capture_bg = scalar_string(
            &db,
            "SELECT background AS v FROM magneticTile WHERE id = 'f4e10078-03d0-45b8-86f9-4f7cab94abf9'",
        )
        .await;
        assert_eq!(capture_bg, r##"{"color":"#44403C"}"##);
        let developer_count = scalar_i64(
            &db,
            "SELECT COUNT(*) AS v FROM magneticTile WHERE component = 'developer'",
        )
        .await;
        assert_eq!(developer_count, 0);
    }

    #[tokio::test]
    async fn navigation_seed_has_brand_mark() {
        let db = fresh().await;
        let background = scalar_string(
            &db,
            "SELECT background AS v FROM magneticTile WHERE id = '6f7714eb-bfa1-4b15-b56f-d095ff9100a3'",
        )
        .await;
        assert_eq!(background, r##"{"color":"#2932E1"}"##);
        let mark = scalar_string(
            &db,
            "SELECT mark AS v FROM magneticTile WHERE id = '6f7714eb-bfa1-4b15-b56f-d095ff9100a3'",
        )
        .await;
        assert_eq!(mark, "https://cdn.simpleicons.org/baidu/ffffff");
        let text = scalar_string(
            &db,
            "SELECT textColor AS v FROM magneticTile WHERE id = '6f7714eb-bfa1-4b15-b56f-d095ff9100a3'",
        )
        .await;
        assert_eq!(text, "FFFFFF");

        let sogou_bg = scalar_string(
            &db,
            "SELECT background AS v FROM magneticTile WHERE id = '03e9bb30-3691-4a07-8c74-80efd5c853b8'",
        )
        .await;
        assert_eq!(sogou_bg, r##"{"color":"#FF6200"}"##);

        // 知乎：品牌蓝底 + 白标，避免蓝标糊蓝底
        let zhihu_bg = scalar_string(
            &db,
            "SELECT background AS v FROM magneticTile WHERE id = '24c0121d-bd8a-487c-89c5-361a9b09bf00'",
        )
        .await;
        assert_eq!(zhihu_bg, r##"{"color":"#0084FF"}"##);
        let zhihu_mark = scalar_string(
            &db,
            "SELECT mark AS v FROM magneticTile WHERE id = '24c0121d-bd8a-487c-89c5-361a9b09bf00'",
        )
        .await;
        assert_eq!(
            zhihu_mark,
            "https://cdn.simpleicons.org/zhihu/ffffff"
        );

        // 淘宝：品牌橙底 + 白矢量标
        let taobao_bg = scalar_string(
            &db,
            "SELECT background AS v FROM magneticTile WHERE id = '17431d5f-1c90-45e5-bf5e-e9ffa4adea1d'",
        )
        .await;
        assert_eq!(taobao_bg, r##"{"color":"#FF5000"}"##);
        let taobao_mark = scalar_string(
            &db,
            "SELECT mark AS v FROM magneticTile WHERE id = '17431d5f-1c90-45e5-bf5e-e9ffa4adea1d'",
        )
        .await;
        assert_eq!(
            taobao_mark,
            "https://cdn.simpleicons.org/taobao/ffffff"
        );

        // 天猫：白底 + Google s2（Clearbit 已下线），归入购物集合
        let tmall_bg = scalar_string(
            &db,
            "SELECT background AS v FROM magneticTile WHERE id = '23b6ab4b-a8fd-4ce1-86b7-27026b72b255'",
        )
        .await;
        assert_eq!(tmall_bg, r##"{"color":"#FFFFFF"}"##);
        let tmall_mark = scalar_string(
            &db,
            "SELECT mark AS v FROM magneticTile WHERE id = '23b6ab4b-a8fd-4ce1-86b7-27026b72b255'",
        )
        .await;
        assert_eq!(
            tmall_mark,
            "https://www.google.com/s2/favicons?domain=tmall.com&sz=256"
        );
        let tmall_collection = scalar_string(
            &db,
            "SELECT collectionID AS v FROM magneticTile WHERE id = '23b6ab4b-a8fd-4ce1-86b7-27026b72b255'",
        )
        .await;
        assert_eq!(tmall_collection, "e2ae5afe-d42e-4539-b942-3ab2a0771c82");

        // 思否 / 什么值得买：Google s2；分类集合白底
        let segmentfault_mark = scalar_string(
            &db,
            "SELECT mark AS v FROM magneticTile WHERE id = '66e368ae-5e33-49fb-a36a-431b543c2e42'",
        )
        .await;
        assert_eq!(
            segmentfault_mark,
            "https://www.google.com/s2/favicons?domain=segmentfault.com&sz=256"
        );
        let smzdm_mark = scalar_string(
            &db,
            "SELECT mark AS v FROM magneticTile WHERE id = '3aa9d82c-8d67-4f13-a902-d75ef3633794'",
        )
        .await;
        assert_eq!(
            smzdm_mark,
            "https://www.google.com/s2/favicons?domain=smzdm.com&sz=256"
        );
        let shopping_bg = scalar_string(
            &db,
            "SELECT background AS v FROM magneticTile WHERE id = 'e2ae5afe-d42e-4539-b942-3ab2a0771c82'",
        )
        .await;
        assert_eq!(shopping_bg, r##"{"color":"#FFFFFF"}"##);
        let search_title = scalar_string(
            &db,
            "SELECT title AS v FROM magneticTile WHERE id = '9ba4c4a7-ccd7-4965-b447-5d74a9f96b56'",
        )
        .await;
        assert_eq!(search_title, "搜索");
    }

    #[tokio::test]
    async fn signboard_and_album_tables_exist() {
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

        // 团队（tenant）场景与自动化身份/失败态所需的列：缺了会在 Phase 5/7 再改一次迁移
        for (table, column) in [
            ("knowledge_base", "scope"),
            ("knowledge_base", "tenantId"),
            ("knowledge_doc", "revision"),
            ("knowledge_doc", "error"),
            ("automation", "runAsKind"),
            ("automation", "runAsUserId"),
            ("automation", "tenantId"),
            ("automation", "remoteId"),
            ("automation", "lastStatus"),
            ("automation", "lastError"),
            ("automation_run", "triggerKind"),
            ("automation_run", "runAsKind"),
            ("automation_run", "runAsUserId"),
        ] {
            let found = scalar_i64(
                &db,
                &format!(
                    "SELECT count(*) AS v FROM pragma_table_info('{table}') WHERE name = '{column}'"
                ),
            )
            .await;
            assert_eq!(found, 1, "{table}.{column} 应该存在");
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

    /// DDL 里某张表的列名（`pragma_table_info`，按定义顺序）。
    async fn ddl_columns(db: &Connection, table: &str) -> Vec<String> {
        let rows = db
            .query_all(Statement::from_string(
                DatabaseBackend::Sqlite,
                format!("SELECT name AS v FROM pragma_table_info('{table}')"),
            ))
            .await
            .expect("pragma_table_info should succeed");
        rows.iter()
            .map(|row| row.try_get::<String>("", "v").expect("column name"))
            .collect()
    }

    /// entity 声明的列名（`Column` 枚举 + `#[sea_orm(column_name = ...)]`）。
    fn entity_columns<E>() -> Vec<String>
    where
        E: EntityTrait,
        E::Column: Iterable + ColumnTrait + IdenStatic,
    {
        E::Column::iter()
            .map(|column| column.as_str().to_string())
            .collect()
    }

    /// 运行期唯一真相是 entity：DDL 只允许与之对齐，多一列/少一列都算漂移。
    ///
    /// 新增表时把 entity 与表名追加到下面的清单即可（未建 entity 的表不在此列）。
    #[tokio::test]
    async fn entity_columns_match_ddl() {
        let db = fresh().await;
        let entities: Vec<(&str, Vec<String>)> = vec![
            ("album", entity_columns::<AlbumEntity>()),
            ("asset", entity_columns::<AssetEntity>()),
            ("automation", entity_columns::<AutomationEntity>()),
            ("automation_run", entity_columns::<AutomationRunEntity>()),
            ("bookmark", entity_columns::<BookmarkEntity>()),
            ("calendar", entity_columns::<CalendarEntity>()),
            ("countdown", entity_columns::<CountdownEntity>()),
            ("dict_item", entity_columns::<DictItemEntity>()),
            ("dict_type", entity_columns::<DictTypeEntity>()),
            ("dict_type_item", entity_columns::<DictTypeItemEntity>()),
            ("dict_tenant_item", entity_columns::<DictTenantItemEntity>()),
            ("directive_draft", entity_columns::<DirectiveDraftEntity>()),
            ("knowledge_base", entity_columns::<KnowledgeBaseEntity>()),
            ("knowledge_doc", entity_columns::<KnowledgeDocEntity>()),
            (
                "knowledge_index_state",
                entity_columns::<KnowledgeIndexStateEntity>(),
            ),
            ("magneticTile", entity_columns::<MagneticTileEntity>()),
            ("mirror", entity_columns::<MirrorEntity>()),
            ("overlay", entity_columns::<OverlayEntity>()),
            ("reminder", entity_columns::<ReminderEntity>()),
            ("signboard", entity_columns::<SignboardEntity>()),
            (
                "signboard_automation",
                entity_columns::<SignboardAutomationEntity>(),
            ),
            ("signboard_check", entity_columns::<SignboardCheckEntity>()),
            (
                "signboard_column",
                entity_columns::<SignboardColumnEntity>(),
            ),
            ("signboard_entry", entity_columns::<SignboardEntryEntity>()),
            (
                "signboard_entry_asset",
                entity_columns::<SignboardEntryAssetEntity>(),
            ),
            ("signboard_tag", entity_columns::<SignboardTagEntity>()),
            (
                "signboard_tagged",
                entity_columns::<SignboardTaggedEntity>(),
            ),
            ("agent_message", entity_columns::<AgentMessageEntity>()),
            ("agent_provider", entity_columns::<AgentProviderEntity>()),
            ("agent_session", entity_columns::<AgentSessionEntity>()),
            ("agent_usage", entity_columns::<AgentUsageEntity>()),
            ("agent_workspace", entity_columns::<AgentWorkspaceEntity>()),
            (
                "agent_workspace_folder",
                entity_columns::<AgentWorkspaceFolderEntity>(),
            ),
        ];

        let mut problems = Vec::new();
        for (table, expected) in entities {
            let actual = ddl_columns(&db, table).await;
            for column in &expected {
                if !actual.contains(column) {
                    problems.push(format!("{table}.{column}：entity 有，DDL 缺"));
                }
            }
            for column in &actual {
                if !expected.contains(column) {
                    problems.push(format!("{table}.{column}：DDL 有，entity 缺"));
                }
            }
        }
        assert!(
            problems.is_empty(),
            "entity 与 DDL 列不一致：\n{}",
            problems.join("\n")
        );
    }
}
