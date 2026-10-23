use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub enum Size {
    Mini,
    Small,
    Medium,
    Large,
    Huge,
    Massive,
    Ultra,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub enum Shape {
    Square,
    Circle,
    Rectangle,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub enum Component {
    Bookmark,
    Calendar,
    Markdown,
    Settings,
    Clipchamp,
    Intelligence,
    Navigation,
    Marketplace,
    Developer,
    Collection,
    Signboard,
    Clock,
    Gallery,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub enum Direction {
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct App {
    #[schema(example = "app-1")]
    pub id: String,
    #[schema(example = 0)]
    pub index: u32,
    #[schema(example = "Cogito")]
    pub name: String,
    #[schema(example = "https://example.com")]
    pub url: Option<String>,
    pub size: Size,
    pub width: Option<String>,
    pub round: Option<String>,
    pub shape: Shape,
    pub height: Option<String>,
    pub marker: Option<String>,
    #[schema(example = "mirror-1")]
    #[serde(rename = "mirrorID")]
    pub mirror_id: String,
    pub text_size: Option<String>,
    #[schema(example = 1700000000000_i64)]
    pub updated_at: i64,
    #[schema(example = 1700000000000_i64)]
    pub created_at: i64,
    pub text_color: Option<String>,
    pub component: Component,
    pub direction: Direction,
    #[schema(example = "应用入口配置")]
    pub description: String,
    #[serde(rename = "collectionID")]
    pub collection_id: Option<String>,
    #[schema(example = 0)]
    pub download_count: u32,
    pub background_color: Option<String>,
    pub background_image: Option<String>,
}
