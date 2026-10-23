//! 模型价目表：把「谁在什么时候按什么单价计费」写成不可回溯篡改的区间记录。
//!
//! 三条约定决定了这里的全部形状：
//!
//! 1. **不原地改价**。金额与生效起点写入后不可改，改价一律「关旧窗口 + 开新窗口」；
//!    否则昨天算出来的账会随今天的一次编辑而漂移，对账就失去意义。
//!    [`PriceUpdateP`] 因此只开放 `modelName`（快照名）与 `effectiveTo`（收窄窗口）。
//! 2. **窗口不重叠**。取价是在聚合 SQL 里 `ORDER BY ... LIMIT 1`，重叠会让「按哪条价算」
//!    变成未定义行为，于是写入前先用 [`Window`] 判重（同一租户同一型号，含平台默认价）。
//!    相邻不算重叠（`[a, b)` 与 `[b, c)` 可以首尾相接）。
//! 3. **归档是软删除**。`archivedAt` 置位后不再参与取价，但历史对账快照仍指向这一行。
//!
//! 金额折算的公式不在这里（见 `billing::amount_cents`）：本模块只负责把行读出来、
//! 把窗口关系判对，算账口径与 SQL 取价共用同一份内核。

use chrono::{DateTime, Utc};
use entity::{billing_price, gateway_model};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, DbErr, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect, Set,
};
use uuid::Uuid;

use billing::{PriceDraft, PriceError as DraftError, Window};

use crate::filters::exception::Exception;
use crate::guards::platform::PlatformScope;
use crate::services::payment::schema::{PriceQueryP, PriceR, PriceUpdateP, PriceWriteP};
use crate::services::payment::service::CURRENCY;
use crate::utils::code::{business, external, request};

/// 价目列表的硬上限：价目量级是「型号数 × 改价次数」，一次取全便于核对；
/// 但仍设上限，避免某天有人批量导入把响应撑爆。
const PRICE_LIST_LIMIT: u64 = 200;

/// 单价上限（分 / 百万 token）。防的是手滑多打几个零：这个数字已经没有商业意义了。
const MAX_PRICE_PER_MILLION: i64 = 1_000_000_000;

#[derive(Debug, thiserror::Error)]
pub enum PriceError {
    #[error("价目不存在")]
    NotFound,
    #[error("同一租户下该型号已有重叠的价格窗口")]
    Overlap,
    #[error("价格生效区间无效：结束时间必须晚于开始时间")]
    WindowInvalid,
    #[error("窗口只能收窄：新的结束时间必须落在生效起点之后、原结束时间之前")]
    WindowNotNarrowing,
    #[error("单价不在允许范围内（0 ~ {0} 分 / 百万 token）")]
    AmountOutOfRange(i64),
    #[error("币种必须是结算币种 {0}")]
    CurrencyUnsupported(String),
    #[error("参数无效：{0}")]
    BadParam(String),
    #[error("数据库错误：{0}")]
    Db(String),
}

impl From<DraftError> for PriceError {
    fn from(err: DraftError) -> Self {
        match err {
            DraftError::WindowInvalid => Self::WindowInvalid,
            DraftError::WindowOverlap { .. } => Self::Overlap,
            DraftError::NegativeAmount | DraftError::Money(_) => {
                Self::AmountOutOfRange(MAX_PRICE_PER_MILLION)
            }
            DraftError::CurrencyInvalid => Self::CurrencyUnsupported(CURRENCY.to_string()),
        }
    }
}

