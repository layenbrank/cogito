# 配置（YAML）

配置来源：[`configures/configure.rs`](../configures/src/configure.rs) · 加载器 [`configures/loader.rs`](../configures/src/loader.rs)

应用配置使用分层 YAML（见 [`config.yaml`](../config.yaml)），**不使用**任何 `.env` 文件。Docker 依赖栈见 [`docker-compose.yml`](../docker-compose.yml)（内置 `name: cogito`）：compose 的三个凭据变量没有默认值，先 `cp .env.example .env` 再 `docker compose up -d`（见 [guide/deployment.md](./deployment.md) §6-§7）。

| 文件                    | 说明                                                           |
| ----------------------- | -------------------------------------------------------------- |
| `config.yaml`           | 基础默认值（入库）                                             |
| `config.{profile}.yaml` | profile 覆盖（如 `development` / `production`）                |
| `config.local.yaml`     | 本机密钥与连接串（**不入库**，见 `config.local.yaml.example`） |

合并顺序：`config.yaml` → `config.{profile}.yaml` → `config.local.yaml`（后者覆盖前者）。

**profile** 用于选择 `config.{profile}.yaml`：

1. shell 环境变量 `APP_ENV` 或 `RUST_ENV`（可选，常用于 CI / 部署）
2. 否则读 `config.yaml` 的 `app.env`
3. 默认 `development`

**运行模式**（是否生产、是否返回 `Exception.details`、OTP mock 等）由合并后的 `app.env` 决定。

## 常用字段

