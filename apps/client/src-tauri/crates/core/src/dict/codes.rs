//! 业务状态 value 常量：只认编码，不认 label。

pub mod knowledge_doc_status {
    pub const TYPE: &str = "knowledge_doc_status";
    pub const DRAFT: &str = "001";
    pub const PUBLISHED: &str = "002";
}

pub mod knowledge_doc_source {
    pub const TYPE: &str = "knowledge_doc_source";
    pub const MANUAL: &str = "001";
    pub const AGENT: &str = "002";
    pub const IMPORT: &str = "003";
    pub const AUTHORED: &str = "004";
}

pub mod knowledge_cloud_status {
    pub const TYPE: &str = "knowledge_cloud_status";
    pub const IDLE: &str = "001";
    pub const PENDING: &str = "002";
    pub const RUNNING: &str = "003";
    pub const SUCCEEDED: &str = "004";
    pub const FAILED: &str = "005";
}

pub mod knowledge_base_scope {
    pub const TYPE: &str = "knowledge_base_scope";
    pub const USER: &str = "001";
    pub const TENANT: &str = "002";
}

pub mod automation_run_status {
    pub const TYPE: &str = "automation_run_status";
    pub const PENDING: &str = "001";
    pub const RUNNING: &str = "002";
    pub const SUCCEEDED: &str = "003";
    pub const FAILED: &str = "004";
}

pub mod automation_trigger_kind {
    pub const TYPE: &str = "automation_trigger_kind";
    pub const SCHEDULE: &str = "001";
    pub const MANUAL: &str = "002";
    pub const CATCHUP: &str = "003";
}

pub mod automation_owner {
    pub const TYPE: &str = "automation_owner";
    pub const CLIENT: &str = "001";
    pub const GOOSE: &str = "002";
    pub const CLOUD: &str = "003";
}

pub mod automation_run_as {
    pub const TYPE: &str = "automation_run_as";
    pub const USER: &str = "001";
    pub const TENANT: &str = "002";
}

pub mod directive_draft_status {
    pub const TYPE: &str = "directive_draft_status";
    pub const PENDING: &str = "001";
    pub const SAVED: &str = "002";
    pub const DISCARDED: &str = "003";
}

pub mod asset_status {
    pub const TYPE: &str = "asset_status";
    pub const ACTIVE: &str = "001";
}

pub mod album_status {
    pub const TYPE: &str = "album_status";
    pub const ACTIVE: &str = "001";
}