impl From<PriceError> for Exception {
    fn from(err: PriceError) -> Self {
        match err {
            PriceError::NotFound => {
                Exception::custom(business::payment::PRICE_NOT_FOUND, "价目不存在")
            }
            PriceError::Overlap => Exception::custom(
                business::payment::PRICE_WINDOW_OVERLAP,
                "同一租户该型号已有重叠的价格窗口，请先关闭旧窗口",
            ),
            PriceError::WindowInvalid => Exception::custom(
                business::payment::PRICE_WINDOW_INVALID,
                "价格生效区间无效：结束时间必须晚于开始时间",
            ),
            PriceError::WindowNotNarrowing => Exception::custom(
                business::payment::PRICE_WINDOW_INVALID,
                "窗口只能收窄：新的结束时间必须落在生效起点之后、原结束时间之前",
            ),
            PriceError::AmountOutOfRange(max) => Exception::custom(
                business::payment::PRICE_INVALID_AMOUNT,
                format!("单价必须在 0 ~ {max} 分 / 百万 token 之间"),
            ),
            PriceError::CurrencyUnsupported(expected) => Exception::custom(
                business::payment::PRICE_CURRENCY_UNSUPPORTED,
                format!("价格币种必须与结算币种一致（{expected}）"),
            ),
            PriceError::BadParam(msg) => Exception::custom(request::INVALID_PARAMETER_VALUE, msg),
            PriceError::Db(msg) => {
                tracing::error!(error = %msg, "billing price database error");
                Exception::custom(external::DATABASE_ERROR, "数据库错误")
            }
        }
    }
}

/// 价目查询条件（已从 DTO 解析校验）。
#[derive(Debug, Clone, Default)]
pub struct PriceFilter {
    pub tenant_id: Option<Uuid>,
    pub model_id: Option<Uuid>,
    pub active_only: bool,
    pub include_archived: bool,
}

impl PriceFilter {
    /// 只校验**给了值的**字段：查询是排查入口，缺省即不过滤。
    ///
    /// # Errors
    /// `tenantID` / `modelID` 不是合法 UUID 时返回 [`PriceError::BadParam`]。
    pub fn parse(query: &PriceQueryP) -> Result<Self, PriceError> {
        Ok(Self {
            tenant_id: optional_uuid(query.tenant_id.as_deref(), "tenantID")?,
            model_id: optional_uuid(query.model_id.as_deref(), "modelID")?,
            active_only: query.active_only.unwrap_or(false),
            include_archived: query.include_archived.unwrap_or(false),
        })
    }
}

pub struct PriceService;

impl PriceService {
    /// 按条件列出价目（时间倒序，同一起点按 id 定序，保证分页外也稳定可读）。
    ///
    /// # Errors
    /// 数据库读取失败。
    pub async fn list(
        scope: &PlatformScope,
        filter: &PriceFilter,
    ) -> Result<Vec<PriceR>, PriceError> {
        let now = Utc::now();
        let mut query = billing_price::Entity::find();
        if let Some(tenant_id) = filter.tenant_id {
            query = query.filter(billing_price::Column::TenantId.eq(tenant_id));
        }
        if let Some(model_id) = filter.model_id {
            query = query.filter(billing_price::Column::ModelId.eq(model_id));
        }
        if !filter.include_archived {
            query = query.filter(billing_price::Column::ArchivedAt.is_null());
        }
        if filter.active_only {
            let at = now.fixed_offset();
            query = query.filter(
                Condition::all()
                    .add(billing_price::Column::EffectiveFrom.lte(at))
                    .add(
                        Condition::any()
                            .add(billing_price::Column::EffectiveTo.is_null())
                            .add(billing_price::Column::EffectiveTo.gt(at)),
                    ),
            );
        }
        let rows = query
            .order_by_desc(billing_price::Column::EffectiveFrom)
            .order_by_desc(billing_price::Column::Id)
            .limit(PRICE_LIST_LIMIT)
            .all(scope.tx())
            .await
            .map_err(db_err)?;
        Ok(rows.into_iter().map(|row| view(row, now)).collect())
    }

