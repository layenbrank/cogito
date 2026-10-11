//! sea-orm-cli 入口：`sea-orm-cli migrate fresh -d … -u sqlite:…`
use sea_orm_migration::cli;
use thinking_database::migration::AppMigrator;

#[tokio::main]
async fn main() {
    cli::run_cli(AppMigrator).await;
}
