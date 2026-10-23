use chrono::Utc;
use entity::console_preference;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};
use serde_json::Value;
use uuid::Uuid;

use crate::filters::exception::Exception;
use crate::guards::platform::PlatformScope;
use crate::services::console::schema::{PreferenceP, PreferenceR};
use crate::utils::code::{external, request};

#[derive(Debug, thiserror::Error)]
pub enum ConsoleError {
    #[error("Invalid parameter: {0}")]
    BadParam(String),
    #[error("Database error: {0}")]
    Db(String),
}

impl From<ConsoleError> for Exception {
    fn from(err: ConsoleError) -> Self {
        match err {
            ConsoleError::BadParam(msg) => Exception::custom(request::INVALID_PARAMETER_VALUE, msg),
            ConsoleError::Db(msg) => {
                tracing::error!(error = %msg, "console preference database error");
                Exception::custom(external::DATABASE_ERROR, "数据库错误")
            }
        }
    }
}

pub struct ConsoleService;

impl ConsoleService {
    pub async fn toRead(
        scope: &PlatformScope,
        actor: Uuid,
    ) -> Result<Option<PreferenceR>, ConsoleError> {
        let row = console_preference::Entity::find()
            .filter(console_preference::Column::UserId.eq(actor))
            .one(scope.tx())
            .await
            .map_err(|e| ConsoleError::Db(e.to_string()))?;

        Ok(row.map(into_r))
    }

    pub async fn toUpdate(
        scope: &PlatformScope,
        actor: Uuid,
        body: PreferenceP,
    ) -> Result<PreferenceR, ConsoleError> {
        if body.nav_order.len() > 64 {
            return Err(ConsoleError::BadParam("navOrder 过长".into()));
        }
        if body.pinned_nav.len() > 64 {
            return Err(ConsoleError::BadParam("pinnedNav 过长".into()));
        }
        if body.dashboard_widgets.len() > 32 {
            return Err(ConsoleError::BadParam("dashboardWidgets 过长".into()));
        }
        if body.bookmarks.len() > 40 {
            return Err(ConsoleError::BadParam("bookmarks 过长".into()));
        }

        let now = Utc::now().fixed_offset();
        let existing = console_preference::Entity::find()
            .filter(console_preference::Column::UserId.eq(actor))
            .one(scope.tx())
            .await
            .map_err(|e| ConsoleError::Db(e.to_string()))?;

        let nav_order = Value::Array(body.nav_order.into_iter().map(Value::String).collect());
        let pinned_nav = Value::Array(body.pinned_nav.into_iter().map(Value::String).collect());
        let dashboard_widgets =
            Value::Array(body.dashboard_widgets.into_iter().map(Value::String).collect());
        let bookmarks = Value::Array(body.bookmarks);

        let model = if let Some(row) = existing {
            let mut active: console_preference::ActiveModel = row.into();
            active.nav_order = Set(nav_order);
            active.pinned_nav = Set(pinned_nav);
            active.dashboard_widgets = Set(dashboard_widgets);
            active.bookmarks = Set(bookmarks);
            active.updated_at = Set(now);
            active.updater = Set(Some(actor));
            active
                .update(scope.tx())
                .await
                .map_err(|e| ConsoleError::Db(e.to_string()))?
        } else {
            console_preference::ActiveModel {
                id: Set(Uuid::new_v4()),
                user_id: Set(actor),
                nav_order: Set(nav_order),
                pinned_nav: Set(pinned_nav),
                dashboard_widgets: Set(dashboard_widgets),
                bookmarks: Set(bookmarks),
                created_at: Set(now),
                creator: Set(Some(actor)),
                updated_at: Set(now),
                updater: Set(Some(actor)),
            }
            .insert(scope.tx())
            .await
            .map_err(|e| ConsoleError::Db(e.to_string()))?
        };

        Ok(into_r(model))
    }
}

fn into_r(model: console_preference::Model) -> PreferenceR {
    PreferenceR {
        id: model.id.to_string(),
        user_id: model.user_id.to_string(),
        nav_order: string_array(&model.nav_order),
        pinned_nav: string_array(&model.pinned_nav),
        dashboard_widgets: string_array(&model.dashboard_widgets),
        bookmarks: match model.bookmarks {
            Value::Array(items) => items,
            _ => vec![],
        },
        updated_at: model.updated_at.timestamp_millis(),
    }
}

fn string_array(value: &Value) -> Vec<String> {
    match value {
        Value::Array(items) => items
            .iter()
            .filter_map(|item| item.as_str().map(str::to_string))
            .collect(),
        _ => vec![],
    }
}

