# Payment

> 扫码支付（**微信 Native** + **支付宝当面付**）：把 `pay.plans` 里定价的档位卖给用户，付款成功后开通 / 续订订阅（`src/services/subscription`）。

## 概述

| 能力     | 说明                                                                                   |
| -------- | -------------------------------------------------------------------------------------- |
| 目录     | 可售档位（含定价、日配额、是否可售 + 原因）与渠道可用性，客户端渲染三步下单的唯一数据源 |
| 下单     | **只接受档位 + 渠道**，金额由服务端按 `pay.plans` 定价；返回 `codeUrl` 供渲染二维码     |
| 查单     | 客户端「刷新支付状态」；回调丢失时向上游查单核销，并自愈「已收款未开通」                 |
| 关单     | 用户取消支付；已支付订单拒绝关闭（退款走原渠道，不在本模块）                             |
| 回调     | 验签 → 渠道归属核对 → 金额/币种核对 → 幂等核销 → 开通订阅                               |
| 开通     | 续费不浪费剩余时长：生效订阅未到期时从其到期时间续期                                     |

## 与同域其他模块的区别

| 模块                        | 职责                                                                       |
| --------------------------- | -------------------------------------------------------------------------- |
| `src/services/payment`      | 收钱：订单生命周期、渠道凭据与验签、金额核对、核销                         |
| `src/services/subscription` | 权益：订阅增删查、生效判定、配额来源                                       |
| `src/services/gateway`      | 用权益：聊天热路径按订阅档位取日配额                                       |

**信任边界**：`SubscriptionService::subscribe` 是自助入口（要求租户 OWNER），`SubscriptionService::grant` 是可信通道（仅本模块等已确权链路内部调用，且**不判角色、不提交事务**）。**已定价档位（`amount > 0`）只允许走 `grant`**：自助调用会被 500408 拒绝，避免绕过收银台白拿付费档位。

本模块的 `activate` 走**可信机器通道**：先 `TenantScope::open(db, order.tenant_id)` 打开订单所属租户的作用域（租户来源是订单行本身，不是请求参数），
再在其中调 `grant`，最后按开通结果提交或回滚。这样订阅写入与 `payment_order` 回写落在同一个租户作用域事务里，不会跨租户。

## 路由一览

| 方法 | 路径                                            | 鉴权                 | 说明                     |
| ---- | ----------------------------------------------- | -------------------- | ------------------------ |
| GET  | `/api/v1/tenants/{id}/pay/catalog`              | JWT + 租户成员       | 档位定价 + 渠道可用性    |
| GET  | `/api/v1/tenants/{id}/orders`                   | JWT + OWNER/ADMIN    | 订单历史（最近 20 条）   |
| POST | `/api/v1/tenants/{id}/orders`                   | JWT + 租户 OWNER     | 下单（`plan` + `channel`） |
| GET  | `/api/v1/tenants/{id}/orders/{orderNo}`         | JWT + OWNER/ADMIN    | 订单详情（顺带惰性关单） |
| POST | `/api/v1/tenants/{id}/orders/{orderNo}/sync`    | JWT + OWNER/ADMIN    | 主动查单（回调兜底）     |
| POST | `/api/v1/tenants/{id}/orders/{orderNo}/close`   | JWT + 租户 OWNER     | 关闭订单（用户取消）     |
| POST | `/api/v1/pay/notify/wechat`                     | 无（验签即鉴权）     | 微信支付结果通知         |
| POST | `/api/v1/pay/notify/alipay`                     | 无（验签即鉴权）     | 支付宝异步通知           |
| GET  | `/api/v1/billing/prices`                        | 平台 ADMIN           | 价目列表（租户 / 型号 / 生效中 / 含归档） |
| POST | `/api/v1/billing/prices`                        | 平台 ADMIN           | 新建价目                 |
| PUT  | `/api/v1/billing/prices/{id}`                   | 平台 ADMIN           | 改展示名 / 收窄窗口      |
| DELETE | `/api/v1/billing/prices/{id}`                 | 平台 ADMIN           | 归档（软删除，幂等）     |
| GET  | `/api/v1/billing/reconciliation`                | 平台 ADMIN           | 计量对账（平台信封）     |
| GET  | `/api/v1/billing/reconciliation/export`         | 平台 ADMIN           | 对账导出（csv / ndjson） |

