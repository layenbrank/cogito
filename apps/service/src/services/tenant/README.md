# Tenant

两套前缀，语义刻意分开：

| 前缀 | 对象 | 说明 |
| ---- | ---- | ---- |
| `/api/v1/tenants` | 当前登录用户 | 「我的租户」：只见自己是成员的行 |
| `/api/v1/admin/tenants` | 平台 ADMIN | 全平台运维：列表 / 详情聚合 / CRUD / 成员 / 订阅与配额 |

## 概述

多租户组织与成员的 CRUD。租户类型由 `tenant.type` 区分：

| 类型       | 说明                                      |
| ---------- | ----------------------------------------- |
| `PERSONAL` | 个人租户，走免费/订阅档位配额；可开通订阅 |
| `TEAM`     | 团队租户，走全局兜底配额                  |

租户**不持有配额数字**：配额由「订阅档位 / 免费档 / 全局兜底」表达，优先级见 [`guide/configuration.md`](../../../guide/configuration.md#模型网关配额)。

成员响应 `MemberR` 附带展示字段 `username` / `email`（联查 `auth`；账号已删则为 `null`），避免后台只见 UUID。

## 与同域其他模块的区别

- [`subscription`](../subscription/README.md)：只管个人租户的付费档位与有效期，路由挂在本模块前缀下（`/tenants/{id}/subscriptions`）；运维面另有 `/admin/tenants/{id}/subscriptions`（含代开）。
- [`payment`](../payment/README.md)：收钱并开通订阅，路由同样挂在本模块前缀下（`/tenants/{id}/orders`、`/tenants/{id}/pay/catalog`）。
- [`sso`](../sso/README.md)：按 `tenantID` 配置 OIDC 连接。
- [`gateway`](../gateway/README.md)：消费租户身份做配额与审计；审计**读侧**（列表 / 导出）的路由挂在本模块前缀下，可见性由租户作用域收口。
- [`user`](../user/README.md)：用户所属租户联查走 `GET /users/{id}/tenants`（本模块领域函数 + `PlatformScope`）。

## 路由一览 — 我的租户

| 方法   | 路径                                    | 鉴权              | 说明                                  |
| ------ | --------------------------------------- | ----------------- | ------------------------------------- |
| GET    | `/api/v1/tenants`                       | JWT               | **我所属的租户**（非全平台）          |
| POST   | `/api/v1/tenants`                       | JWT               | 创建租户（创建者自动成为 OWNER 成员） |
| GET    | `/api/v1/tenants/{id}`                  | JWT + 成员        | 租户详情                              |
| PUT    | `/api/v1/tenants/{id}`                  | JWT + OWNER       | 更新名称 / 状态 / 类型                |
| DELETE | `/api/v1/tenants/{id}`                  | JWT + OWNER       | 删除租户                              |
| GET    | `/api/v1/tenants/{id}/members`          | JWT + 成员        | 成员列表（含 username / email）       |
| POST   | `/api/v1/tenants/{id}/members`          | JWT + OWNER/ADMIN | 添加成员                              |
| PUT    | `/api/v1/tenants/{id}/members/{userId}` | JWT + OWNER/ADMIN | 改成员角色 / 状态                     |
| DELETE | `/api/v1/tenants/{id}/members/{userId}` | JWT + OWNER/ADMIN | 移除成员                              |
| GET    | `/api/v1/tenants/{id}/audit`            | JWT + OWNER/ADMIN | 本租户审计查询（handler 在 gateway 模块） |
| GET    | `/api/v1/tenants/{id}/audit/export`     | JWT + OWNER/ADMIN | 本租户审计导出（文件流，同上）        |

## 路由一览 — 平台运维面

鉴权一律 `Auth::admin()`（库中平台角色 `ADMIN`）。列表走 [`PlatformScope`](../../guards/platform.rs)（`BYPASSRLS`）；单租户读写走 [`TenantCtx::enter`](../../guards/tenant.rs)（平台 ADMIN **不要求成员身份**，与下方「旁路」一致）。

| 方法   | 路径                                              | 说明 |
| ------ | ------------------------------------------------- | ---- |
| GET    | `/api/v1/admin/tenants`                           | 全量分页列表：`q` / `type` / `status` / `page` / `size`；含 `memberCount` |
| POST   | `/api/v1/admin/tenants`                           | 创建租户（body 同租户面：`name` / `slug` / `type`，可建 TEAM） |
| GET    | `/api/v1/admin/tenants/{id}`                      | 详情聚合：租户 + 成员 + 订阅历史 + 配额快照 + 近期审计（≤20） |
| PUT    | `/api/v1/admin/tenants/{id}`                      | 更新名称 / 状态 / 类型 |
| DELETE | `/api/v1/admin/tenants/{id}`                      | 删除租户（成员 CASCADE） |
| GET/POST/PUT/DELETE | `/api/v1/admin/tenants/{id}/members…` | 成员 CRUD（响应含 username / email） |
| GET    | `/api/v1/admin/tenants/{id}/subscriptions`        | 订阅历史（惰性标 EXPIRED，读后 commit） |
| POST   | `/api/v1/admin/tenants/{id}/subscriptions`        | 运维代开 / 续订（`SubscriptionService::grant`，不造计费） |
| GET    | `/api/v1/admin/tenants/{id}/quota`                | 当前生效配额快照 |

列表响应为分页信封 `Paginated<TenantSummaryR>`（`items` / `count` / `page` / `size` / `total` / `next` / `prev`）。

## 鉴权说明

### 我的租户（`/tenants`）

- 整个 scope 挂 `Auth::isRequired()`，未登录返回 `300001`。
- 列表接口（`GET /tenants`）还没选定租户，走 [`AccountScope`](../../guards/account.rs)：账号级只读，
  只放行自己的成员行，由 Controller 开、只读结束即回滚。
- 其余租户内的路由由租户作用域 [`TenantCtx`](../../guards/tenant.rs) 建立：先开 `app.tenant_id` 作用域事务，再在作用域内读成员关系；
  读不到即「不是成员」（`300007`，HTTP 403）。
- 平台 ADMIN（库中平台角色为 `ADMIN`，即 `Session::is_platform_admin()`）不要求成员身份即可进入（运维通道），
  此时上下文的租户角色为空，`authz` 依平台角色放行，越过成员关系的那一步须在业务侧留审计。
- 权限判定一律交给 `authz`（`Resource::Tenant` / `Resource::Member`）：租户改名/删除只允许 **OWNER**，
  成员增删改允许 **OWNER/ADMIN**，其余为读。平台管理员越过成员关系的那一步由 `authz` 依平台角色放行
  （不再折算成租户角色），须在业务侧留审计。
- 跨模块复用入口只保留作用域与身份本身：`TenantCtx`（作用域 + `Principal` + `require`）与
  [`identity::Principal`](../../../crates/identity/README.md)，不再提供 `require_role` / `membership_role`
  这类「代为判角色」的旁路。
- 已知策略缺口（不在本步修复）：`update_member` 是资源/动作级判定而非取值级，因此 **ADMIN 可以把自己提升为 OWNER**；
  收紧需要在策略层引入「目标角色不得高于自身」的取值约束。
- 作用域之外的租户一律按「不存在」处理（`400001`，HTTP 404）：`update` / `remove` 不再出现静默成功的空操作。

### 平台运维面（`/admin/tenants`）与 OWNER 旁路

| 入口 | 作用域 | 成员关系 | `authz` |
| ---- | ------ | -------- | ------- |
| `GET /admin/tenants`（列表） | `PlatformScope` | 不读成员 | 路由层 `Auth::admin()` 已确权 |
| 单租户读写 / 成员 / 订阅 / 配额 | `TenantCtx::enter` | 平台 ADMIN 可无成员行进入 | 平台角色旁路租户角色；OWNER 路径仍要求 Owner 权限位 |

**不要**把 `GET /tenants` 加上 `scope=all`：客户端「我的租户」语义保持不变；全平台列表只用独立 admin 路径。

## 数据表

| 表              | Entity                                                                | 列                                                                                                            |
| --------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `tenant`        | [`entity/src/tenant.rs`](../../../entity/src/tenant.rs)               | `id / name / slug(唯一) / status / type / archivedAt / createdAt / creator / updatedAt / updater / expiresAt` |
| `tenant_member` | [`entity/src/tenant_member.rs`](../../../entity/src/tenant_member.rs) | `id / tenantID / userID / role / status / 审计字段`                                                           |

`tenant_member` 上 `(tenantID, userID)` 唯一（`uidx_tenant_member`），外键删除租户时 CASCADE。

## 实现架构

```
TenantModule::configure
  └── scope("/tenants") .wrap(Auth::isRequired())
        ├── configure(SubscriptionModule::configure)   # 订阅 / 配额，注册相对路径的 web::resource
        └── TenantController
              ├── AccountScope::enter → 列表（账号级只读，未选定租户）
              ├── TenantCtx::open_new → 建租户（作用域 = 新租户）
              ├── TenantCtx::enter    → 已有租户（作用域内读成员关系 → Principal）
              └── TenantService
                    ├── create / list / get / update / remove
                    ├── list_members / add_member / update_member / remove_member（MemberR 含 username）
                    └── identity::tenant::*

TenantModule::configure_admin
  └── scope("/admin/tenants") .wrap(Auth::admin())
        └── AdminTenantController
              ├── PlatformScope::open → admin_list（全量分页）
              ├── TenantCtx::open_new / enter → 写与详情
              └── TenantService::admin_* + SubscriptionService / GatewayService（详情内嵌）
```

## 错误码

| code   | 场景                                     |
| ------ | ---------------------------------------- |
| 200003 | 名称/slug 非法、状态或租户类型无效、用户 ID 非法 |
| 300001 | 未登录                                   |
| 300006 | 权限不足（租户改名/删除需 OWNER，成员写入需 OWNER/ADMIN） |
| 300007 | 非租户成员                               |
| 400001 | 租户不存在（含作用域之外的租户，HTTP 404） |
| 400002 | slug 已存在、该用户已是成员（HTTP 409）  |
| 500101 | 待添加的用户不存在                       |
| 600001 | 数据库错误（含成员角色字面量无法识别）   |
