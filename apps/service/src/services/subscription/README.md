# Subscription

路由前缀：`/api/v1/tenants/{id}/subscriptions`

## 概述

个人租户的**付费档位（订阅）**管理。本模块只负责「某租户此刻生效的是哪个档位」，**不存配额数字**——档位对应的日 token 配额由配置 `gateway.plan_daily_token_quota` 提供，实际扣减由 [`gateway`](../gateway/README.md) 模块完成。

| 能力        | 说明                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------ |
| 开通 / 续订 | 事务内：旧订阅标 `EXPIRED`/`CANCELED`（未过期的 `expiresAt` 截断到当前时间），再插入新订阅 |
| 免费档自助  | 只对**未定价**档位（`amount <= 0`）开放自助开通；已定价档位必须走支付（`payment` 模块）     |
| 列表        | 返回订阅历史（含已取消 / 已到期），按创建时间倒序                                          |
| 取消        | 立即失效：状态置 CANCELED，`expiresAt` 截断到当前时间                                      |
| 当前配额    | `quota(ctx, config, redis)`：返回生效配额及其来源（`PLAN` / `FREE` / `GLOBAL`），并做鉴权 |
| 生效判定    | 热路径共用 `quota_in(tx, …)`，带 60s Redis 缓存                                            |

## 与同域其他模块的区别

- [`tenant`](../tenant/README.md)：只管租户与成员（`tenant.type` 区分 PERSONAL / TEAM），不知道订阅的存在。
- `subscription`（本模块）：只管**个人租户的档位与有效期**。团队租户不可订阅，走全局配额。
- [`gateway`](../gateway/README.md)：在同一个事务里调用 `quota_in(tx, …)` 决定日配额，并做 Redis 日窗计数。
- [`payment`](../payment/README.md)：收钱才开通（订阅是支付的结果）。它通过**可信通道** `SubscriptionService::grant` 调用本模块。

### 两条开通通道（信任边界）

| 函数                          | 调用方                                    | 鉴权                                     | 定价档位                              |
| ----------------------------- | ----------------------------------------- | ---------------------------------------- | ------------------------------------- |
| `subscribe(ctx, ...)`（自助入口） | `POST /tenants/{id}/subscriptions`     | `ctx.require(MANAGE_SUBSCRIPTION)`（OWNER）+ 自助规则校验 | **拒绝**：`pay.plans[plan].amount > 0` 时返回 `500408` |
| `grant(scope, ..., actor, ...)`（可信通道） | `payment` 核销回调、平台管理员直接开通 | **调用方负责鉴权**，本函数不再校验角色   | 允许（钱已收 / 运维代开）              |

判断逻辑只依赖配置：`pay.plans` 里 `amount > 0` 即视为「已定价，须付费」。这样既防止租户 OWNER（个人租户里就是用户本人）绕过收银台白拿付费档位，又保留客服代开与联调的可信路径。

两条通道的租户来源也不同：自助通道从 `TenantCtx` 取租户（即 URL 里那个租户，进入时已校验成员关系），
可信通道从传入的 [`TenantScope`](../../guards/tenant.rs) 取租户，调用方必须把租户锁定为可信数据（如支付订单行）。
**`grant` 不 commit**：它只写，由打开作用域的一方提交或回滚，这样与支付侧的回写能落在同一个事务里。

