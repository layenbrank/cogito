//! 迁移文件只有 v001：未发版阶段所有 DDL 都并在这一个文件里，
//! 改完需要 `pnpm --filter @cogito/client migrate:fresh` 重建本地库。
pub mod migrations_v001;
