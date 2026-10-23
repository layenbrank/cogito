use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, ToSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UploadStatus {
    Pending,
    Uploading,
    Completed,
    /// 整文件秒传：会话行保留，后续 chunk/progress 幂等成功
    Superseded,
    Failed,
    Expired,
}

impl UploadStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "PENDING",
            Self::Uploading => "UPLOADING",
            Self::Completed => "COMPLETED",
            Self::Superseded => "SUPERSEDED",
            Self::Failed => "FAILED",
            Self::Expired => "EXPIRED",
        }
    }

    pub fn from_db(s: &str) -> Self {
        match s {
            "PENDING" => Self::Pending,
            "UPLOADING" => Self::Uploading,
            "COMPLETED" => Self::Completed,
            "SUPERSEDED" => Self::Superseded,
            "FAILED" => Self::Failed,
            "EXPIRED" => Self::Expired,
            other => {
                tracing::warn!(status = other, "unknown asset status");
                Self::Failed
            }
        }
    }

    /// COMPLETED / SUPERSEDED：在途分片应幂等成功，不再写入
    pub fn is_terminal_ok(&self) -> bool {
        matches!(self, Self::Completed | Self::Superseded)
    }
}

/// 资产可见性：私有 / 公开 / 指定用户
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default, ToSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Visibility {
    /// 仅创建者可下载（默认）
    #[default]
    Private,
    /// 任意已登录或匿名用户可下载
    Public,
    /// 创建者 + `viewers` 列表中的用户可下载
    Restricted,
}

impl Visibility {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Private => "PRIVATE",
            Self::Public => "PUBLIC",
            Self::Restricted => "RESTRICTED",
        }
    }

    /// 认识的字面量就认，不认识返回 `None`。
    ///
    /// 与 [`Self::from_db`] 的差别是**不兜底**：读库遇到脏值降级成 PRIVATE 是无害的保守选择，
    /// 但要把一个字符串当真写成可见性（或写进令牌）时，猜错方向就是权限事故，
    /// 所以调用方必须自己处理「不认识」。
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim() {
            "PRIVATE" => Some(Self::Private),
            "PUBLIC" => Some(Self::Public),
            "RESTRICTED" => Some(Self::Restricted),
            _ => None,
        }
    }

    pub fn from_db(s: &str) -> Self {
        Self::parse(s).unwrap_or_else(|| {
            tracing::warn!(visibility = s, "unknown asset visibility; treat as PRIVATE");
            Self::Private
        })
    }
}

#[cfg(test)]
mod status_tests {
    use super::{UploadStatus, Visibility};

    #[test]
    fn from_db_maps_known_status() {
        assert_eq!(UploadStatus::from_db("PENDING"), UploadStatus::Pending);
        assert_eq!(UploadStatus::from_db("EXPIRED"), UploadStatus::Expired);
        assert_eq!(
            UploadStatus::from_db("SUPERSEDED"),
            UploadStatus::Superseded
        );
        assert!(UploadStatus::Superseded.is_terminal_ok());
        assert!(UploadStatus::Completed.is_terminal_ok());
        assert!(!UploadStatus::Uploading.is_terminal_ok());
    }

    #[test]
    fn from_db_unknown_is_failed() {
        assert_eq!(UploadStatus::from_db("bogus"), UploadStatus::Failed);
    }

    #[test]
    fn visibility_defaults_private() {
        assert_eq!(Visibility::default(), Visibility::Private);
        assert_eq!(Visibility::from_db("bogus"), Visibility::Private);
        assert_eq!(Visibility::from_db("PUBLIC"), Visibility::Public);
        assert_eq!(Visibility::from_db("RESTRICTED"), Visibility::Restricted);
    }

    /// 写路径用 `parse`：不认识就是 `None`，绝不悄悄降级成某个可见性。
    #[test]
    fn parse_rejects_unknown_visibility() {
        assert_eq!(Visibility::parse("PRIVATE"), Some(Visibility::Private));
        assert_eq!(Visibility::parse("PUBLIC"), Some(Visibility::Public));
        assert_eq!(
            Visibility::parse("RESTRICTED"),
            Some(Visibility::Restricted)
        );
        assert_eq!(Visibility::parse("public"), None);
        assert_eq!(Visibility::parse("INTERNAL"), None);
        assert_eq!(Visibility::parse(""), None);
    }
}

/// 已上传分片（含 hash，供续传对比与分片秒传）
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UploadedChunk {
    #[schema(example = 0)]
    pub index: u32,
    #[schema(example = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")]
    pub hash: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({
    "name": "sample.pdf",
    "size": 1048576,
    "mime": "application/pdf",
    "chunk": 1048576
}))]
pub struct PrepareP {
    #[schema(example = "sample.pdf")]
    pub name: String,
    #[schema(example = 1048576_u64)]
    pub size: u64,
    /// 整文件 SHA-256；可省略，稍后再 `PATCH /upload/hash` 绑定
    #[serde(default)]
    #[schema(example = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")]
    pub hash: Option<String>,
    #[schema(example = "application/pdf")]
    pub mime: String,
    /// 分片大小（字节），须在 10MB~100MB
    #[schema(example = 1048576_u32)]
    pub chunk: u32,
    /// 租户 ID（租户模型未接线前可选）
    #[serde(default, rename = "tenantID")]
    #[schema(example = "tenant-demo")]
    pub tenant_id: Option<String>,
    /// 租户内列表排序；省略则默认 0
    #[serde(default)]
    #[schema(example = 0_i64)]
    pub index: Option<i64>,
    /// 可见性；省略则 PRIVATE
    #[serde(default)]
    pub visibility: Option<Visibility>,
    /// RESTRICTED 时的可访问用户 id 列表；其它可见性忽略
    #[serde(default)]
    #[schema(example = json!(["550e8400-e29b-41d4-a716-446655440000"]))]
    pub viewers: Option<Vec<String>>,
}

