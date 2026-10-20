pub mod migration;
pub mod migrations;
pub mod storage;

pub mod entity {
    pub mod album;
    pub mod asset;
    pub mod bookmark;
    pub mod calendar;
    pub mod countdown;
    pub mod magnetic_tile;
    pub mod mirror;
    pub mod overlay;
    pub mod reminder;
    pub mod signboard;
    pub mod signboard_card;
    pub mod signboard_card_tag;
    pub mod signboard_column;
    pub mod signboard_tag;

    #[allow(non_snake_case)]
    pub mod agent_message;
    #[allow(non_snake_case)]
    pub mod agent_provider;
    #[allow(non_snake_case)]
    pub mod agent_session;
    #[allow(non_snake_case)]
    pub mod agent_usage;
    #[allow(non_snake_case)]
    pub mod agent_workspace;
    #[allow(non_snake_case)]
    pub mod agent_workspace_folder;

    pub use agent_message::Entity as AgentMessageEntity;
    pub use agent_provider::Entity as AgentProviderEntity;
    pub use agent_session::Entity as AgentSessionEntity;
    pub use agent_usage::Entity as AgentUsageEntity;
    pub use agent_workspace::Entity as AgentWorkspaceEntity;
    pub use agent_workspace_folder::Entity as AgentWorkspaceFolderEntity;
    pub use album::Entity as AlbumEntity;
    pub use asset::Entity as AssetEntity;
    pub use bookmark::Entity as BookmarkEntity;
    pub use calendar::Entity as CalendarEntity;
    pub use countdown::Entity as CountdownEntity;
    pub use magnetic_tile::Entity as MagneticTileEntity;
    pub use mirror::Entity as MirrorEntity;
    pub use overlay::Entity as OverlayEntity;
    pub use reminder::Entity as ReminderEntity;
    pub use signboard::Entity as SignboardEntity;
    pub use signboard_card::Entity as SignboardCardEntity;
    pub use signboard_card_tag::Entity as SignboardCardTagEntity;
    pub use signboard_column::Entity as SignboardColumnEntity;
    pub use signboard_tag::Entity as SignboardTagEntity;
}

pub use storage::{Connection, Storage, database_path, initialize};