三者的配额优先级见 [`guide/configuration.md`](../../../guide/configuration.md#模型网关配额)。

## 路由一览

| 方法   | 路径                                                  | 鉴权              | 说明                                  |
| ------ | ----------------------------------------------------- | ----------------- | ------------------------------------- |
| GET    | `/api/v1/tenants/{id}/subscriptions`                  | JWT + 租户成员    | 订阅历史（含已取消 / 已到期）         |
| POST   | `/api/v1/tenants/{id}/subscriptions`                  | JWT + 租户 OWNER  | 开通 / 续订（仅未定价档位，见上表）   |
| DELETE | `/api/v1/tenants/{id}/subscriptions/{subscriptionID}` | JWT + 租户 OWNER  | 取消订阅（立即失效）                  |
| GET    | `/api/v1/tenants/{id}/quota`                          | JWT + 租户成员    | 当前生效配额及来源                    |

## 鉴权说明

- 中间件 `Auth::isRequired()` 挂在整个 scope 上，未登录直接 401 类。
- handler 首行 `TenantCtx::enter(&db, &session, id)` 一次性完成「进租户作用域 + 读成员关系」：
  列表与配额要求 **ACTIVE 成员**（`Subscription/Read`，MEMBER 也有），开通与取消要求 **租户 OWNER**
  （`Subscription/Manage`，ADMIN 不具备——开通/取消会改变计费归属，只应由所有者决定）。
- 平台 ADMIN（库中平台角色为 `ADMIN`，即 `Session::is_platform_admin()`）在 `Auth` 中间件里就按 `Resource::Account` 放行，
  作用域内权限判定同样旁路，属运维通道。
- 角色不再由本模块比较：`ctx.require(..)` 失败即 `300006`，非成员在 `enter` 阶段即 `300007`。
- 该租户/订阅不属于当前作用域时统一返回 `400001`（不区分「不存在」与「不属于你」，避免泄漏存在性）。
- 未登录返回 `300001`。

## 数据表

Entity：[`entity/src/subscription.rs`](../../../entity/src/subscription.rs)（表 `subscription`）

| 列 (DB)                                    | 类型        | 说明                                                   |
| ------------------------------------------ | ----------- | ------------------------------------------------------ |
| id                                         | uuid PK     | 订阅 ID                                                |
| tenantID                                   | uuid FK     | → `tenant.id`，CASCADE，索引 `idx_subscription_tenant` |
| plan                                       | text        | 档位名，必须存在于 `gateway.plan_daily_token_quota`    |
| status                                     | text        | ACTIVE / CANCELED / EXPIRED，默认 ACTIVE               |
| expiresAt                                  | timestamptz | 到期时间，**NULL = 永久有效**                          |
| createdAt                                  | timestamptz | 订阅创建时间；**创建即生效**，故也是生效开始时间       |
| archivedAt / creator / updatedAt / updater |             | 审计字段                                               |

本模块另**读取** `tenant.type`（PERSONAL / TEAM）用于「仅个人租户可订阅」的校验。

## 表协作

```mermaid
erDiagram
  tenant ||--o{ subscription : has
  auth ||--o| subscription : creator
```

| 关系                                       | 说明                         |
| ------------------------------------------ | ---------------------------- |
| `subscription.tenantID` → `tenant.id`      | 订阅归属，删除租户时 CASCADE |
| `subscription.creator/updater` → `auth.id` | 订阅审计                     |

**索引**：`idx_subscription_tenant`（`tenantID`）＋ 部分唯一索引 `uidx_subscription_active`：

```sql
CREATE UNIQUE INDEX uidx_subscription_active
  ON subscription ("tenantID") WHERE status = 'ACTIVE';
```

**生效判定**：`status = ACTIVE` 且 `archivedAt IS NULL` 且（`expiresAt IS NULL` 或 `expiresAt > now`）。
订阅**创建即生效**（`createdAt` 就是生效时间），因此不存在「已创建但未开始」的状态。
同一租户同一时刻**最多一条 ACTIVE 订阅**（上面那条部分唯一索引在 DB 层兜底，并发写入会被拒）。

**续订语义**：旧未结束订阅的 `expiresAt` 会被**截断到当前时间**（永久订阅亦如此）——新订阅即刻接管，不浪费剩余天数。

**过期标记**：订阅不靠定时任务。`list` 时顺带把已过 `expiresAt` 的 ACTIVE 行标为 `EXPIRED`；配额判定本身只看时间，不依赖该状态。
注意这条清理是**写操作**，所以 `GET /subscriptions` 的控制器在读完后仍要 `commit()`，否则清理会被回滚（对客户端不可见，但会让历史列表一直显示 ACTIVE）。

**取舍**：不支持「预约未来生效」与「补录历史开始时间」；若产品需要，须重新引入独立的 `startAt`。

## 实现架构

```
TenantModule 的 scope("/tenants")        # src/services/tenant/module.rs（Auth::isRequired() 在此统一挂载）
  └── .configure(SubscriptionModule::configure)
        # 订阅路由以**相对 /tenants 的相对路径**注册（src/services/subscription/module.rs）：
        # 若改回自建 scope("/tenants/{id}/…")，会与同层的 /tenants 前缀 scope 并列，
        # actix ResourceMap 只进入先命中的前缀节点 → 整片 404（曾因此断掉订阅闭环）
        ├── resource("/{id}/subscriptions")                  GET  ""  → SubscriptionController::toList
        │                                                   POST ""  → SubscriptionController::toWrite
        ├── resource("/{id}/subscriptions/{subscriptionID}") DELETE   → SubscriptionController::toRemove
        └── resource("/{id}/quota")                          GET  ""  → SubscriptionController::quota
              └── SubscriptionService        # src/services/subscription/service.rs
                    ├── 自助通道（收 TenantCtx）：ctx.require(权限) 判角色，租户取自作用域
                    │     ├── subscribe     → require(Manage) + 自助规则校验 → grant(ctx.scope(), ..)
                    │     ├── list          → require(Read)；顺带惰性标 EXPIRED（是写，故控制器需 commit）
                    │     ├── cancel        → require(Manage)
                    │     └── quota         → require(Read)
                    ├── 可信通道（收 &TenantScope）：不带主体，不判角色、不 commit
                    │     └── grant         → 作废旧 ACTIVE 订阅 + 插入新订阅，由调用方提交/回滚
                    ├── 热点只读包装（自开私有短作用域并立即回滚，供 gateway 等无请求上下文路径）
                    │     ├── active_plan(db, redis, tenantID)
                    │     └── active_subscription(db, tenantID)
                    ├── 事务内复用（不自己收尾，由调用方持有事务）
                    │     ├── quota_in(tx, config, redis, tenantID)   → gateway 热路径
                    │     ├── active_plan_in / active_subscription_in → payment 同事务读写
                    │     └── global_quota(config)                    → 无订阅/无租户兜底
                    ├── ensure_self_service_allowed → 已定价档位（amount > 0）禁止自助开通（500408）
                    └── 配额缓存（Redis 60s，读写失败都降级为直查数据库）
```

配额解析链路（在 `gateway` 侧）：

```
gateway_model.dailyTokenQuota > 0 ? 取值
  : 租户为 PERSONAL ?
      SubscriptionService::active_plan() = Some(plan)
        ? gateway.plan_daily_token_quota[plan]  (未知档位 → 免费档)
        : gateway.free_daily_token_quota
  : gateway.daily_token_quota
```

## 接口详情

### POST 开通 / 续订

```http
POST /api/v1/tenants/{id}/subscriptions
Authorization: Bearer {token}
Content-Type: application/json

{
  "plan": "PRO",
  "expiresAt": null
}
```

| 字段      | 类型   | 必填 | 说明                                                 |
| --------- | ------ | ---- | ---------------------------------------------------- |
| plan      | string | 是   | 档位名，须存在于 `gateway.plan_daily_token_quota`    |
| expiresAt | number | 否   | 毫秒时间戳；缺省或 `null` 为永久有效，须晚于当前时间 |

```json
{
  "code": 200000,
  "success": true,
  "msg": "创建成功",
  "data": {
    "id": "9f1c…",
    "tenantID": "3ab7…",
    "plan": "PRO",
    "status": "ACTIVE",
    "expiresAt": null,
    "createdAt": 1789803327000,
    "updatedAt": 1789803327000
  },
  "timestamp": 1789803327000
}
```

重复调用即**续订**：旧订阅被置为 CANCELED 且 `expiresAt` 截断到当前时间，新订阅即刻生效。

> **自助开通只对未定价档位开放。** 若 `pay.plans[plan].amount > 0`（已定价），此端点返回 `500408`，客户端应引导用户走收银台（`GET /api/v1/tenants/{id}/pay/catalog` → `POST /api/v1/tenants/{id}/orders`）；支付成功由 `payment` 模块经 `grant` 开通。

### GET 订阅历史

返回 `data` 为订阅数组（含已取消 / 已到期），按 `createdAt` 倒序。

### DELETE 取消订阅

```http
DELETE /api/v1/tenants/{id}/subscriptions/{subscriptionID}
Authorization: Bearer {token}
```

成功返回 `data: null`，`msg: 取消订阅成功`。取消后该租户配额**立即**回落免费档。

### GET 当前生效配额

```http
GET /api/v1/tenants/{id}/quota
Authorization: Bearer {token}
```

```json
{
  "code": 200000,
  "success": true,
  "msg": "获取当前配额成功",
  "data": {
    "tenantID": "3ab7…",
    "type": "PERSONAL",
    "source": "PLAN",
    "plan": "PRO",
    "dailyTokenQuota": 5000000
  },
  "timestamp": 1789803327000
}
```

`source`：`PLAN`（生效订阅档位）/ `FREE`（个人租户免费档）/ `GLOBAL`（团队租户或无租户身份）。
单模型可用 `gateway_model.dailyTokenQuota` 另行覆盖该值。

## 错误码

| code   | 场景                                                                             |
| ------ | -------------------------------------------------------------------------------- |
| 200003 | 档位不存在或未配置配额、时间戳无效、`expiresAt` 不晚于当前时间、团队租户试图订阅 |
| 300001 | 未登录                                                                           |
| 300006 | 租户内角色不足以执行该动作（开通 / 取消要求 OWNER）                                |
| 300007 | 不是该租户成员（在 `TenantCtx::enter` 阶段拒绝）                                  |
| 400001 | 租户或订阅不存在（含订阅不属于该租户）                                           |
| 400002 | 并发订阅冲突（部分唯一索引拒绝，重试即可）                                       |
| 500408 | 档位已定价，须通过支付开通（自助开通被拒）                                       |
| 600001 | 数据库错误                                                                       |