| 路径                                  | 默认值                             | 说明                                                           |
| ------------------------------------- | ---------------------------------- | -------------------------------------------------------------- |
| `server.host`                         | `127.0.0.1`                        | 监听地址                                                       |
| `server.port`                         | `3000`                             | 监听端口                                                       |
| `database.url`                        | 见 `config.yaml`                   | PostgreSQL 连接串                                              |
| `security.jwt_secret`                 | （占位）                           | JWT 签名，至少 32 字符，不允许为空；生产禁用占位值             |
| `security.secret`                     | （占位）                           | 通用共享密钥；生产禁止占位值，任何环境下都不允许为空           |
| `security.encryption`                 | `argon2`                           | `argon2` 或 `aes`（生产禁止 aes 存密码）                       |
| `logging.dir`                         | `logs`                             | 日志目录                                                       |
| `app.swagger`                         | `development: true`                | 是否启用 Swagger UI                                            |
| `auth.captcha.enabled`                | `true`（development 默认 `false`） | `false` 时跳过 `check-data`（仅联调）；生产强制 `true`         |
| `auth.captcha.base_url`               | `http://127.0.0.1:8080`            | go-captcha-service HTTP（仅内网）                              |
| `auth.captcha.api_key`                | （见 `config.yaml`）               | 侧车 `X-API-Key`，生产放 `config.local.yaml`                   |
| `auth.captcha.kind`                   | `slide-default`                    | 默认题型 ID（`get-data` / `check-data`）                       |
| `auth.captcha.timeout_ms`             | `5000`                             | 调用侧车超时                                                   |
| `auth.captcha.ip_rate_limit`          | `30`                               | 每分钟每 IP 取题次数                                           |
| `auth.rate_limit.enabled`             | `true`                             | Auth 路由 HTTP IP 限流（governor）                            |
| `auth.rate_limit.burst_size`          | `20`                               | 突发请求上限                                                   |
| `auth.rate_limit.requests_per_minute` | `30`                               | 每分钟每 IP 补充配额                                           |
| `auth.trust_proxy`                    | `false`                            | 是否信任 `X-Forwarded-For`（反向代理场景）                     |
| `auth.bootstrap_admin.username`       | `''`（development：`admin`）       | 启动种子平台 ADMIN 用户名；与 password 皆非空才启用            |
| `auth.bootstrap_admin.password`       | `''`（development：`admin123456`） | 同上；≥6 字符；生产禁用占位值；可用 `COGITO__AUTH__BOOTSTRAP_ADMIN__*` 覆盖 |
| `auth.bootstrap_admin.sync_password`  | `false`                            | 账号已存在时是否把密码同步成配置值（改密后记得关掉）           |
| `aliyun.access_key_id`                | `''`                               | 出站凭据（短信 / 邮件 / OSS 共用），生产放 `config.local.yaml` |
| `aliyun.access_key_secret`            | `''`                               | 同上；两个都为空表示「本部署不发出站请求」                     |
| `aliyun.signature_version`            | `v3`                               | `v3`（`ACS3-HMAC-SHA256`）或 `v1`（`HMAC-SHA1`，只留给老网关） |
| `aliyun.timeout_ms`                   | `10000`                            | 单次出站调用超时                                               |
| `aliyun.sms.endpoint`                 | `https://dysmsapi.aliyuncs.com`    | 短信（Dysmsapi `SendSms`），必须是裸 origin（不带路径）         |
| `aliyun.sms.sign_name`                | `你的应用`                         | 控制台审核通过的签名（`SignName`）                             |
| `aliyun.sms.template_code`            | `SMS_xxxx`                         | 模板编号（`TemplateCode`），模板变量名必须是 `code`            |
| `aliyun.mail.endpoint`                | `https://dm.aliyuncs.com`          | 邮件（DirectMail `SingleSendMail`），必须是裸 origin           |
| `aliyun.mail.account_name`            | `noreply@example.com`              | 控制台验证过的发信地址（`AccountName`）                        |
| `aliyun.mail.from_alias`              | `你的应用`                         | 发件人显示名（`FromAlias`）                                    |
| `aliyun.mail.address_type`            | `1`                                | `1` 随机账号、`0` 用 `account_name`                            |
| `aliyun.mail.reply_to_address`        | `true`                             | 是否允许回信（`ReplyToAddress`）                               |
| `aliyun.mail.subject`                 | `验证码`                           | 邮件主题                                                       |
| `aliyun.mail.body_template`           | `您的验证码是 {code}…`             | 纯文本正文，**必须**包含 `{code}`（缺了启动即失败）            |
| `aliyun.oss.endpoint`                 | `https://oss-cn-hangzhou.aliyuncs.com` | OSS origin；`bucket` 非空时必填                           |
| `aliyun.oss.bucket`                   | `''`                               | 留空表示本部署不使用对象存储                                   |
| `aliyun.oss.root`                     | `''`                               | bucket 内的逻辑根前缀                                          |
| `aliyun.oss.addressing_style`         | `virtual`                          | `virtual` / `cname` / `path`（自建或本地网关必须 `path`）       |
| `aliyun.oss.presign_endpoint`         | `''`                               | 生成预签名 URL 时改用另一个 origin（如内网写、公网读）         |
| `aliyun.oss.presign_expires_secs`     | `900`                              | 预签名 URL 有效期（秒）                                        |
| `gateway.daily_token_quota`           | `1000000`                          | 全局兜底日 token 配额（无租户身份、团队租户）                  |
| `gateway.free_daily_token_quota`      | `100000`                           | 个人租户免费档日 token 配额（无有效订阅时）                    |
| `gateway.plan_daily_token_quota`      | `BASIC` / `PRO`                    | 订阅档位日配额（`档位名 → 配额`），与 `subscription.plan` 对应 |
| `gateway.upstream_timeout_ms`         | `120000`                           | 上游模型流式读超时                                             |
| `gateway.audit_enabled`               | `true`                             | 审计落库开关                                                   |
| `gateway.service_token_secret`        | `''`                               | 服务身份面共享密钥（HMAC-SHA256）。**留空 = `/api/v1/service/**` 整体 503**；与 `security.jwt_secret` 分开；生产禁用占位值 |
| `gateway.service_token_ttl_secs`      | `300`                              | 换出来的短期令牌有效期（秒），上限 3600                        |
| `pay.order_ttl_secs`                  | `300`                              | 支付订单有效期（秒），超时自动关单                             |
| `pay.plans`                           | `PRO`                              | 可售档位定价（`档位名 → {amount, duration_days, label}`），`amount` 单位为分；档位名须与 `gateway.plan_daily_token_quota` 同名 |
| `pay.wechat.*`                        | `enabled: false`                   | 微信支付凭据（`mch_id` / `app_id` / `api_v3_key` / `serial_no` / `private_key` / `platform_public_key` / `notify_url` / `api_base`） |
| `pay.alipay.*`                        | `enabled: false`                   | 支付宝凭据（`app_id` / `private_key` / `alipay_public_key` / `gateway_url` / `notify_url`） |

