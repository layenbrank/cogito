use actix_web::Result;

use crate::{databases::database::Storage, services::markdown::schema::Schema};

pub struct MarkdownService;

impl MarkdownService {
    pub fn read(_storage: &Storage) -> Result<Schema> {
        // storage.markdown()
        Ok(Schema {
            id: String::from(""),
            fragment: String::from(""),
        })
    }
    pub fn insert() -> Result<Schema> {
        Ok(Schema {
            id: String::from(""),
            fragment: String::from(""),
        })
    }
    pub fn update() -> Result<Schema> {
        Ok(Schema {
            id: String::from(""),
            fragment: String::from(""),
        })
    }
    pub fn remove() -> Result<Schema> {
        Ok(Schema {
            id: String::from(""),
            fragment: String::from(""),
        })
    }
}
