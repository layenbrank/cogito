//! 数据库迁移：仅 `0001` 基线（开发期合并，改完需 `migrate:fresh`）。
pub mod agent_plan_schema;
pub mod agent_session_schema;
pub mod automation_schema;
pub mod builtin_seed;
pub mod composer_queue_schema;
pub mod dict_seed;
pub mod migrations_0001;
pub mod navigation_seed;
pub mod run_cost_schema;
pub mod tool_audit_schema;