回调端点**不套平台响应信封**：微信要求 `200 {"code":"SUCCESS"}` / `500 {"code":"FAIL"}`，支付宝要求纯文本 `success` / `failure`，否则渠道会持续重试或标记异常。

`/api/v1/billing/*` 是**计费运维面**：整段 scope 只挂平台 ADMIN 守卫，租户角色一律进不来，业务逻辑也只走平台特权作用域
（`billing_price` 的 RLS 策略恒假，租户面连接读不到这张表）。它与上面的租户面、匿名回调面三者在路由树上完全分开。

鉴权粒度按「谁能看见账单、谁能花钱」两把尺子切：

| 端点                          | 鉴权粒度              | 谁能过                                          |
| ----------------------------- | --------------------- | ----------------------------------------------- |
| GET `catalog`                 | `Subscription/Read`   | 全部 ACTIVE 成员（看得到价格，看不到账单）      |
| GET 列表 / 详情 / POST `sync` | `PaymentOrder/Read`   | OWNER + ADMIN（账单是经营数据，普通成员不可见） |
| POST 下单 / POST `close`      | `PaymentOrder/Manage` | 仅 OWNER（花钱的动作只留给租户所有者）          |

平台管理员走运维通道，不受租户内角色限制。P3b-3c 之前 MEMBER 能读订单列表、ADMIN 能下单与关单，现在都不再成立。

## 数据表

`payment_order`（订单快照：金额、档位、时长在下单时固化，后续改价不影响存量订单）

| 列 (DB)                                  | 类型        | 说明                                              |
| ---------------------------------------- | ----------- | ------------------------------------------------- |
| id                                       | uuid PK     | 主键                                              |
| orderNo                                  | text UNIQUE | `P` + 秒级 UTC 时间戳 + 随机段，仅字母数字        |
| tenantID                                 | uuid FK     | → `tenant.id`，CASCADE，索引 `idx_payment_order_tenant` |
| userID                                   | uuid FK     | → `auth.id`，下单人（开通时作为订阅归属人）       |
| plan / channel                           | text        | 档位名（须存在于 `pay.plans`）/ `WECHAT` `ALIPAY` |
| amount / currency                        | bigint/text | **服务端定价**，`CURRENCY = CNY`                  |
| status                                   | text        | PENDING / PAID / CLOSED                           |
| durationDays                             | int NULL    | NULL = 永久有效（档位定价里的 `duration_days`）    |
| transactionID                            | text NULL   | 渠道流水号                                        |
| codeUrl                                  | text NULL   | 二维码内容（微信 `code_url` / 支付宝 `qr_code`）  |
| subscriptionID                           | text NULL   | 开通出的订阅 ID；为 NULL 表示「已收款未开通」     |
| paidAt / expiresAt                       | timestamptz | 支付时间 / 订单过期时间                           |
| remark                                   | text NULL   | 人工核对线索（金额不符、迟到支付、下单失败等）    |
| archivedAt / creator / updatedAt / updater |            | 审计字段                                          |

`{id}/orders/{orderNo}/sync` 与订单列表都会顺带把该租户过期未支付的订单置为 `CLOSED`（惰性关单），因此客户端拿到的状态不会滞留。

`billing_price`（模型价目：单价 `分 / 百万 token`，按 `(租户, 型号, 时间段)` 取价）

| 列 (DB)                      | 类型          | 说明                                                            |
| ---------------------------- | ------------- | --------------------------------------------------------------- |
| id                           | uuid PK       | 主键                                                            |
| tenantID                     | uuid NULL FK  | → `tenant.id`，CASCADE；NULL = **平台默认价**，非空 = 租户专属价 |
| modelID                      | uuid          | → `gateway_model.id`（无外键约束：型号下线不能牵连历史价目）     |
| modelName                    | text          | 写入时的型号名快照，对账报告显示用，不跨能力 JOIN                |
| currency                     | text          | 固定 `CNY`（结算币种）                                          |
| inputPricePerMillion         | bigint        | 输入价，分 / 百万 token                                          |
| outputPricePerMillion        | bigint        | 输出价，分 / 百万 token                                          |
| effectiveFrom / effectiveTo  | timestamptz   | 左闭右开窗口；`effectiveTo` NULL = 至今                          |
| archivedAt / creator / updatedAt / updater |   | 审计字段；`archivedAt` 非空即归档（软删除）                      |

