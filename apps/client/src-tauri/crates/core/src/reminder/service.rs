use chrono::{Datelike, Local, Timelike, Utc};
use cogito_database::entity::reminder as schema;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, Condition, ConnectionTrait, EntityTrait,
    QueryFilter, QueryOrder, TransactionTrait,
};
use uuid::Uuid;

use crate::exception::Exception;

pub struct Service;

impl Service {
    #[allow(non_snake_case)]
    pub async fn toWrite<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: schema::WriteP,
    ) -> Result<Vec<String>, Exception> {
        match params {
            schema::WriteP::One(p) => {
                let id = Self::write_one(db, p).await?;
                Ok(vec![id])
            }
            schema::WriteP::Many(ps) => {
                if ps.is_empty() {
                    return Ok(vec![]);
                }
                let txn = db.begin().await?;
                let mut ids = Vec::with_capacity(ps.len());
                for p in ps {
                    ids.push(Self::write_one(&txn, p).await?);
                }
                txn.commit().await?;
                Ok(ids)
            }
        }
    }

    #[allow(non_snake_case)]
    pub async fn toRead<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: schema::ReadP,
    ) -> Result<Vec<schema::Model>, Exception> {
        match params {
            schema::ReadP::One(p) => {
                let rows = schema::Entity::find()
                    .filter(Self::build_read_filter(&p))
                    .order_by_asc(schema::Column::DueAt)
                    .order_by_asc(schema::Column::FireTime)
                    .order_by_desc(schema::Column::CreatedAt)
                    .all(db)
                    .await?;
                Ok(rows)
            }
            schema::ReadP::Many(ps) => {
                if ps.is_empty() {
                    return Ok(vec![]);
                }
                let combined = ps.iter().fold(Condition::any(), |any, p| {
                    any.add(Self::build_read_filter(p))
                });
                let rows = schema::Entity::find()
                    .filter(combined)
                    .order_by_asc(schema::Column::DueAt)
                    .order_by_asc(schema::Column::FireTime)
                    .order_by_desc(schema::Column::CreatedAt)
                    .all(db)
                    .await?;
                Ok(rows)
            }
        }
    }

    #[allow(non_snake_case)]
    pub async fn toUpdate<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: schema::UpdateP,
    ) -> Result<Vec<String>, Exception> {
        match params {
            schema::UpdateP::One(p) => {
                let updated_id = Self::update_one(db, p).await?;
                Ok(vec![updated_id])
            }
            schema::UpdateP::Many(ps) => {
                if ps.is_empty() {
                    return Ok(vec![]);
                }
                let txn = db.begin().await?;
                let mut updated_ids = Vec::with_capacity(ps.len());
                for p in ps {
                    updated_ids.push(Self::update_one(&txn, p).await?);
                }
                txn.commit().await?;
                Ok(updated_ids)
            }
        }
    }

    #[allow(non_snake_case)]
    pub async fn toRemove<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: schema::RemoveP,
    ) -> Result<Vec<String>, Exception> {
        match params {
            schema::RemoveP::One(p) => {
                let exists = schema::Entity::find_by_id(p.clone()).one(db).await?;
                if exists.is_none() {
                    return Ok(vec![]);
                }
                schema::Entity::delete_many()
                    .filter(schema::Column::Id.eq(p.clone()))
                    .exec(db)
                    .await?;
                Ok(vec![p])
            }
            schema::RemoveP::Many(ps) => {
                if ps.is_empty() {
                    return Ok(vec![]);
                }
                let models = schema::Entity::find()
                    .filter(schema::Column::Id.is_in(ps.clone()))
                    .all(db)
                    .await?;
                if models.is_empty() {
                    return Ok(vec![]);
                }
                let ids: Vec<String> = models.into_iter().map(|m| m.id).collect();
                schema::Entity::delete_many()
                    .filter(schema::Column::Id.is_in(ids.clone()))
                    .exec(db)
                    .await?;
                Ok(ids)
            }
        }
    }

    /// Active enabled reminders for the scheduler.
    #[allow(non_snake_case)]
    pub async fn toReadSchedulable<C: ConnectionTrait>(
        db: &C,
    ) -> Result<Vec<schema::Model>, Exception> {
        let rows = schema::Entity::find()
            .filter(schema::Column::ArchivedAt.is_null())
            .filter(schema::Column::Enabled.eq(true))
            .order_by_asc(schema::Column::FireTime)
            .order_by_asc(schema::Column::DueAt)
            .all(db)
            .await?;
        Ok(rows)
    }

    /// Claim a fire: persist lastFiredAt (and archive one-shot) before notify.
    /// Returns the claimed model, or None if another tick already claimed this minute.
    #[allow(non_snake_case)]
    pub async fn toClaimFire<C: ConnectionTrait>(
        db: &C,
        id: &str,
        archive_one_shot: bool,
    ) -> Result<Option<schema::Model>, Exception> {
        let model = schema::Entity::find_by_id(id.to_string())
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound(format!("reminder not found: {id}")))?;

        if model.archived_at.is_some() || !model.enabled {
            return Ok(None);
        }

        let now = Utc::now().timestamp_millis();
        let minute_key = Local::now().format("%Y-%m-%d %H:%M").to_string();
        if already_fired_this_minute(model.last_fired_at, &minute_key) {
            return Ok(None);
        }

        let mut active: schema::ActiveModel = model.into();
        active.last_fired_at = Set(Some(now));
        active.snooze_until = Set(None);
        if archive_one_shot {
            active.archived_at = Set(Some(now));
            active.enabled = Set(false);
        }
        active.updated_at = Set(now);
        let updated = active.update(db).await?;
        Ok(Some(updated))
    }

    async fn write_one<C: ConnectionTrait>(db: &C, p: schema::Write) -> Result<String, Exception> {
        if p.due_at.is_none()
            && p.fire_time
                .as_ref()
                .map(|s| s.trim().is_empty())
                .unwrap_or(true)
        {
            return Err(Exception::Validation(
                "reminder requires dueAt or fireTime".to_string(),
            ));
        }
        let now = Utc::now().timestamp_millis();
        let id = Uuid::new_v4().to_string();
        let model = schema::ActiveModel {
            id: Set(id.clone()),
            title: Set(p.title),
            notes: Set(p.notes),
            due_at: Set(p.due_at),
            end_at: Set(p.end_at),
            fire_time: Set(p.fire_time),
            week_days: Set(p.week_days),
            entire_day: Set(p.entire_day),
            enabled: Set(p.enabled),
            snooze_until: Set(p.snooze_until),
            last_fired_at: Set(None),
            priority: Set(p.priority),
            archived_at: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
        };
        schema::Entity::insert(model).exec(db).await?;
        Ok(id)
    }

    async fn update_one<C: ConnectionTrait>(
        db: &C,
        payload: schema::Update,
    ) -> Result<String, Exception> {
        let model = schema::Entity::find_by_id(payload.key.clone())
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound(format!("reminder not found: {}", payload.key)))?;

        let mut active: schema::ActiveModel = model.into();
        let now = Utc::now().timestamp_millis();

        if let Some(v) = payload.change.title {
            active.title = Set(v);
        }
        if let Some(v) = payload.change.notes {
            active.notes = Set(v);
        }
        if let Some(v) = payload.change.due_at {
            active.due_at = Set(v);
        }
        if let Some(v) = payload.change.end_at {
            active.end_at = Set(v);
        }
        if let Some(v) = payload.change.fire_time {
            active.fire_time = Set(v);
        }
        if let Some(v) = payload.change.week_days {
            active.week_days = Set(v);
        }
        if let Some(v) = payload.change.entire_day {
            active.entire_day = Set(v);
        }
        if let Some(v) = payload.change.enabled {
            active.enabled = Set(v);
        }
        if let Some(v) = payload.change.snooze_until {
            active.snooze_until = Set(v);
        }
        if let Some(v) = payload.change.priority {
            active.priority = Set(v);
        }
        if let Some(v) = payload.change.archived_at {
            active.archived_at = Set(v);
        }
        active.updated_at = Set(now);

        let updated = active.update(db).await?;
        Ok(updated.id)
    }

    fn build_read_filter(payload: &schema::Read) -> Condition {
        let mut cond = Condition::all();
        if let Some(ref id) = payload.id {
            cond = cond.add(schema::Column::Id.eq(id.clone()));
        }
        if let Some(ref title) = payload.title {
            cond = cond.add(schema::Column::Title.eq(title.clone()));
        }
        if let Some(enabled) = payload.enabled {
            cond = cond.add(schema::Column::Enabled.eq(enabled));
        }
        if !payload.archived {
            cond = cond.add(schema::Column::ArchivedAt.is_null());
        }
        if let Some(due_from) = payload.due_from {
            cond = cond.add(schema::Column::DueAt.gte(due_from));
        }
        if let Some(due_to) = payload.due_to {
            cond = cond.add(schema::Column::DueAt.lt(due_to));
        }
        cond
    }
}

