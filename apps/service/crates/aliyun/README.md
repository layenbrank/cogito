# aliyun · 阿里云出站

阿里云出站能力的**实现层**：短信（Dysmsapi）、邮件（DirectMail）、对象存储（OSS），
以及三者共用的 RPC 签名与传输（V3 `ACS3-HMAC-SHA256` 与 V1 `HMAC-SHA1`）。

它取代了原来的 Go 边车 `sidecars/aliyun-gateway`（那是一个自带配置、自带 API key 的独立进程：
进程内多了一层网络跳转、多一份配置源、多一个部署单元，也把「签名」这类不该出错的逻辑放在了
只有一条真实实现的语言里）。现在这三件事是**同进程内的库调用**。

本 crate 是**实现**，不是端口：`crates/notify` 描述「通知该怎么发」（端口），本 crate 描述
「用阿里云怎么发」（一种实现）。模板、默认值、租户隔离、失败归类、重试与禁用开关等业务策略
在 `service/src/clients/aliyun.rs`，不在这里。

## 数据所有权

| 对象 | 说明 |
| --- | --- |
| 无 | 本 crate **没有任何表、没有 schema、没有迁移**，不参与业务迁移世代，也不读写 `entity`/`migration` 管理的表。 |

- **不持有业务状态**：唯一的进程内状态是凭据与连接池（`RpcClient` / `OssClient` 各自持有），
  构造时注入、不读全局配置、不落盘。
- **OSS 里的对象不属于本 crate**：bucket/root 前缀与对象命名由调用方（存储策略）决定，本 crate
  只按传入的 key 读写。生命周期、可见性、清理策略都不在这里。
- **不做租户过滤**：短信/邮件的收件人由调用方给定，本 crate 不读 `tenantID`、不查库。
- **日志与追踪**：不打印密钥与 `security_token`；`Credentials` 的密钥访问器只对 crate 内部开放
  （`pub(crate)`），`Debug` 输出里也不含密钥明文。

## 对外接口

| 端口 | 用途 |
| --- | --- |
| `Credentials` | `access_key_id` / `access_key_secret` + 可选 `security_token`（STS 临时凭据）。`is_configured()` 要求两项都非空：只填一项是配置事故，不当作「未配置」静默放过。 |
| `SignatureVersion` | `V3`（默认，官方现行推荐）/ `V1`（老网关、专有云）。`parse` 大小写不敏感。 |
| `RpcClient` | `call(&RpcRequest)`：补公共参数、签名、`POST`、解析 JSON。缺凭据时**构造即失败**，不会等到第一次发信。 |
| `RpcRequest` | `endpoint` + `action` + `version` + `ParamPlacement` + 业务参数。`ParamPlacement` 照抄 API 元数据的 `in` 字段（query / formData）。 |
| `SmsClient` | `send(endpoint, &SmsMessage)` → `SmsReceipt { biz_id, request_id }`。`SmsMessage::new(phone, sign_name, template_code)` + `with_param(k, v)`。 |
| `MailClient` | `send(endpoint, &MailMessage)` → `MailReceipt { env_id, request_id }`。`MailMessage` 有 `text_body` / `html_body`（至少一个）、`from_alias`、`address_type`、`reply_to_address`。 |
| `OssClient` | `new(OssSettings, Credentials)` + `put` / `get` / `delete` / `presign_read` / `presign_write`（后两者返回可直接交给前端的完整 URL）。 |
| `OssSettings` | `endpoint` / `bucket` / `root` / `addressing_style` / `presign_endpoint`，链式构造。 |
| 错误类型 | `RpcError`（`Timeout` / `Transport` / `Service { status, code, message, request_id }` / `Decode`）、`SmsError`（含 `RateLimited` 与 `is_rate_limited()`）、`MailError`、`OssError`（`NotFound` 单独一类，调用方可据此返回 404 而不是 5xx）。 |

## 签名与协议

- **算法有官方向量兜底**：`signature.rs` 的单测里放着两份官方示例的**全部中间量**（规范化查询串、
  `StringToSign`、`CanonicalRequest`、`HashedCanonicalRequest`、最终签名），先后用独立脚本复算过。
  改签名代码必须让这两组向量继续通过——这是本 crate 唯一不能靠「看起来对」的地方。
- **V3 头集合**：`host` + `x-acs-action` + `x-acs-version` + `x-acs-date` + `x-acs-signature-nonce` +
  `x-acs-content-sha256`（+ STS 的 `x-acs-security-token`，form 落位时再加 `content-type`）。
  `host` 只参与签名、不手动发送（由 HTTP 客户端按 URL 决定，避免重复 Host 头）。
- **一律 POST**：V1 的公共参数固定留在 query，业务参数按 `ParamPlacement` 决定进 query 还是 form body。
- **成功与失败都看 `Code`**：阿里云 RPC 风格接口失败时可能返回 4xx 信封，也可能返回 HTTP 200 带
  `Code`。短信两条路径都判，限流码（`isv.BUSINESS_LIMIT_CONTROL` 等）**大小写不敏感**比较——
  旧 Go 实现用 `ToUpper(code)` 去比混合大小写字面量，永远不会命中，限流会被错归成 502。
- **OSS 不自己签名**：走 `opendal` 的 OSS 服务（内部用 `reqsign-aliyun-oss`），本 crate 只做
  settings 形状校验、key 规范化与错误分流。`addressing_style` 默认 `virtual`；本地 MinIO / 自建
  网关这类没有通配子域的环境必须显式配 `path`，否则域名解析会失败。

## 边界约束

- 不依赖 `cogito`、不依赖任何 Web 框架（R1 已禁止），也不依赖其他能力 crate。
- 不读配置：endpoint、凭据、模板、默认值全部由调用方注入（`Configure` → `service/src/clients/aliyun.rs`）。
  这样同一个 crate 在 api / worker / orchestrator 三种进程里行为一致，测试里换成本地桩也不需要改环境变量。
- 不做策略：不禁用、不重试、不降级、不统计——调用方决定「发不出去时业务怎么办」。
- 不管模板合规：短信模板与签名、发信地址都必须在阿里云控制台先备案，本 crate 收到的就是已备案的标识。

## 迁移状态

- 已落地（P5）：本 crate 与 `service/src/clients/aliyun.rs` 策略层；删除 `sidecars/aliyun-gateway`、
  `docker/aliyun-gateway`、docker-compose 里的该服务与相关 `.gitignore` 条目（`scripts/capabilities.ts`
  的 `absorbs` 字段把「这些路径不应再存在」变成门禁 R6）。
- **行为变更**：邮件验证码从「邮箱分支只记 warn + `SendFailed`」变为真实可发；短信限流现在正确
  归类为 `RateLimited`（调用方映射为 HTTP 429），旧实现会落到 502。
- 待接入：OSS 目前只有原语与集成测试，没有业务调用方——文件存储改造（头像/附件从本地磁盘搬到
  对象存储）在后续阶段落地，届时由调用方决定 key 约定与可见性。
- 风险对冲：`opendal` 0.59 是围绕 `opendal-core` 重排过 API 的版本（`Operator::new` 不再有
  `finish()`），升级时只需要看 `oss.rs` 一个文件；签名部分是自研的，不随依赖变动。