索引：`idx_billing_price_model(modelID, effectiveFrom)`（取价路径）、`idx_billing_price_tenant(tenantID)`。

## 数据所有权

| 表                                  | 归属        | 读写关系                                                                |
| ----------------------------------- | ----------- | ----------------------------------------------------------------------- |
| `payment_order`                     | payment     | 本模块独占写入（订单生命周期唯一写入方）                                |
| `billing_price`                     | payment     | 本模块独占写入；RLS 策略恒假，只有平台连接看得见，租户面读写都拿不到   |
| `gateway_usage` / `gateway_model`   | gateway     | 只读：对账聚合直接读这两张表，不写                                      |
| `tenant`                            | tenant      | 只读：价目 / 订单的归属校验用 `tenant.id` 做外键                        |
| `subscription`                      | subscription | 支付成功后的开通 / 续订由 `subscription` 能力写入（`PaymentService::activate` 在同一事务内调用） |


## 实现架构

```
payment/
├── channel/            渠道适配（策略 + 表驱动，见下）
│   ├── mod.rs          Channel trait、注册表、availability()
│   ├── signature.rs    商户私钥签名 / 平台公钥验签（PEM）
│   ├── wechat.rs       微信 Native：prepay / query / verify_notify / close
│   └── alipay.rs       支付宝当面付：precreate / query / verify_notify
├── service.rs          订单生命周期 + 核销状态机（只依赖 channel 抽象）
├── controller.rs       HTTP 出入口（含渠道回执格式差异）
├── billing_controller.rs  计费运维面 HTTP 出入口（价目管理 + 对账 / 导出）
├── billing_price.rs    价目 service：窗口重叠判定、不可原地改价、归档
├── reconcile.rs        对账 service：用量/订单聚合 → 调 crates/billing 装配报告
├── render.rs           对账导出渲染（csv / ndjson 纯函数）
├── schema.rs           请求 / 响应 DTO（`OrderP` / `OrderR` / `CatalogR` / `PriceR` / `ReconcileR` …）
└── module.rs           路由注册（租户面 / 匿名回调面 / 平台运维面）
```

价目与对账只做「取数 + 落库 + 出入口」，折算与报告装配的纯逻辑在 [`crates/billing`](../../../crates/billing/README.md) 里
（`money` / `price` / `report`），因此重叠判定、金额公式、异常分类都能脱离数据库单测。

新增渠道 = 实现 `Channel` 并在注册表加一项（`code` + 工厂），**不需要**改 `service.rs`；`require_ready(config, code)` 负责「未启用 / 未配置」的拒绝与原因文案。

本模块的全部入口都已落在租户作用域上：带主体的路由用 [`TenantCtx`](../../guards/tenant.rs)（成员校验 + `ctx.require` 判权限），
匿名回调没有主体，用 [`PaymentNotifyScope`](../../guards/payment.rs) 由订单号把作用域引导出来（见下）。

## 下单 → 支付 → 开通

```
POST /tenants/{id}/orders {plan, channel}
  │  鉴权 OWNER（TenantCtx::require）+ 个人租户校验
  │  渠道就绪？(channel::require_ready) 档位定价且可售？(unsellable_reason)
  │  惰性关单 → 同用户+档位+渠道的未过期 PENDING 订单直接复用二维码
  ├─ 落库 PENDING（金额/时长/过期时间均为快照，orderNo 唯一）
  └─ 渠道 prepay → 写 codeUrl；失败即关单（不留永远没有二维码的待支付订单）
       ↓ 客户端渲染二维码
渠道回调 /api/v1/pay/notify/*（或客户端 sync 主动查单）
  │  ⓪ 引导作用域：PaymentNotifyScope::open(orderNo)（匿名入口只有订单号，命不中即「订单不存在」）
  │  ① 验签：微信 AES-256-GCM 解密 + 平台证书公钥验签；支付宝公钥验签
  │  ② 渠道归属：回调渠道必须等于下单时选择的渠道（否则 500406）
  │  ③ 幂等：已 PAID 且有 subscriptionID 直接 200
  │  ④ 金额 / 币种核对：不一致 → 500404，写 remark，**绝不开通**
  └─ settle()：条件更新 PENDING/CLOSED → PAID（并发只有一方翻转成功）
       └─ activate()：SubscriptionService::grant（只写不提交）
                      → 按 PaymentError::keeps_writes() 决定 commit / rollback（钱已收，失败也要留痕）
                      → 回写 subscriptionID → 失效 gateway:plan:{tenantID} 缓存
```