### 模型网关配额

日配额按下列优先级取**第一个命中项**；Redis 键 `gateway:quota:{scope}:{id}:{yyyy-mm-dd}`，按 UTC 午夜重置。

| 优先级 | 来源                                            | 适用                                                       |
| ------ | ----------------------------------------------- | ---------------------------------------------------------- |
| 1      | `gateway_model.dailyTokenQuota > 0`             | 单模型覆盖                                                 |
| 2      | 订阅档位 `gateway.plan_daily_token_quota[plan]` | 个人租户（`tenant.type = PERSONAL`）且有**此刻生效**的订阅 |
| 3      | 免费档 `gateway.free_daily_token_quota`         | 个人租户无有效订阅（含订阅已过期）                         |
| 4      | 全局兜底 `gateway.daily_token_quota`            | 团队租户（`TEAM`）与无租户身份（按用户维度计）             |

未知档位名（配置删改后残留的订阅）回落**免费档**，避免超发。订阅的增删改见 [`src/services/subscription/README.md`](../src/services/subscription/README.md)；
查某租户当前生效的配额与来源用 `GET /api/v1/tenants/{id}/quota`（`source` = `PLAN` / `FREE` / `GLOBAL`）。

档位解析结果带 **60s Redis 缓存**（`gateway:plan:{tenantID}`，开通/取消订阅时立即失效），避免聊天热路径每次请求都查库。

完整字段见 [`config.yaml`](../config.yaml)。集成总览见 [`integrations.md`](integrations.md)。

## 支付（微信 / 支付宝）

扫码支付把「定价档位」卖给用户：下单 → 扫码 → 渠道异步回调 → 开通订阅。实现与安全细节见 [`src/services/payment/README.md`](../src/services/payment/README.md)。

- `pay.wechat.enabled` / `pay.alipay.enabled` 默认 `false`，未启用的渠道在 `GET /api/v1/tenants/{id}/pay/catalog` 里不出现在可选渠道中（下单返回 `500405`）。
- `enabled: true` 时启动会强校验必填项与格式（`api_v3_key` 必须 32 字符、微信 `notify_url` 必须 `https://`）：**宁可启动失败，也不要带半截凭据上线**。
- `pay.plans` 的档位名必须能在 `gateway.plan_daily_token_quota` 找到同名项，否则启动失败（付费后拿到的仍是免费档配额）。
- **已定价档位（`amount > 0`）禁止自助开通**：`POST /api/v1/tenants/{id}/subscriptions` 会以 `500408` 拒绝，只能走支付回调开通；`amount <= 0`（未定价）的档位仍允许自助开通，便于联调。平台管理员不受此限制。
- 回调地址必须**公网 HTTPS** 且能被微信/支付宝访问：本机开发用内网穿透或反向代理暴露 `/api/v1/pay/notify/{wechat,alipay}`；收不到回调时用 `POST /api/v1/tenants/{id}/orders/{orderNo}/sync` 主动查单兜底。
- 凭据是敏感值，只写 `config.local.yaml`（或部署平台密钥管理），不要提交入库。

最小可跑配置（`config.local.yaml`）：

```yaml
pay:
  order_ttl_secs: 300
  plans:
    PRO:
      amount: 1990 # 分
      duration_days: 30
      label: 专业版
  wechat:
    enabled: true
    mch_id: '16xxxxxxxx'
    app_id: 'wxxxxxxxxxxxxxxxxx'
    api_v3_key: '32位APIv3密钥'
    serial_no: '商户API证书序列号'
    private_key: |
      -----BEGIN PRIVATE KEY-----
      ...
      -----END PRIVATE KEY-----
    platform_public_key: |
      -----BEGIN PUBLIC KEY-----
      ...
      -----END PUBLIC KEY-----
    notify_url: https://your-domain.com/api/v1/pay/notify/wechat
  alipay:
    enabled: true
    app_id: '20210xxxxxxxxxxxxx'
    private_key: |
      -----BEGIN PRIVATE KEY-----
      ...
      -----END PRIVATE KEY-----
    alipay_public_key: |
      -----BEGIN PUBLIC KEY-----
      ...
      -----END PUBLIC KEY-----
    notify_url: https://your-domain.com/api/v1/pay/notify/alipay
```

