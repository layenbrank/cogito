# Gateway

路由前缀：`/api/v1/gateway`

## 概述

OpenAI 兼容的**模型网关**：转发对话补全请求到上游供应商，并负责**日 token 配额**、**用量记录**与**审计**。

| 能力               | 说明                                                                   |
| ------------------ | ---------------------------------------------------------------------- |
| 对话转发           | `POST /chat/completions`，`stream: true` 时 SSE 直传，否则返回原始 JSON |
| 嵌入转发           | 服务面 `POST /service/embeddings`，模型由令牌作用域决定，不走用户鉴权   |
| 对话转发（服务面） | 服务面 `POST /service/chat/completions`，与用户面同一套转发与记账，一律非流式 |
| 可用模型           | 按平台角色 / 租户角色过滤后返回                                        |
| 自动路由    | 目录内置 `auto`：请求 `model=auto` 时按「租户内优先、支持工具优先」挑一条 |
| 供应商管理  | 上游 base_url 与（加密）API Key 的 CRUD                                 |
| 模型管理    | 模型 ↔ 供应商绑定、允许角色、能力声明、上下文窗口、单模型配额覆盖       |
| 配额        | Redis 日窗计数，按 UTC 午夜重置；`GET /quota/me` 自助只读查询 |
| 档位目录    | `GET /plans` 下发可开通档位与免费档基线（源自配置，不落库）      |
| 用量 / 审计 | 落库 Postgres：用量 `gateway_usage`、审计 `gateway_audit` |

## 与同域其他模块的区别

- [`tenant`](../tenant/README.md)：提供租户身份与角色；本模块据此决定配额来源与可见模型。
- [`subscription`](../subscription/README.md)：提供「此刻生效的档位」，本模块查配置得到档位配额。

## 路由一览

用户面：

| 方法 | 路径                               | 鉴权 | 说明                          |
| ---- | ---------------------------------- | ---- | ----------------------------- |
| POST | `/api/v1/gateway/chat/completions` | JWT  | OpenAI 兼容转发（SSE / JSON） |
| GET  | `/api/v1/gateway/models`           | JWT  | 当前身份可用的模型            |
| GET  | `/api/v1/gateway/quota/me`         | JWT  | 自助配额（只读，含今日已用）  |
| GET  | `/api/v1/gateway/plans`            | JWT  | 档位目录（可开通档位 + 免费档）|

后台（平台 ADMIN）：

| 方法         | 路径                                | 说明              |
| ------------ | ----------------------------------- | ----------------- |
| GET / POST   | `/api/v1/gateway/providers`         | 供应商列表 / 新建 |
| PUT / DELETE | `/api/v1/gateway/providers/{id}`    | 供应商更新 / 删除 |
| GET / POST   | `/api/v1/gateway/admin/models`      | 模型列表 / 新建   |
| PUT / DELETE | `/api/v1/gateway/admin/models/{id}` | 模型更新 / 删除   |
| GET          | `/api/v1/gateway/usage`             | 用量查询（分页）  |
| GET          | `/api/v1/gateway/audit`             | 审计查询（分页）  |
| GET          | `/api/v1/gateway/audit/export`      | 审计导出（文件流）|

租户面（路由挂在 [`tenant`](../tenant/README.md) 的 `/tenants` 前缀下，handler 在本模块）：

| 方法 | 路径                                | 鉴权              | 说明              |
| ---- | ----------------------------------- | ----------------- | ----------------- |
| GET  | `/api/v1/tenants/{id}/audit`        | JWT + OWNER/ADMIN | 本租户审计查询    |
| GET  | `/api/v1/tenants/{id}/audit/export` | JWT + OWNER/ADMIN | 本租户审计导出    |

服务面（受信服务进程，非终端用户）：

| 方法 | 路径                          | 鉴权                | 说明                     |
| ---- | ----------------------------- | ------------------- | ------------------------ |
| POST | `/api/v1/service/token`       | `X-Internal-Token`  | 按 `scope` 换一枚短期令牌（`embeddings` / `asset-read` / `chat` / `asset-write`） |
| POST | `/api/v1/service/embeddings`  | `X-Service-Token`   | 转发嵌入请求（裸 JSON）  |
| POST | `/api/v1/service/chat/completions` | `X-Service-Token` | 转发对话请求（`scope=chat`，一律非流式） |
| GET  | `/api/v1/service/assets/{id}/content` | `X-Service-Token` | 按资产 id 读原始字节（`scope=asset-read`，路由挂在 upload 模块） |
| PUT  | `/api/v1/service/assets/{id}/visibility` | `X-Service-Token` | 按审批单改资产可见性（`scope=asset-write`，无请求体，路由挂在 upload 模块） |

