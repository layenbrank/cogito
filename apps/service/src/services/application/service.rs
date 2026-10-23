use actix_web::Result;
use chrono::Utc;

use crate::{
    filters::exception::Exception,
    services::application::schema::{App, Component, Direction, Shape, Size},
};

pub struct ApplicationService;

#[derive(Debug, thiserror::Error)]
pub enum ApplicationError {
    #[error("HTTP error {status}: {message}")]
    HttpStatusError { status: u16, message: String },
    #[error("Invalid response format: {0}")]
    InvalidResponseFormat(String),
}

impl From<ApplicationError> for Exception {
    fn from(err: ApplicationError) -> Self {
        use crate::utils::code::system;
        match &err {
            ApplicationError::HttpStatusError { status, message } => {
                tracing::error!(%status, error = %message, "application status error");
            }
            ApplicationError::InvalidResponseFormat(msg) => {
                tracing::error!(error = %msg, "application invalid response");
            }
        }
        Exception::custom(system::INTERNAL_ERROR, "应用服务异常")
    }
}

impl ApplicationService {
    fn mock_app(url: &str) -> App {
        let now = Utc::now().timestamp_millis();
        App {
            id: String::from("1234567890"),
            index: 1,
            name: String::from("测试应用"),
            url: Some(String::from(url)),
            size: Size::Mini,
            width: Some(String::from("60px")),
            round: Some(String::from("12px")),
            shape: Shape::Square,
            height: Some(String::from("60px")),
            marker: None,
            mirror_id: String::from("0"),
            text_size: Some(String::from("12px")),
            updated_at: now,
            created_at: now,
            text_color: Some(String::from("#4080ff")),
            component: Component::Bookmark,
            direction: Direction::Horizontal,
            description: String::from("测试描述"),
            collection_id: None,
            download_count: 0,
            background_color: None,
            background_image: None,
        }
    }

    pub async fn toRead() -> Result<App, ApplicationError> {
        Ok(Self::mock_app("https://api.example.com"))
    }

    pub async fn toWrite() -> Result<App> {
        Ok(Self::mock_app("http://api.example.com"))
    }

    pub fn toUpdate() -> Result<App> {
        Ok(Self::mock_app("http://api.example.com"))
    }

    pub fn toRemove() -> Result<App> {
        Ok(Self::mock_app("http://api.example.com"))
    }
}