## 行为验证码（go-captcha-service）

本地依赖栈包含 **go-captcha** 侧车（[`docker-compose.yml`](../docker-compose.yml) 服务 `gocaptcha`）：

```powershell
docker compose up -d gocaptcha
```

配置目录 [`docker/gocaptcha/`](../docker/gocaptcha/)（`config.json` + `gocaptcha.json`）。侧车使用 compose 内 **Redis** 缓存 `captchaKey` 状态；Rust 服务通过 `auth.captcha.base_url` 代理 `get-data` / `check-data`，**不在本服务 Redis 存答案**。

前端联调使用 [`go-captcha-react`](https://github.com/wenlng/go-captcha-react)（非 hCaptcha SaaS）。流程：

1. `POST /api/v1/auth/captcha` → `captchaKey` + 拼图 Base64
2. 用户完成滑块/点选 → 提交 `captchaKey` + `captchaValue` 到 `signin` / `signup` / `otp`

与 hCaptcha 对比：hCaptcha 为云端 Widget + `siteverify` token；本仓库为自托管 go-captcha 侧车 + 坐标校验。

## 阿里云出站（OTP 短信 / 邮件）

短信与邮件都由 **Rust 服务自己直连**阿里云（无侧车、无容器）：签名与请求形状在
[`crates/aliyun`](../crates/aliyun/)，配置到调用的翻译在 [`src/clients/aliyun.rs`](../src/clients/aliyun.rs)。

- 凭据：`aliyun.access_key_id` / `access_key_secret`（放 `config.local.yaml`，不进版本库）
- 短信：`aliyun.sms.*`（`dysmsapi` 的 `SendSms`，模板变量名必须是 `code`）
- 邮件：`aliyun.mail.*`（`dm` 的 `SingleSendMail`，正文模板必须含 `{code}`）
- 开发期 `auth.otp.mock: true` 时验证码仅写日志；生产 `mock: false` 时按通道调 `SendSms` / `SingleSendMail`
- 集成契约测试（本地 HTTP 桩，不需要真凭据）：`cargo test --test aliyun`

## 事件发布（outbox → 下游）

业务事务把事件写进 `outbox`，**[`worker`](../src/bin/worker.rs) 二进制**（`cargo run --bin worker`）负责投递：

| 字段                       | 默认值  | 说明                                                   |
| -------------------------- | ------- | ------------------------------------------------------ |
| `events.endpoint`          | `""`    | 下游接收端点；留空 = 只记日志（事件照样标记为已发布）   |
| `events.token`             | `""`    | `Authorization: Bearer` 凭据（生产必填）               |
| `events.timeout_ms`        | `5000`  | 单次投递超时                                           |
| `events.poll_interval_ms`  | `500`   | 一轮结束到下一轮开始之间的等待                         |
| `events.batch_size`        | `64`    | 每轮最多读取的待发布事件数                             |
| `events.backoff_base_ms`   | `1000`  | 投递失败聚合的退避基数（指数增长，进程内记忆）         |
| `events.backoff_max_ms`    | `60000` | 退避上限                                               |
| `events.use_system_proxy`  | `false` | 是否让系统/环境变量代理接管投递；默认直连（同 `clients/` 下的内部客户端） |

生产环境 `require_events_endpoint()` 会强制要求 `endpoint` 与 `token`：缺了就是事件静默堆在 `outbox` 里。

## 链路追踪（OTLP/HTTP）

三端（cogito / ai-worker / 前端）用 W3C `traceparent` 串成一条链路，cogito 用 OTLP/HTTP 把 span 推到 collector（本地是 Jaeger）：

| 字段                   | 默认值                              | 说明                                                             |
| ---------------------- | ----------------------------------- | ---------------------------------------------------------------- |
| `telemetry.enabled`    | `false`                             | 关掉时整条链路零开销，只保留 `traceparent` 透传                  |
| `telemetry.endpoint`   | `http://127.0.0.1:4318/v1/traces`   | OTLP/HTTP 端点，**要写全路径**（不像 `OTEL_EXPORTER_OTLP_ENDPOINT` 会自动补 `/v1/traces`） |
| `telemetry.service_name` | `cogito`                 | 资源里的 `service.name`；二进制会加上自身角色后缀（如 `…-api`）  |
| `telemetry.sample_ratio` | `1.0`                             | 采样率（`ParentBased`，上游已采样的链路一定保留）                |
| `telemetry.timeout_ms` | `10000`                             | 单次导出超时                                                     |
| `logging.filter`       | `info`                              | 想让出站/依赖库的 span 也进来，用 `info,opentelemetry=debug` 之类 |

开启方式（本地联调走 `config.local.yaml`）：

```yaml
telemetry:
  enabled: true
  endpoint: http://localhost:4318/v1/traces
```

打开后：入站请求按 `traceparent` 续链（没有就新起一条），`http.request.method` / `url.path` / `http.response.status_code` 按语义约定落属性，5xx 才把 span 标成 `ERROR`；cogito 出站调 `ai-worker` 时把当前链路塞进 `traceparent`，于是 Python 侧的 span 直接挂在同一棵树上。关掉则退回原来的本地生成、纯透传行为。

## 长任务（durable → orchestrator）

跨步骤、跨重启的长流程（文档索引、批量导入、需要重试与补偿的作业）交给 **[`orchestrator`](../src/bin/orchestrator.rs) 二进制**（`cargo run --bin orchestrator`）：

| 字段                                    | 默认值     | 说明                                                                     |
| --------------------------------------- | ---------- | ------------------------------------------------------------------------ |
| `durable.database_url`                  | `""`       | 编排库连接串；留空 = 复用 `database.url`（可以，但没必要另起一个库）      |
| `durable.schema`                        | `durable`  | 编排表所在 schema（provider 自治，**不能**填 `public` 或业务 schema）     |
| `durable.auto_migrate`                  | `true`     | 启动时由 provider 自己建表/迁移；生产若由 DBA 管表可设 `false`            |
| `durable.orchestration_concurrency`     | `2`        | 同时推进的编排轮次数                                                     |
| `durable.worker_concurrency`            | `2`        | 同时执行的活动数（真正干活的并行度）                                     |
| `durable.shutdown_grace_ms`             | `5000`     | 停机时留给在跑活动的收尾时间；超时强制中止（进度不丢，下次接着跑）        |
| `durable.worker_lock_timeout_ms`        | `30000`    | 活动执行者持有租约的时长；**同时决定进程被硬杀后最慢多久恢复**（见下）    |
| `durable.worker_lock_renewal_buffer_ms` | `5000`     | 租约续期的提前量，必须小于 `worker_lock_timeout_ms`                       |

`require_durable_settings()` 只在 orchestrator 启动路径上校验（api / worker 不读 `durable`）：解析出的连接串必须非空且以 `postgres` 开头，schema 必须是合法标识符且不是 `public`。

### 租约（锁）旋钮

活动一被取走就带上租约：执行者**一边跑一边续期**，进程活着就不会丢；进程被硬杀（`kill -9`、
OOM、断电）时没人续期，租约到期后框架把这一步**重新投给活着的进程**。

- 所以 `worker_lock_timeout_ms` 是「崩溃恢复最慢多久」的上限：调小恢复快，但网络抖动/长 GC
  造成的短暂停顿可能被误判成失联，导致同一步被两个进程同时跑（靠活动幂等键兜底）。
- 续期提前量小于锁时长才有意义：锁时长 ≥ 15s 时按 `timeout - buffer` 续期，< 15s 时按
  `timeout / 2` 续期（此时 buffer 不生效）。
- 两个值都必须是正数、buffer 必须小于 timeout，且「`timeout - buffer`」必须小于运行时的会话
  空闲超时（实现本体固定 5 分钟），否则启动直接报配置错误——而不是跑到一半 panic。

## AI 计算车间（ai-worker → orchestrator）

长任务里的 AI 步骤（分块、嵌入、落索引）不在 cogito 里做，而是由 orchestrator 通过内部 HTTP
契约调用 Python 的 **ai-worker**（契约唯一源为 [`spec/internal.yaml`](../spec/internal.yaml)，
由 R11 门禁强制）：

| 字段                              | 默认值                   | 说明                                                       |
| --------------------------------- | ------------------------ | ---------------------------------------------------------- |
| `ai_worker.base_url`              | `""`                     | 内部调用基址，例如 `http://127.0.0.1:8081`                  |
| `ai_worker.token`                 | `""`                     | 内部共享令牌，请求头 `X-Internal-Token`；生产禁用占位值（orchestrator 启动即校验） |
| `ai_worker.timeout_ms`            | `30000`                  | 单次调用超时；**一步 = 一次调用**，超时即失败并交给活动重试 |
| `ai_worker.use_system_proxy`      | `false`                  | 默认直连，别让本机系统代理（如 `127.0.0.1:7892`）拦内网地址 |
| `ai_worker.embed_batch_size`      | `16`                     | 一次嵌入活动处理的块数；越小则崩溃后重跑越省，历史越长      |
| `ai_worker.embed_model`           | `text-embedding-3-small` | 嵌入模型。装配时注入，所以同一实例重放看到的模型恒定        |

`require_ai_worker_settings()` 同样只在 orchestrator 启动路径上校验：地址与令牌必须齐全。
模型由 cogito 决定——出网与计量都以 cogito 的网关为唯一入口，ai-worker 不许自己换模型。

### 资产正文、嵌入与对话算力回打 cogito（服务身份）

ai-worker 是叶子进程，不直连模型厂商、不碰对象存储布局，也不持长期云凭据；它要算力或资产字节时回打 cogito 的
**服务身份面**（契约与语义见 [`src/services/gateway/README.md`](../src/services/gateway/README.md#服务身份apiv1service)）。
每条链路都是「先换令牌、再用令牌」：

1. `POST /api/v1/service/token`，头 `X-Internal-Token`（值 = `ai_worker.token`），
   体 `{scope, tenantID, model?, assetID?, approvalID?, ttlSecs?}`
   → 得到一枚 HS256 短期令牌（`ttlSecs` 收敛到 `1..gateway.service_token_ttl_secs`，硬上限 3600）。
   `scope` 缺省为 `embeddings`（要 `model`）；`scope=chat` 也要 `model`；`scope=asset-read` 要 `assetID`，
   签发前先校验该资产对本租户可读，不可读回 `500204`（404）、未完成上传回 `200003`（400）；
   `scope=asset-write` 要 `approvalID`，签发前回读审批台账，批的不是这个资产 / 批准人不是资产创建者
   一律 `500509`（403）。非法 `scope` 直接 400——宁可拒了也不猜。
2. 用这枚令牌四选一：
   - `POST /api/v1/service/embeddings`（`scope=embeddings` 的令牌），头 `X-Service-Token`，体 `{input, dimensions?, …}`
     → cogito 按令牌作用域解析模型、查配额、出站 `/embeddings`、记账，并把上游裸 JSON 原样返回。
   - `POST /api/v1/service/chat/completions`（`scope=chat` 的令牌），体 `{model, messages, tools?, …}`
     → 同一套配额 / 记账路径，出站 `/chat/completions` 并**强制非流式**。服务端 agent 的每步推理走这里。
   - `GET /api/v1/service/assets/{id}/content`（`scope=asset-read` 的令牌）→ 原始字节流。
     授权来自令牌里的 `assetID`，路径参数只用于比对：不一致 `400004`（403）。内部读不计量、不记账。
   - `PUT /api/v1/service/assets/{id}/visibility`（`scope=asset-write` 的令牌）→ 改资产可见性，
     **不带请求体**（要写的参数在换令牌时就钉进令牌了，见
     [`gateway/README.md`](../src/services/gateway/README.md#写令牌scope--asset-write把人批过的参数当唯一输入)），
     以批准人（= 资产创建者）身份落地，返回该资产的裸 JSON；不计量、不记账。

**受众是硬边界**：`scope` 决定 `aud`，且每个端点只认自己的受众，所以嵌入令牌打不开内容端点或对话端点
（反之亦然），都是 `300002`（401）。`/chunks` 这类出站请求因此**不带对象键**——正文由 ai-worker 自己回打
内容端点取，换存储布局不牵动它。

两条约束值得注意：`gateway.service_token_secret` **只有 cogito 自己用**——它既签发又校验服务令牌，
所以只需要在 cogito 的配置里存在（留空则整个服务面关闭，`100002`/503）。ai-worker 不需要、也不应该拿到它。
两侧共享的密钥是另一把：`ai_worker.token`，cogito 用它比对请求头的 `X-Internal-Token`
（`src/guards/service.rs::verify_internal`），ai-worker 用它换服务令牌。因为它是「能不能烧配额」的开关，
必须通过 `config.local.yaml` / profile 覆盖；
被要求嵌入的模型必须声明 `capabilities.embeddings = true`（后台模型编辑里给），否则 `200003` ——
把「供应商不支持嵌入」这类错误挡在配置期而不是第一次调用。对话面则相反：只有显式声明
`capabilities.tools = false` 的模型会被拒，未声明按支持处理（口径与用户面 `supports_tools` 一致）。

## 服务端 agent（api → orchestrator → ai-worker）

租户级长任务 agent 的默认值由 **api** 读取：起任务时写进编排输入，之后每一步都由编排按输入驱动。

| 字段                    | 默认值                                                 | 说明                                                     |
| ----------------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| `agent.chat_model`      | `deepseek-chat`                                        | 推理用的对话模型（`gateway_model` 目录里的一行）          |
| `agent.max_steps`       | `6`                                                    | 一次任务最多几步「推理 + 工具」                           |
| `agent.approval_ttl_secs` | `1800`                                               | 一次人工审批最多等多久（秒），下限 `60`                   |
| `agent.allowed_tools`   | `["knowledge_search", "asset_read", "memory_recall"]`  | 允许 agent 使用的工具，空数组 = 不给工具                  |

四项都是**上限**：请求体可以往下收（更少轮次、更小的工具集合），不能往上越。所以「这套部署允许
agent 做什么」是部署级的决定，不必去翻每一条请求。

- `chat_model` 必须**支持工具调用**（目录行的 `capabilities.tools` 不为 `false`），否则每步都拿不到工具、
  agent 退化成一次性问答。这里**不在提交路径校验**（读目录表要跨域，且模型可以后补），缺行 / 不支持
  工具会在跑起来时以失败落台账。
- `max_steps` 达到上限时，**最后一步不再给工具**：模型必须先给一条结论，而不是下一步撞止损。
  没给结论也照样收尾（结果里标 `finished: false`），不会无限转下去。
- 工具名走**下划线**命名（`knowledge_search`），不能像能力名那样带点号——那是模型接口的名字规则，
  `validate()` 在启动时就拦。
- `approval_ttl_secs` 只对**需要审批的写工具**有效（`memory_write` / `asset_visibility_write`）：到点没人处理就作废这次调用，
  工具不执行，任务继续。它必须**明显小于等待者的预算**（`services::agent::dispatch` 的 3600s），
  否则任务会先被判失败，人在批准时实例已经没人接了——这个下限由 `cogito` 侧的测试钉住；
  启动时另有 `60s` 的硬下限（比这更短，人根本来不及看到待办，等于没开审批）。
- 写工具**都不在默认 `allowed_tools` 里**。`memory_write` 的理由是「它写下的记忆会被之后的任务召回，
  投毒一次就持续影响后续任务」；`asset_visibility_write` 的理由更直接——它改的是 cogito 的**业务数据**
  （资产可见性，等于改谁能看到这个文件）。开启它等于同时开了「人工审批」这条路径——每次调用都要人批。
- `asset_visibility_write` 的执行路径与 `memory_write` 不同：批准之后**不由编排动手**，而是
  ai-worker 拿 `approvalID` 回打 cogito 换一枚 `scope=asset-write` 的短期写令牌（cogito 签发时回读审批台账，
  批的不是这个资产 / 批准人不是资产创建者一律 `500509`），再用令牌调
  `PUT /api/v1/service/assets/{id}/visibility`——**不带请求体**，参数在签发时就钉进令牌了。
  写以**批准人**（= 资产创建者）身份落地，因为 `asset` 的行级策略只认创建者。
- 起任务与查进度两个端点见 [`src/services/agent/README.md`](../src/services/agent/README.md)；
  任务台账是 `agent_task`（本域唯一拥有的表），token 用量的唯一落点仍是网关。

### 长期记忆与投毒面

结论摘要（每次任务收尾写一条）由**编排自己**写，不受 `allowed_tools` 影响。除此之外只有
`memory_recall` / `memory_write` 两个工具碰记忆：

- `memory_recall` 是只读，默认**开**——读别人的经验不改任何状态。
- `memory_write` 让**模型自己**往记忆里写，默认**关**，要显式加进 `allowed_tools` 才生效。
  理由：记忆是同租户共享的知识，写坏一次会被**之后的任务**当成既有事实反复召回（投毒面像滚雪球），
  代价远大于「让模型多记一条笔记」的收益。
- 想只关掉模型写、保留收尾摘要，就从 `allowed_tools` 里去掉 `memory_write`（它本来就不在默认里）；
  想连收尾摘要一起关，得改编排（没有配置开关）。

记忆表 `agent_memory` 归 ai-worker（与检索数据同库，见计划的 D8）。它与 `rag_*` 表有一个关键差别：
**记忆不能从源重建**，误删就是真丢，需要纳入数据库备份范围。

## 本地覆盖

```powershell
Copy-Item config.local.yaml.example config.local.yaml
# 编辑 database.url、security.* 等
```

## 数据库迁移

```bash
cargo run -p migration -- up
cargo run -p migration -- status
```

迁移二进制会从 YAML 读取 `database.url` 并设置 `DATABASE_URL`（若环境中未显式设置）。`bun run migrate:fresh` 同理。

应用启动时会调用 `Migrator::up`，一般不必单独跑 CLI。

## Docker 本地依赖

```powershell
Copy-Item .env.example .env      # compose 的三个凭据变量是必填的
docker compose up -d
docker compose ps
```

| 服务     | 端口 | 数据目录（绑定挂载）                                                         |
| -------- | ---- | ---------------------------------------------------------------------------- |
| postgres | 5432 | [`data/postgres`](../data/postgres)；镜像 `docker/postgres`（`zh_CN.UTF-8`） |

locale 只在**首次** initdb 写入。若已是 `en_US`，需：

```powershell
docker compose stop postgres
Remove-Item -Recurse -Force .\data\postgres
docker compose build postgres
docker compose up -d postgres
```

| redis | 6379 | [`data/redis`](../data/redis) |
| gocaptcha | 8080 | 行为验证码侧车（`wenlng/go-captcha-service:1.0.5`，内嵌 [go-captcha v2.0.5](https://github.com/wenlng/go-captcha/releases/tag/v2.0.5)；Docker Hub 无 `latest`） |

配置见 [`docker-compose.yml`](../docker-compose.yml)。`data/` 已 gitignore。

## 脚本

`scripts/utils/config.ts` 与 Rust 使用相同合并规则，供 `bun run upload` 等读取 `server.host` / `server.port`。

## 生产部署

1. 设置 `APP_ENV=production`（或 `config.production.yaml` + `app.env: production`）
2. 通过 `config.local.yaml` 或部署平台注入 `security.*`、`database.url`；
   四把共享密钥/密码都不许用模板里的占位值（`change-me-*`、`your-` 前缀等）：
   `security.secret` / `security.jwt_secret` 为空或仍是占位值会被 `validate()` 拒绝启动，
   `gateway.service_token_secret`（`validate()`）与 `ai_worker.token`（`orchestrator` 启动）同理
3. 生产环境 `auth.otp.mock` 自动为 `false`