## 目录契约（`GET /models` 与 `GET /admin/models`）

两个接口返回同一组字段，客户端**只按目录渲染**，不写死任何模型名：

| 字段            | 说明                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `name`          | 请求 `model` 字段要用的值（上游约定的名字）                                                       |
| `label`         | 界面上显示的名字                                                                                 |
| `capabilities`  | `{ tools?, reasoning?, vision?, embeddings? }`（白名单外的键后台写入即 `200003`），客户端据此决定是否挂工具、要不要显示推理/图片入口；未声明时客户端按「工具可用、推理与视觉未知」兜底 |
| `contextWindow` | 上下文窗口（token）；未声明则不下发                                                               |
| `providerName`  | 上游供应商展示名。用户面也下发 —— 普通用户读不到 `/providers`（ADMIN），无法自己把 `providerID` 解析成名字 |

三个可选字段都用 `skip_serializing_if = "Option::is_none"` 收尾：客户端契约是「可缺省」，不是 `null`。

### 自动路由（`auto`）

用户面目录的**首项固定是 `auto`**（`label = 自动选择`，`id` / `providerID` 为空串，时间戳为 0）：
它不是一条数据库记录，而是网关承诺的一个入口，所以：

- `POST /chat/completions` 传 `model = "auto"`（大小写不敏感）时走 `pick_auto_model`：
  平台或租户内 `enabled` → `role_allowed` 过滤 → 排序取首个，排序键依次为
  `tenantID.is_some()`（租户内优先）、`!supports_tools`（支持工具优先）、`created_at`、`name`；无候选回 `400001 模型不存在`。
- `capabilities.tools` 缺省视为**支持工具**（与客户端 opt-out 口径一致），所以自动路由不会因为模型没声明能力就把它排除掉。
- 命中后按普通模型走完整解析链路（配额、用量、审计都记在**被选中的那条模型**上），并把实际用的模型名写回响应里的 `model`。
- `auto` 是保留名：后台 `POST /admin/models` 建同名模型回 `200003`（`auto 为网关保留的自动路由模型名`）。
- `PUT /admin/models/{id}` 的 `capabilities`：给了就整体覆盖（**空对象 `{}` = 清空该列**）；`contextWindow ≤ 0` 也等于清空。
  非对象或非布尔的 `capabilities` 值回 `200003`（如 `capabilities.tools 必须是布尔值`）。

## 鉴权说明与作用域

每个 handler 的第一件事是**进入作用域**（详见 [guide/architecture-cross-cutting.md](../../../guide/architecture-cross-cutting.md)）：
领域函数只收作用域对象，拿不到「裸连接」，可见行由数据库行级策略兜底（见 [guide/database.md](../../../guide/database.md)）。

| 面     | 鉴权                       | 进入的作用域                                            | 可见行                                        |
| ------ | -------------------------- | ------------------------------------------------------- | --------------------------------------------- |
| 用户面 | `Auth::isRequired()`       | 带 `X-Tenant-ID` → `TenantCtx`；否则 `AccountScope`     | 本租户私有行 + 全局行（无租户时只有全局行）   |
| 运维面 | `Auth::admin()`            | `PlatformScope`（特权角色，`BYPASSRLS`）                | 全局行与**所有**租户的行                      |
| 服务面 | `X-Internal-Token` / `X-Service-Token` | 按令牌作用域开短事务（`TenantScope::open`），出站前结束 | 令牌租户的私有行 + 全局行                     |

- `X-Tenant-ID` 不再是「盲信通行证」而是**选择器**：带了就必须是该租户的成员（或平台管理员），否则 403；
  不带则落在账号作用域。用户面四个接口口径一致（目录、聊天、自助配额、档位）。
- 运维面写入只写全局目录行（`tenantID IS NULL`）；改 / 删租户私有行一律 `400001`（不存在），
  不会「静默成功却一行没动」。
- 用户面额外校验模型 `allowRoles` 与租户角色（`role_allowed`）；同名模型下租户私有行优先于全局行。

## 服务身份（`/api/v1/service/*`）