    /// 新建一条价目。
    ///
    /// # Errors
    /// 型号不存在、参数非法、币种不是结算币种、区间重叠、数据库写入失败。
    pub async fn create(
        scope: &PlatformScope,
        actor: Uuid,
        payload: PriceWriteP,
    ) -> Result<PriceR, PriceError> {
        let tenant_id = optional_uuid(payload.tenant_id.as_deref(), "tenantID")?;
        let model_id = required_uuid(&payload.model_id, "modelID")?;
        let currency = payload
            .currency
            .unwrap_or_else(|| CURRENCY.to_string())
            .to_uppercase();
        if currency != CURRENCY {
            return Err(PriceError::CurrencyUnsupported(CURRENCY.to_string()));
        }
        let from = to_utc(payload.effective_from, "effectiveFrom")?;
        let to = payload
            .effective_to
            .map(|millis| to_utc(millis, "effectiveTo"))
            .transpose()?;
        let window = Window::new(from, to)?;

        let draft = PriceDraft {
            tenant_id,
            model_id,
            model_name: model_name(scope, model_id).await?,
            currency,
            input_per_million: payload.input_price_per_million,
            output_per_million: payload.output_price_per_million,
            window,
        };
        draft.validate().map_err(PriceError::from)?;
        if draft.input_per_million > MAX_PRICE_PER_MILLION
            || draft.output_per_million > MAX_PRICE_PER_MILLION
        {
            return Err(PriceError::AmountOutOfRange(MAX_PRICE_PER_MILLION));
        }
        let existing = windows_of(scope, tenant_id, model_id).await?;
        draft
            .ensure_no_overlap(&existing)
            .map_err(PriceError::from)?;

        let now = Utc::now().fixed_offset();
        let row = billing_price::ActiveModel {
            id: Set(Uuid::new_v4()),
            tenant_id: Set(tenant_id),
            model_id: Set(model_id),
            model_name: Set(draft.model_name),
            currency: Set(draft.currency),
            input_price_per_million: Set(draft.input_per_million),
            output_price_per_million: Set(draft.output_per_million),
            effective_from: Set(from.fixed_offset()),
            effective_to: Set(to.map(|end| end.fixed_offset())),
            archived_at: Set(None),
            created_at: Set(now),
            creator: Set(Some(actor)),
            updated_at: Set(now),
            updater: Set(Some(actor)),
        }
        .insert(scope.tx())
        .await
        .map_err(db_err)?;
        Ok(view(row, Utc::now()))
    }

    /// 改一条价目：只允许改型号名快照与收窄窗口。
    ///
    /// # Errors
    /// 价目不存在、没有可改字段、窗口不是收窄、数据库写入失败。
    pub async fn update(
        scope: &PlatformScope,
        actor: Uuid,
        id: Uuid,
        payload: PriceUpdateP,
    ) -> Result<PriceR, PriceError> {
        if payload.model_name.is_none() && payload.effective_to.is_none() {
            return Err(PriceError::BadParam(
                "至少提供 modelName 或 effectiveTo 其中之一".to_string(),
            ));
        }
        let row = find(scope, id).await?;
        let start = DateTime::<Utc>::from(row.effective_from);
        let previous = row.effective_to.map(DateTime::<Utc>::from);
        let mut active: billing_price::ActiveModel = row.into();

        if let Some(name) = payload.model_name {
            let name = name.trim().to_string();
            if name.is_empty() {
                return Err(PriceError::BadParam("modelName 不能为空".to_string()));
            }
            active.model_name = Set(name);
        }
        if let Some(millis) = payload.effective_to {
            let to = to_utc(millis, "effectiveTo")?;
            // 只允许收窄：窗口可以提前结束，但不能延后，更不能越过原终点把窗口改大。
            // 原终点为 None（长期生效）时任何晚于起点的终点都是一次收窄。
            if to <= start || previous.is_some_and(|end| to > end) {
                return Err(PriceError::WindowNotNarrowing);
            }
            active.effective_to = Set(Some(to.fixed_offset()));
        }
        let now = Utc::now().fixed_offset();
        active.updated_at = Set(now);
        active.updater = Set(Some(actor));
        let row = active.update(scope.tx()).await.map_err(db_err)?;
        Ok(view(row, Utc::now()))
    }

