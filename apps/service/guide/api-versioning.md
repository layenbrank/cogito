# 接口版本与兼容策略

本文件是 cogito 服务对外契约的版本总纲，与 `spec/openapi.json`（OpenAPI 3.1，由 `cargo run --bin docs` 生成）配套阅读。
契约是**单一源**：任何手写路由、手写响应形状都不被承认，必须经 `utoipa` 生成并过 CI 漂移门禁。

## 1. 版本在哪里

| 位置 | 含义 |
|------|------|
| URL 主版本 `/api/v1/...` | **兼容性边界**。破坏性变更只能通过新增 `/api/v2` 落地 |
| `info.version` | 服务构建版本，直接取 `CARGO_PKG_VERSION`（`apps/service/Cargo.toml`），随发布递增 |
| `code`（响应体业务码） | 错误语义的稳定标识。**只增不改**：已发布码位的含义永不重新定义 |
| `traceparent` / 响应 `traceID` | 跨进程追踪约定，不属于版本范围，任何版本都必须支持 |

`/api/health`、`/api/live`、`/api/ready` 是运维探针，不带版本号，其响应结构同样受本节规则约束
（三者语义与关键依赖判定见 [`deployment.md`](deployment.md)）。

## 2. 主版本内允许的变更（向后兼容）

- 新增端点、可选请求字段、可选请求头、响应字段
- 新增错误码码位、新增枚举值（客户端必须容忍未知枚举值）
- 放开既有校验（例如把必填改为可选）
- 性能、日志、内部实现调整

## 3. 必须升主版本的变更

- 删除或重命名端点、请求字段、响应字段
- 修改字段类型 / 语义 / 单位，或把可选改必填
- 修改既有错误码的 HTTP 状态或语义
- 改变鉴权要求（例如从匿名改为需 JWT）

## 4. 下线流程（同一主版本内）

1. 端点标记 `deprecated = true`（生成物中即 `deprecated: true`），保留 ≥ 1 个发布周期
2. 响应增加 `Deprecation` / `Sunset` 头说明时间点（新增响应头属兼容变更）
3. 新旧行为并存期结束、调用方清零后，才在下一个主版本中删除

## 5. 响应形状（全端点统一）

- 成功：HTTP 2xx（`200` 为主）+ 统一信封 `{ code, success, msg, data, timestamp, traceID }`，`code = 200000`
- 失败：HTTP 状态码由 `code` 段位推导（400 参数、401 未认证、403 无权限、404 不存在、409 冲突、413 过大、415 媒体类型、422 语义、429 限流、500 内部、502 上游），响应体为 `ErrorEnvelope`
- 契约中每个操作都有且只有一个 2xx（重定向端点则为 3xx）与一个 `default` 错误响应；例外是渠道回调端点，必须在契约里显式标注 `x-response-shape: vendor`（微信/支付宝要求渠道自有回执），并由 `apps/service/tests/oas_consistency.rs` 强制校验

详见 [error-codes.md](error-codes.md) 与 [architecture-cross-cutting.md](architecture-cross-cutting.md)。