AI 计算车间（[`guide/configuration.md`](../../../guide/configuration.md#ai-计算车间compute--orchestrator) 的
compute）需要三样东西：**资产正文**（它要自己抽取分块）、**嵌入算力**，以及**对话算力**（服务端 agent
的单步推理）。这些都不能让它直连：正文读的是 cogito 的对象存储布局，嵌入与对话出的是 cogito 的配额账。
所以它回打 cogito 的服务身份面：先用内部共享令牌换一枚**带作用域的短期令牌**，再用它去取字节、
转发嵌入或转发对话。

```
compute ──X-Internal-Token──▶ POST /api/v1/service/token {scope, tenantID, model|assetID|approvalID} ──▶ {token, expiresAt}
          ──X-Service-Token ──▶ POST /api/v1/service/embeddings {input, …}             ──▶ 上游裸 JSON
          ──X-Service-Token ──▶ POST /api/v1/service/chat/completions {messages, …}    ──▶ 上游裸 JSON
          ──X-Service-Token ──▶ GET  /api/v1/service/assets/{id}/content               ──▶ 原始字节流
          ──X-Service-Token ──▶ PUT  /api/v1/service/assets/{id}/visibility（无请求体）──▶ 资产行
```

| 端点                 | 请求头              | 语义                                                                     |
| -------------------- | ------------------- | ------------------------------------------------------------------------ |
| `POST /service/token`| `X-Internal-Token`  | 按 `scope` 校验（租户存在 + 模型已声明所需能力 / 资产可读 / 审批单可写）后签发 HS256 令牌 |
| `POST /service/embeddings` | `X-Service-Token` | 按令牌作用域解析模型与配额 → 出站 `/embeddings` → 记账 → **原样返回上游 JSON** |
| `POST /service/chat/completions` | `X-Service-Token` | 按令牌作用域解析模型与配额 → 出站 `/chat/completions`（强制非流式）→ 记账 → **原样返回上游 JSON** |
| `GET /service/assets/{id}/content` | `X-Service-Token` | 按令牌作用域取 `assetID` 的原始字节（流式拼 CAS 分片），不计量、不记账 |
| `PUT /service/assets/{id}/visibility` | `X-Service-Token` | 按令牌里钉住的审批参数改可见性，以**批准人**身份落地；不计量、不记账 |

- **一件受众一件事**：`scope` 决定受众（`embeddings` → `core.service.gateway.embeddings`，
  `chat` → `core.service.gateway.chat`，`asset-read` → `core.service.asset.content`，
  `asset-write` → `core.service.asset.visibility`），受众在端点里写死。
  拿嵌入令牌打对话端点、或反过来，都是 `300002`（HTTP 401）——「越权」不是一处需要记得写的判断，
  而是签名载荷里就没有那个受众。
  不写 `scope` 即默认 `embeddings`（老调用方不用改），非法值直接 `200003`（宁可拒了也不猜）。
- **令牌不是共享密钥的替代品，而是它的收窄**：共享密钥是长期凭据，落到编排历史或子进程日志里就一直有效；
  短期令牌把窗口压到分钟级，并且**自带作用域**（租户 + 模型，或租户 + 单个资产）。请求体里的 `model` 与令牌不一致
  直接 `200003`，换不了别的租户也换不了别的模型 / 别的资产（`model` 只用于告诉上游要哪个模型，由令牌覆盖）。
- `gateway.service_token_secret` 留空 = 整个服务面**整体关闭**（`100002`，HTTP 503，且先于读请求头判断），
  没配密钥的部署不会留下一条「谁都能用来烧配额」的裸口子。密钥与 `security.jwt_secret` **必须分开**。
- `ttlSecs` 由调用方给，服务端收敛到 `[1, gateway.service_token_ttl_secs]` 且硬上限 3600；主体固定为
  `compute`，所以别的用途的 HS256 令牌拿不进来。
- 两道头**不可互换**：内部共享令牌只在换令牌时用，服务令牌只在取字节 / 转发时用；换与用都在 cogito 内完成，
  所以验签不需要时钟宽限窗口（`leeway = 0`）。
- 对话面与嵌入面**口径不同，是故意的**：嵌入必须显式声明 `capabilities.embeddings`（未声明=不支持，与
  用户面 `supports_embeddings` 同款）；对话只有显式写了 `capabilities.tools = false` 才拒（未声明按支持
  处理）。理由是对称门禁等于要求每个部署先把整张模型表的 `tools` 补齐，否则服务端 agent 一上线就全被拒；
  没声明 `tools` 的模型上游到底能不能收 `tools`，只能靠调用方按目录挑，拒了比猜错更糟。
- 内容端点上**授权来自令牌，路径参数只用于比对**：`assetID` 与作用域不一致返回 `400004`（HTTP 403），
  所以拿 A 的令牌换不出 B 的字节；是否存在由行级策略判定，别的租户的行等同不存在（`500204`，HTTP 404，
  不暴露存在性），本租户尚未完成上传的资产返回 `200003`。签发时就用同一段判定校验资产，避免「签得出来
  却读不到」的口径漂移。
- 计量与用户面**同一套**：同一个 `resolve_quota` + 同一把 `gateway:quota:tenant:{id}:{yyyy-mm-dd}` 键，
  用量行记在令牌租户上（`userID` 为全零 UUID，表示「服务身份」），`audit_enabled` 时另记一条
  `action = gateway.embeddings`（对话面为 `gateway.chat`）审计。**失败不记账**：上游非 2xx 回 `600005`，
  不扣配额也不写用量。内容读取是内部读，不进配额也不写用量。
- 响应是**裸 JSON**（OpenAI 形状），不套 `code/success/data` 信封 —— 上游契约就是最终契约，
  调用方按 OpenAI 客户端解析即可；错误仍是统一信封（`code/msg/timestamp`）。
- 模型必须声明 `capabilities.embeddings = true`，否则 `200003` —— 不是所有上游供应商都有 `/embeddings`，
  凭模型名猜会变成运行期 404 而不是配置期报错。

### 写令牌（`scope = asset-write`）：把「人批过的参数」当唯一输入

服务面上唯一会**改库**的端点（`PUT /service/assets/{id}/visibility`），所以它比别的受众多一道门：
写进去的东西不能由调用方在请求里现编。

- **参数在签发时定稿**：换令牌时带 `approvalID`，cogito 当场回读 `agent_approval` 台账，只有
  「这条审批确实批过、批的就是这个资产、而且是**资产创建者**亲手批的」才签得出令牌。审批原文里的
  `visibility` / `viewers` 解析后钉进令牌载荷，写端点因此**没有请求体**——调用方没有任何可以撒谎的地方。
- **写以批准人身份落地**：资产的行级策略里 `WITH CHECK` 只认 `creator`，所以「审批人必须是创建者」
  不是额外加的规矩，而是唯一能写成功的组合（写路径进的是**该用户的**作用域，不是租户作用域）。
- **令牌是能力，不是一次性凭据**：没有回收通道，只能靠短有效期（`ttlSecs`）兜着；同一枚令牌可重放，
  落地结果相同。
- **参数解析不降级**：`assetID` 只认这一种拼法（多一个未知字段即拒）、可见性只认
  `PRIVATE` / `PUBLIC` / `RESTRICTED` 三个字面量、名单必须是用户 id、非 `RESTRICTED` 不得带名单——
  任何一条不成立都不「猜一个接近的意思」，直接拒签。
- **失败只有一个答案**：`500509`（HTTP 403，审批凭据不合规），原因只进日志——跨租户探测
  「这条审批存在吗」不该能从响应里读出来。只有两种例外：请求体少字段回 `200003`（还没轮到查台账），
  资产不存在或读不到回 `500204`（HTTP 404，与读内容同一口径）。

## 配额

日配额按下列优先级取**第一个命中项**，Redis 键 `gateway:quota:{scope}:{id}:{yyyy-mm-dd}`：

| 优先级 | 来源                                                          |
| ------ | ------------------------------------------------------------- |
| 1      | `gateway_model.dailyTokenQuota > 0`（单模型覆盖）             |
| 2      | `gateway.plan_daily_token_quota[plan]`（个人租户 + 生效订阅） |
| 3      | `gateway.free_daily_token_quota`（个人租户无有效订阅）        |
| 4      | `gateway.daily_token_quota`（团队租户 / 无租户身份）          |

作用域：有租户按 `Tenant(id)`，无租户按 `User(id)`。触顶返回 `400006`。

`GET /quota/me` 是上面这套口径的**只读镜像**（同一个 `resolve_quota` + 同一把 Redis 键），
供客户端显示「今日已用 / 剩余 / 重置时刻」，因此不存在「界面数字与服务端拦截不一致」的问题：

- `?model=<name>` 命中该模型的覆盖配额时按模型回答（`source=MODEL`）；缺省或 `auto` 按身份级回答
  —— `auto` 要等网关挑完才知道具体模型，客户端应在选完模型后再查一次。
- 只读接口与聊天/目录共用同一条作用域入口：`X-Tenant-ID` 是选择器而非通行证，不是成员就 403，
  不会把他人租户的档位与用量透出去。
- 计数只读，不写 Redis、不落库、不记审计。

`GET /plans` 的档位只有「名字 + 日配额」两个事实，都出自 `gateway.plan_daily_token_quota`
（不落库、无档位表），按配额升序返回，并附带免费档基线 `freeDailyTokenQuota`：
客户端据此渲染可选档位，而不是让用户手填档位名。档位为空表示平台未开放任何付费档位。

## 审计读取与导出

审计是**事后追溯**入口，所以读侧口径比写侧更严：过滤条件非法一律 `200003`（HTTP 400），
不像用量查询那样宽容解析——「条件写错了却看起来查到了结果」在追溯场景里比多一次报错危险得多。

四个端点（平台与租户面各有「列表 + 导出」）共用一组过滤条件：

| 参数          | 说明                                        |
| ------------- | ------------------------------------------- |
| `tenantID`    | 租户 ID（非法 UUID 不会被静默忽略）         |
| `actor`       | 操作者用户 ID，精确匹配                     |
| `action`      | 动作，精确匹配（如 `gateway.chat`）         |
| `from` / `to` | 闭区间毫秒时间戳；`from > to` 一律 400      |
| `page` / `size` | 仅列表端点；缺省 1 / 50，`size` 上限 200  |

两面的差别只有**可见性从哪来**：

| 端点                                      | 鉴权                                            | 可见行   | `tenantID` 的角色                            |
| ----------------------------------------- | ----------------------------------------------- | -------- | -------------------------------------------- |
| `GET /api/v1/gateway/audit`               | 平台 ADMIN（`PlatformScope`，`BYPASSRLS`）      | 所有租户 | 过滤条件，不是可见性边界                     |
| `GET /api/v1/tenants/{id}/audit`          | 租户 OWNER / ADMIN（`audit_event:read`，MEMBER 无此权限） | 只本租户 | 与路径一致或缺省，不一致即 400 |

- 租户面租户取自**路径**而不是 `X-Tenant-ID`：可见范围不该由请求头决定；路径写明是哪个租户、
  再走一次成员关系判定，读起来没有歧义。用它做跨租户汇总永远拿不到别人的数据——`tenantID`
  与路径不一致直接报错并提示改用平台接口，不会静默换成别的租户。
- 导出端点（`/audit/export`）与对应列表**同一套过滤条件、同一份可见性**，但返回**文件流**而不是 JSON 信封：
  - `format=csv`（缺省）→ `text/csv; charset=utf-8`：UTF-8 BOM + CRLF 行尾 + RFC 4180 字段转义，Excel 直接打开；
  - `format=ndjson` → `application/x-ndjson`：每行一个对象，`createdAt` 为毫秒时间戳，便于 SIEM / 流式消费；
  - 缺省窗口＝**最近 30 天**（`from` / `to` 都不给才补；给了一端只补另一端）；
  - 有硬上限：命中时 `X-Export-Truncated: true`，文件里只保留**最新**的一批，`X-Export-Rows` 给出实际行数。
    只看文件内容无法区分「就这么多」与「被截断了」，所以要先按过滤条件收窄再导出；
  - `Content-Disposition` 的文件名形如 `audit-<from>-<to>.<ext>`，其中时间戳是**实际生效**的窗口，
    消费方不必回看响应头；
  - 窗口内 0 行不是 404：CSV 只输出表头（空结果报错会把「真的没发生」误判成「导出坏了」）。
- 导出读在**只读**作用域里进行，事务归还之后才渲染，几十万行的拼串不会一直占着数据库连接。
- 字段全部由服务端生成（ID、时间、固定动词、上游状态码），因此不做 CSV 公式注入转义，
  理由见 [`render.rs`](render.rs) 模块注释；将来加入自由文本列时需重新评估。

请求样例见 [`http/07-gateway-audit.http`](../../../http/07-gateway-audit.http)。

## 数据表

| 表                 | Entity                                                                      | 说明                                                                                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateway_provider` | [`entity/src/gateway_provider.rs`](../../../entity/src/gateway_provider.rs) | `tenantID`（NULL=平台默认）、`kind / name / baseURL / apiKeyEnc / status`                                                                                                                     |
| `gateway_model`    | [`entity/src/gateway_model.rs`](../../../entity/src/gateway_model.rs)       | `providerID`、`tenantID`、`name / label / allowRoles / enabled / dailyTokenQuota`、`capabilities` / `contextWindow`                                                                           |
| `gateway_usage`    | [`entity/src/gateway_usage.rs`](../../../entity/src/gateway_usage.rs)       | `tenantID`（可空）、`userID`、`providerID`、`modelID`、`promptTokens` / `completionTokens` / `totalTokens`、`status`（OK / QUOTA / UPSTREAM / ERROR）、`latencyMs`、`createdAt`；追加型无外键 |
| `gateway_audit`    | [`entity/src/gateway_audit.rs`](../../../entity/src/gateway_audit.rs)       | `tenantID`（可空）、`actor`、`action`、`resource`、`detail`、`ip`、`createdAt`                                                                                                                |

各表的完整列定义见 [`guide/database.md`](../../../guide/database.md#gateway_provider--gateway_model-表)。

四张表都 `ENABLE` + **`FORCE`** 行级安全策略：供应商与模型按 `tenantID IS NULL OR tenantID = 当前租户`
可读、只允许写本租户行；用量与审计按 `tenantID = 当前租户 OR (tenantID IS NULL AND 属主 = 当前用户)`。
平台面靠 `PlatformScope` 的 `BYPASSRLS` 角色跨租户读、只写全局行。

- `apiKeyEnc` 为 AES-256-GCM 密文（`security.aes_key`）。
- 用量只落 Postgres `gateway_usage`；审计落库可用 `gateway.audit_enabled` 关闭。

## 实现架构

```
GatewayModule::configure
  └── scope("/gateway") .wrap(Auth::isRequired())
        ├── POST /chat/completions → GatewayController::chat  → Target::enter → GatewayService::prepare → chat_json / chat_stream
        ├── GET  /models           → GatewayController::models → GatewayService::list_models(tx, principal)
        ├── GET  /quota/me         → GatewayController::quota_me → GatewayService::self_quota(tx, principal)
        └── admin_routes（每条各自 .wrap(Auth::admin())）
              providers / admin/models / usage / audit → PlatformScope::open → GatewayService::*
                                                       └── repository::record_usage / record_audit
```

同一模块还挂了服务面（无用户 JWT，两道服务头各自校验）：

```
GatewayModule::configure
  └── scope("/service")
        ├── POST /token                    → GatewayController::service_token  → 按 scope 校验 → ServiceToken::mint
        ├── POST /embeddings               → GatewayController::service_embeddings → ServiceScope::open → GatewayService::embeddings
        └── GET  /assets/{id}/content      → UploadController::service_content（handler 在 upload 模块，路由挂在这里）
```

服务面**不分两个** `web::scope`：`/service` 前缀下同一层级只会命中第一个注册的 scope，所以内容端点
（handler 属于 upload）也登记在这一个 scope 里，见 [`module.rs`](module.rs)。

管理面按 `web::resource` **逐条**注册，不再套第二层 `web::scope("")`：同一层级出现两个空前缀 scope 时，
actix 的 `ResourceMap` 只在第一个匹配节点内继续查找，后注册的 scope 永远不会命中（管理面曾因此全部 404）。

解析链路（`GatewayService::prepare`）：

```
Target::enter（X-Tenant-ID → 租户作用域 / 账号作用域；作用域即行可见性）
  → find_model（同名时租户私有行优先，其次全局行）；model = "auto" 时先 pick_auto_model 补全成具体模型名
  → 校验 enabled / allow_roles / provider.status
  → 取 provider.api_key_enc 并解密
  → resolve_quota（模型覆盖 > 订阅档位 > 免费档 > 全局兜底）
  → Prepared{model, provider, api_key, scope, quota_limit, …}
```

## 错误码

| code            | 场景                                              |
| --------------- | ------------------------------------------------- |
| 100002          | 服务身份面未启用（`gateway.service_token_secret` 为空，HTTP 503） |
| 200003          | 参数无效（含 `capabilities` 非布尔、占用保留名 `auto`、非法 `scope`、资产未完成） |
| 300002          | 服务身份令牌无效 / 已过期 / 受众不符 / 请求头缺失（HTTP 401） |
| 300006 / 300007 | 权限不足 / 访问被拒绝（模型 `allowRoles` 不允许） |
| 400001          | 供应商或模型不存在（`model=auto` 时表示没有候选模型） |
| 400004          | 令牌作用域与路径不符（拿 A 的令牌读 B 的内容） |
| 400006          | 配额已用尽                                        |
| 500204          | 资产不存在或对本租户不可见（不暴露存在性）        |
| 600001          | 数据库错误                                        |
| 600003          | 配额缓存异常                                      |
