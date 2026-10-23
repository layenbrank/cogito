use super::common::{Exception, IndexTaskEnvelope};
use crate::services::rag::schema::IndexTaskP;

/// `X-Tenant-ID` 在 rag 域是**必填**请求头：索引的资产按租户隔离，没有「账号级索引」这种落脚点。
/// 缺头直接 400，不降级也不猜默认租户——猜错会把 A 租户的文档索引到 B 租户的检索面里。
fn tenant_header() -> String {
    "目标租户 ID（UUID）。**必填**：被索引的资产按租户隔离，缺了这个头没有正确的作用域可进。\n\
     调用者须为该租户有效成员，且需要该资产的可读权限（平台 ADMIN 可旁路）。"
        .to_string()
}

#[utoipa::path(
    post,
    path = "/api/v1/rag/index-tasks",
    tag = "RAG",
    operation_id = "rag.createIndexTask",
    summary = "给一份资产建索引",
    description = "把一份已上传完成的资产切块、算嵌入、写入向量索引，供后续检索使用。\n\n\
        **立刻返回**：响应里的任务通常还是 `RUNNING`，进度与结果用查询接口取。一份文档的索引要跑\n\
        抽取、分批嵌入、落索引，同步等待会把一个 HTTP 请求拖成分钟级。\n\n\
        **同一资产同时只允许一个在跑的任务**：重复调用会拿到 `500604` 并附带已有任务 ID，\n\
        直接去查那个任务即可，不要重试起新的。\n\n\
        资产必须是 `COMPLETED` 且未归档：在途、失败或已删除的资产在下游取不到内容，\n\
        这里会提前拒绝（`500602` / `500603`），不会留下一条注定失败的任务记录。\n\n\
        嵌入用的模型与批大小由部署配置决定（`compute.embed_model` / `compute.embed_batch_size`），\n\
        向量维度取自嵌入服务的实际返回，调用方都**不能指定**。\n\n\
        切片与嵌入都由 compute 完成，模型调用走 cogito 网关，所以**配额、用量与审计自动生效**。\n\n\
        索引是派生数据：重跑同一资产是安全操作（旧索引被覆盖），不需要先删除。\n\n\
        需 JWT 且 `X-Tenant-ID` 指向的租户内有效成员，并具备该资产的写权限。\n\n\
        `body.code`：200000 成功；`200001` 缺少 `X-Tenant-ID`；`200007` `X-Tenant-ID` 格式无效；\n\
        `500602` 资产不存在、不属于该租户或已归档；`500603` 资产尚未完成上传；\n\
        `500604` 该资产已有正在运行的索引任务；`500605` 编排运行时未接通或实例启动失败\n\
        （台账那一行会被落成失败，可直接重试）。",
    security(("bearer_auth" = [])),
    params(("X-Tenant-ID" = String, Header, description = tenant_header())),
    request_body(content = IndexTaskP, description = "要索引的资产"),
    responses(
        (status = 200, description = "成功（任务已受理，通常仍在 RUNNING）", body = IndexTaskEnvelope),
        (status = "default", description = "业务异常（资产不可索引 / 已有任务在跑 / 非租户成员 / 编排不可用）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn create_index_task_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/rag/index-tasks/{id}",
    tag = "RAG",
    operation_id = "rag.readIndexTask",
    summary = "查询索引任务",
    description = "返回索引任务台账：状态、编排自报的当前进度、结果与失败原因。\n\n\
        **台账是权威记录**：任务已经结束时不再去问编排，实例存不存在都不影响「这个任务结束了」。\n\
        还在跑时会顺带问一次编排的当前进度（`progress`，形如 `chunked:48` / `embedded:32` / `indexed`），\n\
        问不到不影响返回；编排运行时没接通时也照样返回台账原样。\n\n\
        成功结束时 `result` 是索引结果（区块集 ID、块数、批次数、维度、集合名），\n\
        可以拿 `chunkSetID` 去 compute 的检索面查这份资产的内容。\n\n\
        有一处刻意的延迟：台账显示 `RUNNING` 但编排里查不到该实例时，5 分钟内仍按 `RUNNING` 返回，\n\
        超过才判定失败。原因是「刚起、还没被运行时领走」与「实例真丢了」在编排侧长得一样，只有行龄能区分。\n\n\
        需 JWT 且 `X-Tenant-ID` 指向的租户内有效成员，并具备该资产的读权限。\n\n\
        `body.code`：200000 成功；`200001` 缺少 `X-Tenant-ID`；`200007` `X-Tenant-ID` 格式无效；\n\
        `500601` 索引任务不存在、不属于该租户，或 id 不是 UUID（三种情况合并，避免用 id 探测别的租户）。",
    security(("bearer_auth" = [])),
    params(
        ("X-Tenant-ID" = String, Header, description = tenant_header()),
        ("id" = String, Path, description = "索引任务 ID（UUID）"),
    ),
    responses(
        (status = 200, description = "成功", body = IndexTaskEnvelope),
        (status = "default", description = "业务异常（任务不存在 / 非租户成员）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn read_index_task_doc() {}
