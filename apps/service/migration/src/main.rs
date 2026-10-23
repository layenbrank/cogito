use anyhow::Context;
use configures::configure::Configure;

#[tokio::main]
async fn main() {
    if std::env::var("DATABASE_URL").is_err() {
        let cfg = Configure::load()
            .context("failed to load yaml config for migration")
            .unwrap();
        // SAFETY: migration 进程启动早期单线程设置 DATABASE_URL
        unsafe {
            std::env::set_var("DATABASE_URL", cfg.database_uri());
        }
    }
    sea_orm_migration::cli::run_cli(migration::Migrator).await;
}
