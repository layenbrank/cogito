pub use sea_orm_migration::prelude::*;

#[path = "000001_20260819.rs"]
mod m000001_20260819;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migration_table_name() -> sea_orm::DynIden {
        "migration".into_iden()
    }

    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![Box::new(m000001_20260819::Migration)]
    }
}
