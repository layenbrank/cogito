use chrono::Utc;
use cogito_database::entity::countdown as schema;
use sea_orm::{ActiveModelTrait, ActiveValue::Set, ConnectionTrait, EntityTrait, TransactionTrait};

use crate::exception::Exception;

const SINGLETON_ID: &str = "00000000-0000-0000-0000-000000000001";

pub struct Service;

impl Service {
    pub async fn read<C: ConnectionTrait + TransactionTrait>(
        db: &C,
    ) -> Result<Option<schema::Model>, Exception> {
        let model = schema::Entity::find_by_id(SINGLETON_ID).one(db).await?;
        Ok(model)
    }

    pub async fn upsert<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: schema::Model,
    ) -> Result<String, Exception> {
        let now = Utc::now().timestamp_millis();

        if let Some(existing) = schema::Entity::find_by_id(SINGLETON_ID).one(db).await? {
            let mut active: schema::ActiveModel = existing.into();
            active.work_start = Set(params.work_start);
            active.work_end = Set(params.work_end);
            active.work_days = Set(params.work_days);
            active.monthly_salary = Set(params.monthly_salary);
            active.pay_day = Set(params.pay_day);
            active.updated_at = Set(now);
            active.update(db).await?;
        } else {
            let model = schema::ActiveModel {
                id: Set(SINGLETON_ID.to_string()),
                work_start: Set(params.work_start),
                work_end: Set(params.work_end),
                work_days: Set(params.work_days),
                monthly_salary: Set(params.monthly_salary),
                pay_day: Set(params.pay_day),
                archived_at: Set(None),
                created_at: Set(now),
                updated_at: Set(now),
            };
            schema::Entity::insert(model).exec(db).await?;
        }

        Ok(SINGLETON_ID.to_string())
    }

    pub async fn update<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: schema::Update,
    ) -> Result<String, Exception> {
        let now = Utc::now().timestamp_millis();
        let existing = schema::Entity::find_by_id(SINGLETON_ID)
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound("countdown".to_string()))?;

        let mut active: schema::ActiveModel = existing.into();

        if let Some(v) = params.work_start {
            active.work_start = Set(v);
        }
        if let Some(v) = params.work_end {
            active.work_end = Set(v);
        }
        if let Some(v) = params.work_days {
            active.work_days = Set(v);
        }
        if let Some(v) = params.monthly_salary {
            active.monthly_salary = Set(v);
        }
        if let Some(v) = params.pay_day {
            active.pay_day = Set(v);
        }
        active.updated_at = Set(now);

        active.update(db).await?;
        Ok(SINGLETON_ID.to_string())
    }
}