## 订单号能力键

匿名回调只带来一个订单号：没有令牌、没有租户 id，而 `payment_order` 是 FORCE RLS 的严格租户表。
出路是在读策略上加一条**能力键**分支：

```sql
-- USING
"tenantID" = app_current_tenant_id()
OR ("orderNo" = current_setting('app.order_no', true) AND "archivedAt" IS NULL)
```

- 读一行的同时把租户找出来：`PaymentNotifyScope::open(storage, order_no)` 用 `SET LOCAL app.order_no` 开事务，
  再读那行订单；后续写操作都落在这个已经升格为租户作用域的事务里。
- **只放宽读**：`WITH CHECK` 里没有能力键，写入仍必须满足 `"tenantID" = app_current_tenant_id()`，
  所以引导出来的作用域不能用来改别人的订单，枚举订单号也最多看到一行未归档订单。
- 命不中时返回 `Ok(None)`，调用方回执「订单不存在」——比抛 403 或 SQL 错误更贴近事实，也让渠道停止重试一个不存在的订单号。
- 有主体的路径（客户端 `sync`）不需要能力键，它走 `TenantCtx` + `PaymentOrder/Read`。
- 这是 R7 门禁里 `order_tx` 的唯一使用点，`PaymentNotifyScope` 只定义在 [`src/guards/payment.rs`](../../guards/payment.rs)；匿名端点因此不需要特权连接。

### 两条容易踩的规则

- **作用域不跨外部调用**：`sync` 在调 `channel::query` 之前先 `TenantCtx::renew(db)`（提交当前段、以同一租户开新事务），
  回来后再重新读一次订单。否则一次网络往返期间事务一直开着，读到的旧状态与写回的新状态之间就留了竞态。
- **失败也要分「留痕」和「回滚」**：结论由 `PaymentError::keeps_writes()` 给出。钱已经动过的失败（已收款却开通失败、
  金额不符写了 `remark`、下单失败已关单）必须 commit，否则会出现「钱收了却没有记录」；什么都没写的失败才 rollback。

## 安全设计要点

| 风险                   | 措施                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| 客户端改价             | 下单只接受 `plan` + `channel`，金额一律取 `pay.plans`，请求体里的任何金额字段都被忽略             |
| 伪造回调               | 匿名端点但必须先过签名校验（微信 AES-256-GCM + 平台证书；支付宝公钥），失败返回 500406             |
| 跨渠道重放             | 回调渠道必须与订单渠道一致，否则 500406                                                          |
| 少付 / 币种不符        | 实收金额与币种必须与订单快照完全一致，否则 500404 + remark 待人工对账，不开通                      |
| 重复回调 / 并发核销    | 已开通直接返回；`settle` 用 `WHERE status IN (PENDING, CLOSED)` 条件更新，只有翻转成功者开通；订阅侧唯一索引冲突（400002）视为并发成功回读 |
| 绕过收银台白拿付费档位 | 已定价档位禁止自助开通（500408），只能由 `grant`（支付回调）开通                                  |
| 未配置渠道被误用       | `pay.*.enabled: false` 时目录标不可用、下单返回 500405；凭据为空时启动即失败（宁启动失败不带半截凭据上线） |
| 未定价 / 配额缺失档位  | `unsellable_reason` 判定（`amount <= 0` 或 `gateway.plan_daily_token_quota` 缺项）→ 目录 `purchasable: false` + 下单 500408 |
| 已收款但开通失败       | 保留 `PAID` + 空 `subscriptionID` + remark，`sync` 可自愈补齐订阅，人工也能按 remark 定位          |
| 枚举订单号             | 订单号能力键最多命中一行未归档订单，且只放宽**读**（`WITH CHECK` 只认租户作用域），枚举不出别人的订单 |
| 跨租户改单             | 订单号只负责把租户找出来，升格后的写入仍受租户策略约束；能力键使用点被 R7 门禁锁在 `src/guards/`   |
| 越权下单 / 关单        | 花钱要求 `PaymentOrder/Manage`（仅 OWNER）；账单要 `PaymentOrder/Read`（OWNER + ADMIN），普通成员连列表都读不到 |

