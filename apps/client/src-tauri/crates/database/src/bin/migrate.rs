//! 迁移 bin：`pnpm --filter @cogito/client migrate:*`（`scripts/migrate.ts`）会直接跑它。
//! 手动等价写法：`cargo run -p cogito-database --bin cogito-database -- -u sqlite:<db>?mode=rwc <子命令>`
use cogito_database::migration::AppMigrator;
use sea_orm_migration::cli;

#[tokio::main]
async fn main() {
    cli::run_cli(AppMigrator).await;
}