fn already_fired_this_minute(last_fired_at: Option<i64>, minute_key: &str) -> bool {
    let Some(ts) = last_fired_at else {
        return false;
    };
    let Some(dt) = chrono::DateTime::from_timestamp_millis(ts) else {
        return false;
    };
    dt.with_timezone(&Local)
        .format("%Y-%m-%d %H:%M")
        .to_string()
        == minute_key
}

/// Whether a schedulable reminder should fire at `now` (with catch-up within the same local minute window for dueAt / snooze / fireTime).
pub fn should_fire(model: &schema::Model, now_ms: i64) -> bool {
    let local = Local::now();
    let minute_key = local.format("%Y-%m-%d %H:%M").to_string();
    if already_fired_this_minute(model.last_fired_at, &minute_key) {
        return false;
    }

    if let Some(snooze_until) = model.snooze_until {
        return now_ms >= snooze_until;
    }

    if let Some(due_at) = model.due_at {
        // Catch-up: due within the last 24h and not yet fired after due.
        if now_ms >= due_at {
            let fired_ok = model.last_fired_at.map(|t| t >= due_at).unwrap_or(false);
            return !fired_ok && now_ms - due_at < 24 * 60 * 60 * 1000;
        }
        return false;
    }

    let Some(ref fire_time) = model.fire_time else {
        return false;
    };
    let current_hm = format!("{:02}:{:02}", local.hour(), local.minute());
    let iso_weekday = local.weekday().number_from_monday() as i32;
    let week_days: Vec<i32> = serde_json::from_str(&model.week_days).unwrap_or_default();
    let is_one_shot = week_days.is_empty();

    if fire_time.trim() != current_hm {
        // Catch-up: same clock minute already passed this local day (within 15 min grace).
        if let Some((h, m)) = parse_hm(fire_time) {
            let target_min = h * 60 + m;
            let now_min = local.hour() as i32 * 60 + local.minute() as i32;
            let delta = now_min - target_min;
            if !(delta > 0 && delta <= 15) {
                return false;
            }
        } else {
            return false;
        }
    }

    if is_one_shot {
        return true;
    }
    week_days.contains(&iso_weekday)
}

pub fn is_one_shot(week_days: &str) -> bool {
    match serde_json::from_str::<Vec<i32>>(week_days) {
        Ok(days) => days.is_empty(),
        Err(_) => true,
    }
}

fn parse_hm(fire_time: &str) -> Option<(i32, i32)> {
    let parts: Vec<&str> = fire_time.trim().split(':').collect();
    if parts.len() < 2 {
        return None;
    }
    let h = parts[0].parse().ok()?;
    let m = parts[1].parse().ok()?;
    Some((h, m))
}