## 时效性设计要点

| 场景           | 处理                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------- |
| 订单过期       | `pay.order_ttl_secs`（默认 300s）；惰性关单在列表 / 详情 / `sync` 时执行，无需定时任务            |
| 迟到支付       | 订单已 `CLOSED` 后仍收到成功回调 → **照常开通**（钱已收，不能让用户付钱不到账），remark 记「迟到支付」 |
| 重复点击下单   | 同用户 + 档位 + 渠道的未过期 `PENDING` 订单复用二维码，避免并行订单一堆                            |
| 回调丢失       | 客户端 `sync` 主动向上游查单核销；`sync` 亦会补齐缺二维码的订单                                    |
| 续费           | 以当前生效订阅的到期时间为基数续期，不浪费剩余时长                                                |
| 配额生效延迟   | 开通后立即 `cache_invalidate(gateway:plan:{tenantID})`，避免「已付款但配额仍是免费档」            |

## 接口详情

### GET 目录

响应 `catalog`：

| 字段             | 说明                                                          |
| ---------------- | ------------------------------------------------------------- |
| `currency`       | 固定 `CNY`                                                    |
| `orderTtlSecs`   | 订单有效期，客户端据此做倒计时                                |
| `plans[]`        | `plan` / `label` / `amount` / `durationDays` / `dailyTokenQuota` / `purchasable` / `reason` |
| `channels[]`     | `code` / `label` / `enabled` / `reason`                       |
| `currentPlan`    | 当前生效档位（无有效订阅为 `null`）                           |

### POST 下单

请求：`{ "plan": "PRO", "channel": "WECHAT" }` → 响应 `order`（含 `codeUrl`、`orderExpiresAt`）。

### POST 同步 / 关闭

| 端点            | 行为                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------ |
| `.../sync`      | 已收款未开通 → 补齐订阅；过期未支付 → 关单（500403）；缺二维码 → 重新下单；否则向上游查单核销 |
| `.../close`     | 已支付 → 200003「订单已支付，无法关闭」；已关闭 → 幂等返回                                |

## 错误码

| code   | 场景                                                                     |
| ------ | ------------------------------------------------------------------------ |
| 200003 | 参数非法（如关闭已支付订单）                                             |
| 300001 | 未登录                                                                   |
| 300006 | 非租户成员，或权限不足（下单 / 关单要求 OWNER；查单要求 OWNER / ADMIN）  |
| 400001 | 订单不存在（含订单不属于该租户）                                         |
| 500401 | 支付订单不存在                                                           |
| 500402 | 支付订单已关闭                                                           |
| 500403 | 支付订单已过期                                                           |
| 500404 | 支付金额与订单不一致（写 remark，不开通）                                |
| 500405 | 支付渠道不可用（未启用 / 未配置）                                        |
| 500406 | 支付签名校验失败（含跨渠道回调）                                         |
| 500407 | 支付渠道返回错误（下单 / 查单上游失败）                                  |
| 500408 | 档位不可购买（未定价 / 缺配额 / 已定价档位走自助开通）                    |
| 500409 | 价目不存在（改 / 归档的 `id` 查不到）                                     |
| 500410 | 价目窗口重叠（同一「租户 + 型号」同一层级里出现两条重叠的有效价目）        |
| 500411 | 价目窗口非法（结束不晚于开始）                                            |
| 500412 | 价目金额非法（负数或超过上限）                                            |
| 500413 | 币种不是结算币种（当前只支持 `CNY`）                                      |
| 500414 | 对账窗口非法（起点不早于终点，或跨度超过 31 天）                           |
| 500415 | 对账金额溢出（折算或合计超出 i64）                                        |
| 600001 | 数据库错误                                                               |