    /// 归档一条价目（软删除）：不再参与取价，但历史对账仍指向它。重复归档是幂等的。
    ///
    /// # Errors
    /// 价目不存在、数据库写入失败。
    pub async fn archive(scope: &PlatformScope, actor: Uuid, id: Uuid) -> Result<(), PriceError> {
        let row = find(scope, id).await?;
        if row.archived_at.is_some() {
            return Ok(());
        }
        let now = Utc::now().fixed_offset();
        let mut active: billing_price::ActiveModel = row.into();
        active.archived_at = Set(Some(now));
        active.updated_at = Set(now);
        active.updater = Set(Some(actor));
        active.update(scope.tx()).await.map_err(db_err)?;
        Ok(())
    }
}

/// 取一行；不存在即 [`PriceError::NotFound`]（分区由 `billing_price` 的恒假策略保证：
/// 这张表没有任何请求作用域能看见，只有特权作用域读得到）。
async fn find(scope: &PlatformScope, id: Uuid) -> Result<billing_price::Model, PriceError> {
    billing_price::Entity::find_by_id(id)
        .one(scope.tx())
        .await
        .map_err(db_err)?
        .ok_or(PriceError::NotFound)
}

/// 同一 `(租户, 型号)` 下的全部有效窗口。
///
/// 平台默认价（`tenantID IS NULL`）与租户专属价**各自判重**：两者可以同时存在，
/// 取价时专属价优先；但同类里出现两个重叠窗口就是数据错误。
async fn windows_of(
    scope: &PlatformScope,
    tenant_id: Option<Uuid>,
    model_id: Uuid,
) -> Result<Vec<Window>, PriceError> {
    let tenant_filter = match tenant_id {
        Some(id) => billing_price::Column::TenantId.eq(id),
        None => billing_price::Column::TenantId.is_null(),
    };
    let rows = billing_price::Entity::find()
        .filter(billing_price::Column::ModelId.eq(model_id))
        .filter(tenant_filter)
        .filter(billing_price::Column::ArchivedAt.is_null())
        .all(scope.tx())
        .await
        .map_err(db_err)?;
    Ok(rows.iter().filter_map(stored_window).collect())
}

/// 已落库行的窗口。历史行必然合法，反解不出来（结束早于开始）时按「不参与判重」跳过，
/// 避免一条脏数据把后续所有改价都挡死。
fn stored_window(row: &billing_price::Model) -> Option<Window> {
    Window::new(
        DateTime::<Utc>::from(row.effective_from),
        row.effective_to.map(DateTime::<Utc>::from),
    )
    .ok()
}

/// 型号名的快照源：优先目录里的展示名（`label`），回落技术名（`name`）。
async fn model_name(scope: &PlatformScope, model_id: Uuid) -> Result<String, PriceError> {
    let row = gateway_model::Entity::find_by_id(model_id)
        .filter(gateway_model::Column::ArchivedAt.is_null())
        .one(scope.tx())
        .await
        .map_err(db_err)?
        .ok_or_else(|| PriceError::BadParam("modelID 指向的模型不存在或已下线".to_string()))?;
    Ok(if row.label.trim().is_empty() {
        row.name
    } else {
        row.label
    })
}

fn view(row: billing_price::Model, now: DateTime<Utc>) -> PriceR {
    let active =
        row.archived_at.is_none() && stored_window(&row).is_some_and(|window| window.contains(now));
    PriceR {
        id: row.id.to_string(),
        tenant_id: row.tenant_id.map(|id| id.to_string()),
        model_id: row.model_id.to_string(),
        model_name: row.model_name,
        currency: row.currency,
        input_price_per_million: row.input_price_per_million,
        output_price_per_million: row.output_price_per_million,
        effective_from: row.effective_from.timestamp_millis(),
        effective_to: row.effective_to.map(|t| t.timestamp_millis()),
        active,
        archived_at: row.archived_at.map(|t| t.timestamp_millis()),
        created_at: row.created_at.timestamp_millis(),
        updated_at: row.updated_at.timestamp_millis(),
    }
}