impl PrepareP {
    pub fn visibility(&self) -> Visibility {
        self.visibility.clone().unwrap_or_default()
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PrepareR {
    #[schema(example = "550e8400-e29b-41d4-a716-446655440000")]
    pub id: String,
    #[schema(example = false)]
    pub exists: bool,
    pub chunks: Vec<u32>,
    pub uploaded: Vec<UploadedChunk>,
    #[schema(example = "/api/v1/upload/chunk")]
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
}))]
pub struct HashP {
    #[schema(example = "550e8400-e29b-41d4-a716-446655440000")]
    pub id: String,
    #[schema(example = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")]
    pub hash: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct HashR {
    #[schema(example = "550e8400-e29b-41d4-a716-446655440000")]
    pub id: String,
    #[schema(example = false)]
    pub exists: bool,
    pub chunks: Vec<u32>,
    pub uploaded: Vec<UploadedChunk>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChunkR {
    #[schema(example = true)]
    pub success: bool,
    #[schema(example = 0)]
    pub index: u32,
    /// 分片内容已在 CAS 中，本次未写入新字节
    #[schema(example = false)]
    pub reused: bool,
    #[schema(example = "分片 0 上传成功")]
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({
    "id": "550e8400-e29b-41d4-a716-446655440000"
}))]
pub struct FinalizeP {
    #[schema(example = "550e8400-e29b-41d4-a716-446655440000")]
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeR {
    #[schema(example = true)]
    pub success: bool,
    #[schema(example = "/api/v1/upload/asset/550e8400-e29b-41d4-a716-446655440000")]
    pub url: String,
    #[schema(example = "550e8400-e29b-41d4-a716-446655440000")]
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProgressR {
    #[schema(example = "550e8400-e29b-41d4-a716-446655440000")]
    pub id: String,
    #[schema(example = 50.0)]
    pub progress: f64,
    pub chunks: Vec<u32>,
    pub uploaded: Vec<UploadedChunk>,
    #[schema(example = 2)]
    pub total: u32,
    pub status: UploadStatus,
    /// 秒传后的目标 COMPLETED 资产 id
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[schema(example = "550e8400-e29b-41d4-a716-446655440000")]
    pub superseded: Option<String>,
}

/// 本人文件列表查询
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FilesP {
    /// 页码，从 1 开始，默认 1
    #[serde(default)]
    #[schema(example = 1)]
    pub page: Option<u32>,
    /// 每页条数，默认 20，最大 100
    #[serde(default)]
    #[schema(example = 20)]
    pub size: Option<u32>,
    /// 状态过滤；默认只返回 COMPLETED
    #[serde(default)]
    pub status: Option<UploadStatus>,
}

/// 列表中的资产摘要
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AssetR {
    #[schema(example = "550e8400-e29b-41d4-a716-446655440000")]
    pub id: String,
    #[serde(rename = "tenantID")]
    #[schema(example = "tenant-demo")]
    pub tenant_id: Option<String>,
    #[schema(example = "sample.pdf")]
    pub name: String,
    #[schema(example = 1048576_u64)]
    pub size: u64,
    #[schema(example = "application/pdf")]
    pub mime: String,
    #[schema(example = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")]
    pub hash: String,
    /// 租户内列表排序（与分片序号无关）
    #[schema(example = 0_i64)]
    pub index: i64,
    pub status: UploadStatus,
    pub visibility: Visibility,
    /// RESTRICTED 时的可访问用户 id；其它模式为空数组
    #[serde(default)]
    pub viewers: Vec<String>,
    #[serde(rename = "createdAt")]
    #[schema(value_type = i64, example = 1700000000000_i64)]
    pub created_at: i64,
    /// 按 id 下载：`/api/v1/upload/asset/{id}`
    #[schema(example = "/api/v1/upload/asset/550e8400-e29b-41d4-a716-446655440000")]
    pub url: String,
}

/// 分页列表 data
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FilesR {
    pub items: Vec<AssetR>,
    pub count: u64,
    pub page: u32,
    pub size: u32,
    pub total: u32,
    pub next: bool,
    pub prev: bool,
}

impl FilesR {
    pub fn from_page(items: Vec<AssetR>, count: u64, page: u32, size: u32) -> Self {
        let page_data = crate::interceptors::envelope::Paginated::new(items, count, page, size);
        Self {
            items: page_data.items,
            count: page_data.count,
            page: page_data.page,
            size: page_data.size,
            total: page_data.total,
            next: page_data.next,
            prev: page_data.prev,
        }
    }
}

/// 解析 viewers JSON（uuid 数组）；非法/缺失视为空
pub fn viewers_from_json(value: &Option<sea_orm::prelude::Json>) -> Vec<Uuid> {
    let Some(json) = value else {
        return Vec::new();
    };
    serde_json::from_value::<Vec<Uuid>>(json.clone()).unwrap_or_default()
}

pub fn viewers_to_json(ids: &[Uuid]) -> Option<sea_orm::prelude::Json> {
    if ids.is_empty() {
        return None;
    }
    Some(serde_json::to_value(ids).unwrap_or(serde_json::Value::Null))
}