## 计费运维面（`/api/v1/billing/*`，仅平台 ADMIN）

网关只记 token 用量，「用量值多少钱、实收对不对得上」在这里算。整段只对平台管理员开放，
业务逻辑全部走平台特权作用域（`PlatformScope`），事务的提交 / 回滚由出入口容器统一收口：
读操作成功后先归还事务再出响应，写操作先提交再出响应。

### 价目管理

- **取价维度是 `(tenantID, modelID, 时间点)`**：租户专属价优先，回落平台默认价（`tenantID IS NULL`）；
  同层级内取 `effectiveFrom` 最大的一条，再按 id 定序，保证同一次查询结果稳定。
- **窗口左闭右开** `[effectiveFrom, effectiveTo)`，`effectiveTo` 为 NULL 表示至今。同一「租户 + 型号」同一层级的
  有效窗口**不得重叠**（写入前用 `windows_of` 拉同层级窗口判重）；中间的缺口不算错，但对账会把它报成「未定价」。
- **不可原地改价**：`PUT` 只允许改 `modelName` 快照，以及把 `effectiveTo` **往早收窄**。延后终点、跨过原终点、
  改单价一律返回 `500411`——价格变动要做成「关旧窗口 + 开新窗口」，历史对账才不会随后续改价漂移。
- **`DELETE` 是软归档**（写 `archivedAt`），重复归档幂等；归档后不再参与取价，历史对账仍指向它，因此删不掉历史账。
- 价格变更**不发 outbox 事件**：价目不是租户面数据，对账在查询时用 SQL 现取当时生效价，不需要通知下游。
- `modelID` 必须指向一个未归档的 `gateway_model`，`modelName` 只做写入时快照，报告里显示用（不跨能力 JOIN）。

### 计量对账

`GET /api/v1/billing/reconciliation`，查询参数：`from` / `to`（毫秒时间戳，缺省 = 最近 24 小时，跨度上限 31 天）、
`tenantID`（缺省 = 全租户）、`currency`（缺省 = 结算币种 `CNY`）。

参数解析**有意比价目列表严格**：对账结果是拿去核账的，「条件写错了却看起来算出了结果」比多报一次错危险得多，
所以时间戳 / 租户 id / 非法币种都会直接报错（空串仍按「没给」处理）。

口径（左闭右开，端点内四条聚合 SQL）：

| 项       | 取数                                                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 用量金额 | `gateway_usage.status = 'OK'` 的记录按「租户 × 型号 × 命中价目」聚合，金额 = 单价 × token；取价规则与价目管理同源，写在 SQL 的 `LEFT JOIN LATERAL` 里，命中不到即「未定价」（按 0 计并进异常清单） |
| 实收金额 | `payment_order.status = 'PAID'`、未归档，且 `COALESCE(paidAt, updatedAt)` 落在窗口内的订单                                              |
| 差额     | `delta = usageAmount - orderAmount`                                                                                                     |
| 币种不符 | 金额不进合计，只记 `mismatchedAmount` / `mismatchedOrderAmount`，并作为异常列出（避免把不同币种加在一起）                                |

异常清单（`exceptions[].kind`，六类，全部来自内核 `ExceptionKind`）：

| kind                    | 含义                                     |
| ----------------------- | ---------------------------------------- |
| `UNPRICED_USAGE`        | 用量没有匹配到价目，金额未计入合计       |
| `CURRENCY_MISMATCH`     | 币种与结算币种不一致，金额未计入合计     |
| `USAGE_WITHOUT_ORDER`   | 有用量但没有已支付订单                   |
| `ORDER_WITHOUT_USAGE`   | 有已支付订单但没有用量                   |
| `PAID_NOT_ACTIVATED`    | 已收款（`PAID`）但 `subscriptionID` 为空 |
| `REMARKED`              | 订单 `remark` 非空，可能经过人工处理     |

