pub mod album;
pub mod asset;
pub mod bookmark;
pub mod calendar;
pub mod countdown;
pub mod exception;
pub mod magnetic_tile;
pub mod mirror;
pub mod overlay;
pub mod reminder;
pub mod signboard;
pub mod signboard_automation;
pub mod signboard_check;
pub mod signboard_column;
pub mod signboard_entry;
pub mod signboard_entry_asset;
pub mod signboard_tag;
pub mod signboard_tagged;

#[allow(non_snake_case)]
pub mod agent_workspace {
    mod service;
    pub use service::Service;
}

#[allow(non_snake_case)]
pub mod agent_workspace_folder {
    mod service;
    pub use service::Service;
}

#[allow(non_snake_case)]
pub mod agent_session {
    mod service;
    pub use service::Service;
}

#[allow(non_snake_case)]
pub mod agent_message {
    mod service;
    pub use service::Service;
}

#[allow(non_snake_case)]
pub mod agent_provider {
    mod service;
    pub use service::Service;
}

#[allow(non_snake_case)]
pub mod agent_usage {
    mod service;
    pub use service::Service;
}

pub use exception::{CommandResult, Exception};
