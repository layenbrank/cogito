//! 迁移 bin：`pnpm --filter @i-thinking/client migrate:*`（`scripts/migrate.ts`）会直接跑它。
//! 手动等价写法：`cargo run -p thinking-database --bin thinking-database -- -u sqlite:<db>?mode=rwc <子命令>`
use sea_orm_migration::cli;
use thinking_database::migration::AppMigrator;

#[tokio::main]
async fn main() {
    cli::run_cli(AppMigrator).await;
}