/// 毫秒时间戳 → UTC 时刻。对外的价格窗口径统一是毫秒，非法值在入口就挡住。
fn to_utc(millis: i64, field: &str) -> Result<DateTime<Utc>, PriceError> {
    DateTime::<Utc>::from_timestamp_millis(millis)
        .ok_or_else(|| PriceError::BadParam(format!("{field} 不是合法的毫秒时间戳")))
}

/// 空串按「没给」处理：查询串里 `?tenantID=` 的语义显然不是「找一个 id 为空的行」。
fn optional_uuid(value: Option<&str>, field: &str) -> Result<Option<Uuid>, PriceError> {
    match value.map(str::trim) {
        None | Some("") => Ok(None),
        Some(raw) => Uuid::parse_str(raw)
            .map(Some)
            .map_err(|_| PriceError::BadParam(format!("{field} 格式无效"))),
    }
}

/// 必填字段：没给和给了空串一样算缺参数。
fn required_uuid(value: &str, field: &str) -> Result<Uuid, PriceError> {
    optional_uuid(Some(value), field)?
        .ok_or_else(|| PriceError::BadParam(format!("{field} 不能为空")))
}

fn db_err(err: DbErr) -> PriceError {
    PriceError::Db(err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query(tenant: Option<&str>, model: Option<&str>) -> PriceQueryP {
        PriceQueryP {
            tenant_id: tenant.map(ToString::to_string),
            model_id: model.map(ToString::to_string),
            active_only: None,
            include_archived: None,
        }
    }

    #[test]
    fn filter_defaults_to_no_narrowing() {
        let filter = PriceFilter::parse(&query(None, None)).expect("缺省条件必须可用");
        assert_eq!(filter.tenant_id, None);
        assert_eq!(filter.model_id, None);
        assert!(!filter.active_only);
        assert!(!filter.include_archived, "归档价目默认不出现在列表里");
    }

    #[test]
    fn filter_treats_blank_as_absent_and_rejects_garbage() {
        let filter = PriceFilter::parse(&query(Some("  "), None)).expect("空串按没给处理");
        assert_eq!(filter.tenant_id, None);
        assert!(matches!(
            PriceFilter::parse(&query(Some("not-a-uuid"), None)),
            Err(PriceError::BadParam(_))
        ));
    }

    #[test]
    fn draft_errors_map_to_distinct_http_codes() {
        let not_found = Exception::from(PriceError::NotFound);
        assert_eq!(not_found.code, business::payment::PRICE_NOT_FOUND);
        let overlap = Exception::from(PriceError::Overlap);
        assert_eq!(overlap.code, business::payment::PRICE_WINDOW_OVERLAP);
        let amount = Exception::from(PriceError::AmountOutOfRange(MAX_PRICE_PER_MILLION));
        assert_eq!(amount.code, business::payment::PRICE_INVALID_AMOUNT);
        let currency = Exception::from(PriceError::CurrencyUnsupported("CNY".to_string()));
        assert_eq!(currency.code, business::payment::PRICE_CURRENCY_UNSUPPORTED);
    }

    #[test]
    fn window_invalid_and_not_narrowing_share_one_code() {
        assert_eq!(
            Exception::from(PriceError::WindowInvalid).code,
            business::payment::PRICE_WINDOW_INVALID
        );
        assert_eq!(
            Exception::from(PriceError::WindowNotNarrowing).code,
            business::payment::PRICE_WINDOW_INVALID
        );
    }

    #[test]
    fn negative_amount_from_kernel_becomes_out_of_range() {
        let mapped = PriceError::from(DraftError::NegativeAmount);
        assert!(matches!(mapped, PriceError::AmountOutOfRange(_)));
    }
}
