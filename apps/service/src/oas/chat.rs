use super::common::{ChatChangesEnvelope, ChatSyncEnvelope, Exception};
use crate::services::chat::schema::{ChatSyncP, DEFAULT_LIMIT, MAX_LIMIT};

/// `X-Tenant-ID` 在会话同步域是**必填**请求头：会话按租户隔离，没有「账号级会话」这种落脚点。
/// 缺头直接 400，不降级也不猜默认租户——猜错会把 A 租户的对话写进 B 租户的账里。
fn tenant_header() -> String {
    "目标租户 ID（UUID）。**必填**：会话/消息/用量都按租户隔离，缺了这个头没有正确的作用域可进。\n\
     调用者须为该租户有效成员（平台 ADMIN 可旁路）。"
        .to_string()
}

/// 拉取批次数上限的说明：数字取自契约常量，不在这里再写一遍。
fn limit_description() -> String {
    format!("最多返回几个批次；缺省 {DEFAULT_LIMIT}，最大 {MAX_LIMIT}")
}

#[utoipa::path(
    post,
    path = "/api/v1/chat/sync",
    tag = "Chat",
    operation_id = "chat.pushChanges",
    summary = "推送一批本地改动",
    description = "把客户端攒下的一批会话 / 消息 / 用量改动送到服务端，并占一个同步水位。\n\n\
        **一批一个水位**：本批所有行共用同一个 `revision`，增量拉取按批次整批下发。\n\n\
        **重发即无操作**：`clientBatchID` 是幂等键，网络抖动下重发同一批不会重复落库、\n\
        也不会推高水位，响应里回放的是上次的结果（`revision` 与 `applied` 一致）。\n\
        因此客户端**每个批次标识只能用一次**，重试必须复用同一个标识。\n\n\
        **次序**：同一批里会话必须排在消息之前（消息带会话外键）；跨批也一样——\n\
        引用不存在会话的消息会被整体拒绝（`500702`）。\n\n\
        **冲突只报不改**：`title` / `pinned` 是唯一会被两端各自覆盖的字段。\n\
        若服务端在**更晚**的批次里改过它、且与本次改动不同，这一行不会被写入，\n\
        而是出现在响应的 `conflicts` 里（附服务端那份），由客户端决定谁赢；\n\
        同一批里其余的行照常落库。**删除不可逆**：已删的会话不会被一次改名改活，\n\
        这种情况同样以 `archivedAt` 非空的形式出现在 `conflicts` 里。\n\n\
        **删除是软删**：`deletes` 里的 id 只会被打上墓碑（`archivedAt`），\n\
        行留着是为了让别的设备能拉到「它被删了」。客户端本地级联删除的消息要自己列进 `deletes`。\n\n\
        **空批次不占水位**：既没有行也没有墓碑的批次直接返回当前水位当新基线。\n\n\
        批量上限：行数 500（会话+消息+用量）、墓碑 500、标题 200 字符、\n\
        单条消息 1000000 字符、`clientBatchID` 100 字符。\n\n\
        `body.code`：200000 成功；`200001` 缺少 `X-Tenant-ID`；`200007` `X-Tenant-ID` 格式无效；\n\
        `500701` 批次不合法（超限、id 不合法、批内 id 重复）；\n\
        `500702` 消息引用的会话不存在。",
    security(("bearer_auth" = [])),
    params(("X-Tenant-ID" = String, Header, description = tenant_header())),
    request_body(content = ChatSyncP, description = "这一批要落的改动"),
    responses(
        (status = 200, description = "成功（`applied` 为本批写入行数，`conflicts` 为被挡下的会话改动）", body = ChatSyncEnvelope),
        (status = "default", description = "业务异常（批次不合法 / 会话不存在 / 非租户成员）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn push_changes_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/chat/sync",
    tag = "Chat",
    operation_id = "chat.pullChanges",
    summary = "拉取自某个水位以来的变更",
    description = "按水位升序返回若干**整批**变更，供客户端在别的设备上重建同一份会话。\n\n\
        **游标**：把上次响应的 `revision` 原样作为本次的 `since` 传回来；\n\
        `since=0`（缺省）表示从头拉。响应里的 `revision` 是**本次交付到的水位**，\n\
        没有新批次时原样返回请求里的 `since`。\n\n\
        **窗口按批次切**：`limit` 是批次数上限（缺省 50，最大 200），不是行数上限。\n\
        批次是交付单位，切到半个批次会让游标说不清「我到底拿到了哪一步」；\n\
        还有更多时 `hasMore` 为 true，客户端接着拉即可。\n\n\
        **墓碑随增量下发**：被删的会话 / 消息 id 分别出现在 `deletedSessionIDs` /\n\
        `deletedMessageIDs` 里，客户端据此删本地行（会话被删时本地消息按 `parentID` 级联删）。\n\n\
        **可能重复投递**：同一行在更晚的批次里被改过时，会在那个窗口里再下发一次；\n\
        客户端按 id 覆盖即可（写入是幂等的）。\n\n\
        `body.code`：200000 成功；`200001` 缺少 `X-Tenant-ID`；`200007` `X-Tenant-ID` 格式无效；\n\
        `500703` 游标不合法（`since` 为负 / `limit` 越界）。",
    security(("bearer_auth" = [])),
    params(
        ("X-Tenant-ID" = String, Header, description = tenant_header()),
        ("since" = Option<i64>, Query, description = "起始水位（不含）；缺省 0 = 从头拉"),
        ("limit" = Option<u64>, Query, description = limit_description()),
    ),
    responses(
        (status = 200, description = "成功", body = ChatChangesEnvelope),
        (status = "default", description = "业务异常（游标不合法 / 非租户成员）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn pull_changes_doc() {}
