//! 业务状态 value / key 常量：value 为全局池冻结分配号，分支优先认 key。

/// 全局池 key（与 docs/contracts/dict.yaml 对齐）
pub mod key {
    pub const DRAFT: &str = "DRAFT";
    pub const PUBLISHED: &str = "PUBLISHED";
    pub const MANUAL: &str = "MANUAL";
    pub const AGENT: &str = "AGENT";
    pub const IMPORT: &str = "IMPORT";
    pub const AUTHORED: &str = "AUTHORED";
    pub const CLOUD_IDLE: &str = "CLOUD_IDLE";
    pub const CLOUD_PENDING: &str = "CLOUD_PENDING";
    pub const CLOUD_RUNNING: &str = "CLOUD_RUNNING";
    pub const CLOUD_SUCCEEDED: &str = "CLOUD_SUCCEEDED";
    pub const CLOUD_FAILED: &str = "CLOUD_FAILED";
    pub const SCOPE_USER: &str = "SCOPE_USER";
    pub const SCOPE_TENANT: &str = "SCOPE_TENANT";
    pub const RUN_PENDING: &str = "RUN_PENDING";
    pub const RUN_RUNNING: &str = "RUN_RUNNING";
    pub const RUN_SUCCEEDED: &str = "RUN_SUCCEEDED";
    pub const RUN_FAILED: &str = "RUN_FAILED";
    pub const TRIGGER_SCHEDULE: &str = "TRIGGER_SCHEDULE";
    pub const TRIGGER_MANUAL: &str = "TRIGGER_MANUAL";
    pub const TRIGGER_CATCHUP: &str = "TRIGGER_CATCHUP";
    pub const OWNER_CLIENT: &str = "OWNER_CLIENT";
    pub const OWNER_GOOSE: &str = "OWNER_GOOSE";
    pub const OWNER_CLOUD: &str = "OWNER_CLOUD";
    pub const RUN_AS_USER: &str = "RUN_AS_USER";
    pub const RUN_AS_TENANT: &str = "RUN_AS_TENANT";
    pub const DRAFT_PENDING: &str = "DRAFT_PENDING";
    pub const DRAFT_SAVED: &str = "DRAFT_SAVED";
    pub const DRAFT_DISCARDED: &str = "DRAFT_DISCARDED";
    pub const ACTIVE: &str = "ACTIVE";
}

pub mod knowledge_doc_status {
    pub const TYPE: &str = "knowledge_doc_status";
    pub const DRAFT: &str = "001";
    pub const PUBLISHED: &str = "002";
}

pub mod knowledge_doc_source {
    pub const TYPE: &str = "knowledge_doc_source";
    pub const MANUAL: &str = "003";
    pub const AGENT: &str = "004";
    pub const IMPORT: &str = "005";
    pub const AUTHORED: &str = "006";
}

pub mod knowledge_cloud_status {
    pub const TYPE: &str = "knowledge_cloud_status";
    pub const IDLE: &str = "007";
    pub const PENDING: &str = "008";
    pub const RUNNING: &str = "009";
    pub const SUCCEEDED: &str = "010";
    pub const FAILED: &str = "011";
}

pub mod knowledge_base_scope {
    pub const TYPE: &str = "knowledge_base_scope";
    pub const USER: &str = "012";
    pub const TENANT: &str = "013";
}

pub mod automation_run_status {
    pub const TYPE: &str = "automation_run_status";
    pub const PENDING: &str = "014";
    pub const RUNNING: &str = "015";
    pub const SUCCEEDED: &str = "016";
    pub const FAILED: &str = "017";
}

pub mod automation_trigger_kind {
    pub const TYPE: &str = "automation_trigger_kind";
    pub const SCHEDULE: &str = "018";
    pub const MANUAL: &str = "019";
    pub const CATCHUP: &str = "020";
}

pub mod automation_owner {
    pub const TYPE: &str = "automation_owner";
    pub const CLIENT: &str = "021";
    pub const GOOSE: &str = "022";
    pub const CLOUD: &str = "023";
}

pub mod automation_run_as {
    pub const TYPE: &str = "automation_run_as";
    pub const USER: &str = "024";
    pub const TENANT: &str = "025";
}

pub mod directive_draft_status {
    pub const TYPE: &str = "directive_draft_status";
    pub const PENDING: &str = "026";
    pub const SAVED: &str = "027";
    pub const DISCARDED: &str = "028";
}

pub mod asset_status {
    pub const TYPE: &str = "asset_status";
    pub const ACTIVE: &str = "029";
}

pub mod album_status {
    pub const TYPE: &str = "album_status";
    pub const ACTIVE: &str = "029";
}
