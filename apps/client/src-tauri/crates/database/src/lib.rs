pub mod migration;
pub mod migrations;
pub mod storage;

pub mod entity {
    pub mod album;
    pub mod asset;
    pub mod bookmark;
    pub mod calendar;
    pub mod countdown;
    pub mod directive_draft;
    pub mod knowledge_base;
    pub mod knowledge_doc;
    pub mod knowledge_index_state;
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
    pub use directive_draft::Entity as DirectiveDraftEntity;
    pub use knowledge_base::Entity as KnowledgeBaseEntity;
    pub use knowledge_doc::Entity as KnowledgeDocEntity;
    pub use knowledge_index_state::Entity as KnowledgeIndexStateEntity;
    pub use magnetic_tile::Entity as MagneticTileEntity;
    pub use mirror::Entity as MirrorEntity;
    pub use overlay::Entity as OverlayEntity;
    pub use reminder::Entity as ReminderEntity;
    pub use signboard::Entity as SignboardEntity;
    pub use signboard_automation::Entity as SignboardAutomationEntity;
    pub use signboard_check::Entity as SignboardCheckEntity;
    pub use signboard_column::Entity as SignboardColumnEntity;
    pub use signboard_entry::Entity as SignboardEntryEntity;
    pub use signboard_entry_asset::Entity as SignboardEntryAssetEntity;
    pub use signboard_tag::Entity as SignboardTagEntity;
    pub use signboard_tagged::Entity as SignboardTaggedEntity;
}

pub use storage::{Connection, Storage, database_path, initialize};
