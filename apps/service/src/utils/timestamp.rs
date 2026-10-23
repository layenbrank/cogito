use std::str::FromStr;

use chrono::{DateTime, TimeZone, Utc};
use serde::{Deserialize, Deserializer, Serializer};

/// 将 DateTime 序列化为毫秒时间戳
pub fn to_ts<S>(dt: &DateTime<Utc>, s: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    s.serialize_i64(dt.timestamp_millis())
}

/// 从毫秒时间戳反序列化为 DateTime
pub fn from_ts<'de, D>(d: D) -> Result<DateTime<Utc>, D::Error>
where
    D: Deserializer<'de>,
{
    let ts = i64::deserialize(d)?;
    Utc.timestamp_millis_opt(ts)
        .single()
        .ok_or_else(|| serde::de::Error::custom("invalid timestamp"))
}

/// 将 Option<DateTime> 序列化为可选的毫秒时间戳
pub fn to_ts_opt<S>(dt: &Option<DateTime<Utc>>, s: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    match dt {
        Some(d) => s.serialize_some(&d.timestamp_millis()),
        None => s.serialize_none(),
    }
}

/// 从可选的时间戳反序列化为 Option<DateTime>
pub fn from_ts_opt<'de, D>(d: D) -> Result<Option<DateTime<Utc>>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<i64>::deserialize(d).map(|ts| ts.and_then(|v| Utc.timestamp_millis_opt(v).single()))
}

/// 将字符串或数字反序列化为数字类型
pub fn from_str_or_num<'de, T, D>(d: D) -> Result<T, D::Error>
where
    T: FromStr + Deserialize<'de>,
    T::Err: std::fmt::Display,
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StrOrNum<T> {
        Str(String),
        Num(T),
    }

    match StrOrNum::<T>::deserialize(d)? {
        StrOrNum::Str(s) => s.parse().map_err(serde::de::Error::custom),
        StrOrNum::Num(n) => Ok(n),
    }
}