响应信封里是 `totals` + `tenants[]` + `models[]` + `exceptions[]`；`models[]` 的每一行都带命中的
`priceID` / 单价 / token 数，可以用「token × 单价」独立复算，不必相信汇总数。

### 对账导出

`GET /api/v1/billing/reconciliation/export`：参数与 JSON 端点一致，多一个 `format`（`csv` 缺省 / `ndjson`）。
响应**不是平台信封**，而是文件流：

| 响应头                 | 说明                                                        |
| ---------------------- | ----------------------------------------------------------- |
| `Content-Disposition`  | `attachment; filename="billing-<from>-<to>.<ext>"`（UTC 紧凑格式） |
| `X-Export-Rows`        | 实际导出行数                                                |
| `X-Export-Truncated`   | `true` 表示触到 50 000 行上限被截断（只截尾，不报错）       |

- CSV：UTF-8 带 BOM、CRLF 行尾、RFC4180 引号规则（含分隔符 / 引号 / 换行 / 首尾空白才加引号，内部引号翻倍）。
- 行序固定 `TOTAL → TENANT → MODEL → EXCEPTION`，`section` 列标明分段；列共 23 列，从 `section,kind,tenantID,modelID,modelName,priceID,currency,inputPricePerMillion,outputPricePerMillion,promptTokens,completionTokens,requests,usageAmount,orderAmount,delta,unpricedRequests,failedRequests,mismatchedAmount,mismatchedOrderAmount,paidOrders,orderNo,amount,detail` 依次展开，不适用的列留空（不是 0）。
- 未做 CSV 公式注入转义：当前单元格全是服务端生成的 id / 数字 / 枚举（含 `remark`，也是服务端代码写入的），没有用户自由文本列。**将来若新增自由文本列必须重新评估这一条。**
- CSV / NDJSON 的拼装是纯函数（`render.rs`），只吃事务内已经取好的报告结构，事务归还后才渲染，因此导出不会把连接占在磁盘写入上。

## 配置

见 [`guide/configuration.md`](../../../guide/configuration.md#支付微信--支付宝) 与 [`config.yaml`](../../../config.yaml)：

- `pay.order_ttl_secs`、`pay.plans`（`amount` 单位分；档位名必须与 `gateway.plan_daily_token_quota` 同名，否则启动失败）
- `pay.wechat.*`：`mch_id` / `app_id` / `api_v3_key`（32 字符）/ `serial_no` / `private_key`（`apiclient_key.pem`）/ `platform_public_key` / `notify_url`（必须 `https://`）/ `api_base`
- `pay.alipay.*`：`app_id` / `private_key` / `alipay_public_key` / `gateway_url` / `notify_url`

**渠道申请（运维 / 商务侧前置条件）**

| 渠道 | 需要准备                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------- |
| 微信 | 微信支付商户号（开通 **Native 支付**）、绑定 appid、APIv3 密钥、商户 API 证书（序列号 + `apiclient_key.pem`）、平台证书公钥、**ICP 备案的公网 HTTPS 回调域名** |
| 支付宝 | 开放平台应用（签约 **当面付**）、应用私钥（RSA2）、支付宝公钥、公网 HTTPS `notify_url`            |

本地开发收不到回调（微信/支付宝无法访问本机）时，用内网穿透或反向代理暴露 `/api/v1/pay/notify/*`，或直接点收银台「刷新支付状态」走 `sync`。

## 对账建议

- 每日按 `paid_at` 导出 `PAID` 订单，与渠道账单核对 `transactionID` / 金额。
- 用 `GET /api/v1/billing/reconciliation/export?from=<毫秒>&to=<毫秒>` 出对账底稿：`totals` 看总量差额，
  `TENANT` 段定位到租户，`MODEL` 段定位到型号，`EXCEPTION` 段就是待人工处理的清单。
- 巡检两类异常订单：`status = PAID AND subscriptionID IS NULL`（已收款未开通）与 `remark` 非空的订单（金额不符 / 迟到支付 / 下单失败）。
- 出现大量「未定价」通常意味着价目窗口有缺口：补价目时不要改历史窗口，新开一条覆盖缺口的窗口即可。
- `REFUNDED` 未实现：退款走渠道后台，本模块只保证「已支付订单不可关闭」。
