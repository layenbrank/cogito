pub mod app;
pub mod autostart;
pub mod automation;
pub mod bridge;
pub mod reminder;
pub mod search;
pub mod system;

pub mod through {
    pub mod command;
    pub mod cursor;
    pub mod state;
    pub mod worker;
    pub use command::set_rects;
    pub use state::ThroughState;
    pub use worker::spawn_worker;
}

pub mod overlay {
    pub mod command;
    pub mod state;
    pub use state::{OverlayHealth, OverlayPending};
}

pub mod capture {
    pub mod command;
    pub mod region;
    pub mod schema;
    pub mod state;
    pub mod uia;
    pub use state::{CaptureHandshake, CapturePending};
}

pub mod media;

pub mod ui {
    pub mod contextmenu;
    pub mod tray;
}

pub mod utils;
