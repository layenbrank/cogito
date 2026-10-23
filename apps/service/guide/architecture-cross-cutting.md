# 横切架构：NestJS ↔ Actix

对照仓库：

- NestJS：`D:\Documents\Node\service`
- 本服务：Actix（按 Nest 管道阶段拆分目录）

详细调研记录见根目录 [`findings.md`](../findings.md)。

## Nest 功能分类

| 分类 | 职责 | Nest 典型位置 | 本 Nest 项目 |
|------|------|---------------|--------------|
| Middleware | 最早横切（日志、Cookie、CORS） | `middleware/` 或 Express `app.use` | `bootstrap.ts` + pino（无自定义 NestMiddleware） |
| Guard | 鉴权 / 是否放行 Handler | `guards/` | `guards/auth.guard.ts`（**未注册**） |
| Interceptor | 成功路径 AOP（包装响应、计时） | `interceptors/` | 全局 `ResponseInterceptor` |
| Pipe | 入参校验与转换 | 全局 / 参数级 | 全局 `ValidationPipe` |
| Filter | 异常 → 统一错误响应 | `filters/` | 全局 `ExceptionFilter`（`APP_FILTER`） |
| Decorator | 元数据或参数注入 | `decorators/` | `@AuthToken()`（**未使用**） |

### 请求管道

```
Middleware → Guard → Interceptor(pre) → Pipe → Handler
  → Interceptor(post)  （成功）
  → Filter             （异常）
```

## 与本仓库映射（已落地）

| Nest | Actix / 本仓库 |
|------|----------------|
| Middleware | [`cors`](../src/middlewares/cors.rs)、[`access_log`](../src/middlewares/access_log.rs)、[`logger`](../src/utils/logger.rs) |
| Guard | [`Auth`](../src/guards/auth.rs)、[`Session`](../src/guards/session.rs)（请求身份上下文）、[`TenantCtx`](../src/guards/tenant.rs)（租户作用域入口）、[`AssetReader` / `AssetContentScope`](../src/guards/asset.rs)（资产读写与内容能力键）、[`SsoConnectionScope` / `SsoLoginScope`](../src/guards/sso.rs)（匿名 OIDC 的连接 id 能力键引导）、[`blacklist`](../src/guards/blacklist.rs)、[`public`](../src/guards/public.rs) |
| Interceptor | [`Envelope` / `Paginated`](../src/interceptors/envelope.rs) |
| Filter | [`Exception`](../src/filters/exception.rs)（`details` 非生产才写入） |
| Guard | [`Auth::required`](../src/guards/auth.rs) + [`authz`](architecture-capabilities.md)（`crates/authz` 统一判定） |
| CORS | [`cors(config)`](../src/middlewares/cors.rs)，`COGITO__CORS__ORIGINS`（`*` 仅非生产生效）/ 生产收紧 |
| 状态码 | [`code`](../src/utils/code.rs) |
| Pipe | `web::Json` + schema `*P` |
| Decorator | 模块 `configure` + Auth 作用域 |

统一响应形状：`code` / `success` / `msg` / `data` / `timestamp` / `traceID`。HTTP 状态码由错误码归属推导（成功恒为 200，失败按 `code` 段位返回 4xx/5xx），业务仍以 `code` 为准（见 [error-codes.md](error-codes.md)）。
链路追踪：请求可带 W3C `traceparent`（缺省由服务端生成），响应始终回显该头，信封 `traceID` 即其 trace-id（见 [`trace`](../src/middlewares/trace.rs)）。

### 请求身份管道

[`Auth`](../src/guards/auth.rs) 中间件按固定顺序执行，任一步失败即短路返回：

```
令牌解析 → 公开路由放行 → Configure(500) → verify_token(401)
  → 声明级快速拒绝(403) → Redis 黑名单(500/300002) → Storage(500)
  → Session::resolve(401/500) → authz 复核(403) → 注入 Session
```

- 令牌只证明身份（`sub` + 过期时间）；**平台角色与账号状态以库为准**，每请求读取一次。
- `Session`（[`guards/session.rs`](../src/guards/session.rs)）是 handler 取用身份的唯一途径，取代了原先直接读 `Claims` 的做法。
- 解析失败一律 fail-closed：未知角色字面量、`sub` 非 UUID、账号不存在、账号被停用都会拒绝请求，不会静默降级为普通用户。
- 声明级快速拒绝保证「令牌里不是 ADMIN」时无需访问 Redis / 数据库即可 403；`Auth::admin()` 再以 `authz::require(Resource::Account, Action::Manage)` 复核，避免散落的角色字面量比较（R3）。

### 租户作用域管道

中间件只到「是谁」为止；「在哪个租户、是什么角色」由 handler 首行的租户作用域句柄决定（[`database.md`](database.md#租户隔离rls)）。
租户作用域句柄有两条通道，选择依据是**有没有请求主体**；匿名渠道回调连主体都没有，只能靠订单号这类能力键把它引导到租户：

```
[请求通道] TenantCtx::enter(storage, &session, tenant_id)
  → TenantScope::open（事务 + SET LOCAL app.tenant_id）
  → identity::persistence::membership（在作用域内读成员关系）
  → 非成员且非平台管理员 → 403(300007)
  → Principal::with_tenant(..) → Session 的 principal 变成当前租户的身份

handler 只用：ctx.tx() 读写 / ctx.require(permission) 判权限 / ctx.commit() 提交

[账号通道] AccountScope::enter(storage, &session)
  → user_tx（事务 + SET LOCAL app.user_id），不带租户
  → 请求没有选定租户时的落点：全局目录行（"tenantID" IS NULL）与「本人 + 无租户」的行
  → 网关的用户面（目录 / 聊天 / 自助配额）与「列出我所属的租户」都走这条

[可信机器通道] TenantScope::open(storage, tenant_id)
  → 只带事务与租户 id，不带主体；用于定时任务、内部调用等**已知道租户 id** 的无主体路径
  → 租户 id 必须来自可信数据（如订单行），不得取自请求参数

[能力键引导] PaymentNotifyScope::open(storage, order_no)
  → 匿名回调只递进一串订单号：策略里的能力键让「找出租户」与「读那一行」在同一条语句里发生
  → 只命中一行未归档订单；命不中返回 None，调用方按「订单不存在」回执（不是权限失败）

[登录引导] SsoConnectionScope::open(storage, connection_id) → SsoLoginScope::open(storage, tenant_id)
  → 匿名 OIDC 回调只递进一个连接 id：第一段读回那一行未归档连接、拿到归属租户后**立刻回滚**
  → 中间隔着对 IdP 的若干次网络往返（事务绝不跨越它们），第二段按该租户开写事务落账号与成员关系
  → 两段串起来才是完整引导，但没有同一段事务：连接是只读的，写入只发生在确权之后

[资产读通道] AssetReader::enter(storage, Option<user_id>)
  → 事务 + SET LOCAL app.user_id；None 即匿名读事务（只见 PUBLIC）
  → 可见性完全由 asset 的策略决定（创建者 / 租户 / PUBLIC / viewers / hash 五分支）
  → 调用方拿到句柄后自己 rollback / commit

[内容能力键] AssetContentScope::open(storage, hash)
  → 只有内容 hash、没有身份：秒传要跨账号借用已上传字节时用
  → 只借内容不借所有权，且要求 status = COMPLETED
  
[平台运维通道] PlatformScope::open(storage)
  → 提权到 cogito_platform（SET LOCAL ROLE，事务局部）：唯一一条绕过行级策略的通道
  → 只用于平台目录的全局行（"tenantID" IS NULL）与跨租户用量/审计汇总，确权在路由层（Auth::admin）
```

- **谁持有句柄谁 commit**：下游 service 接收 `&TenantScope` / `&TenantCtx` 时只写不提交，把「读旧值 + 写新值」留在同一事务里；
  写操作必须显式 `commit()`，未提交即随事务回滚，作用域同时失效。
- 语义上是写、即使实现是只读查询也必须 commit（典型是「顺带标记过期订阅」的惰性清理）。
- 权限判定统一走 [`authz`](../crates/authz/src/lib.rs)：`Resource::Tenant`、`Resource::Member` … 的策略表决定角色能否执行动作；
  平台管理员走运维通道（上下文的租户角色为空也放行）。
- 角色不再由业务代码比较：`ctx.require(..)` 失败即 403(300006)，`tenantID = ?` 不再手写。
  `TenantScope` 不带主体，因此**只有 `TenantCtx` 判权限**；机器通道的授权由调用侧保证。
- 作用域只能从 [`src/guards/`](../src/guards) 进入：`Storage::tenant_tx` / `user_tx` / `order_tx` / `asset_hash_tx` / `sso_connection_tx` / `anon_tx`
  等原语仅 [`src/guards/`](../src/guards) 与 [`src/databases/scope.rs`](../src/databases/scope.rs) 可直接调用（R7 门禁，逐文件限额只减不增）。
- 「读不到」应当来自策略，而不是忘了设作用域：两条**无作用域通道**——`anon_tx`（只读公开行）与 `Storage::raw()`
  （逃开行级隔离的裸连接，`Storage` 的 `db` 字段已私有，只能这样取）——只允许出现在 `src/guards/` 与 `src/databases/`，
  其余调用点按 `UNSCOPED_DB_ALLOWED` 正向登记（R9 门禁）。当前名单只有健康检查 `ping`（[`src/bootstrap/system.rs`](../src/bootstrap/system.rs)）
  与全局身份表 `auth` 的账号查询（[`services/auth`](../src/services/auth)、[`services/user`](../src/services/user)，该表没有行级安全）。
- 提权只能从 [`src/guards/platform.rs`](../src/guards/platform.rs) 进入：`Storage::platform_tx` 同上受限，
  且其余调用点按 `PLATFORM_ENTRY_ALLOWED` 白名单正向登记（R8 门禁）——提权是绕过隔离，每多一处都要写明用途。
- `asset` 的策略是**五分支**（创建者 / 租户 / `PUBLIC` / `viewers` / hash 能力键），其中 `PUBLIC` 是**全局**分支，
  在任何作用域（含只带 hash 的能力键作用域）里都成立；`WITH CHECK` 只认创建者。详见 [`database.md`](database.md)。
- `sso_connection` 的策略是**两分支**（租户 / 连接 id 能力键，且能力键只借未归档行），并且是本仓唯一
  「读能力键 → 动网络 → 另开租户事务写」的两段式路径；管理面（`/sso/connections`）不走能力键，走平台运维通道。

## 目录约定

| 目录 | 角色 |
|------|------|
| `src/middlewares/` | CORS、访问日志 |
| `src/guards/` | `auth` / `session` / `tenant` / `account` / `asset` / `blacklist` / `permission` / `public` / `payment` / `platform` |
| `src/interceptors/` | 成功信封 |
| `src/filters/` | 失败信封 |
| `src/utils/code.rs` | 业务码 |
| `src/services/upload/{validation,storage,repository,error,multipart}` | 上传拆分 + creator 校验（四文件例外） |
| `src/services/auth/service.rs` | 含 profile 辅助（user 等可复用） |
| `scripts/arch.ts`（`pnpm arch`） | 模块结构 / 禁止路径卫生检查（CI） |

## 参考路径（Nest）

- `src/bootstrap.ts` — 全局 interceptor / pipe / CORS / cookie  
- `src/app.module.ts` — `APP_FILTER`  
- `src/filters/exception.filter.ts`  
- `src/interceptors/response/response.interceptor.ts`  
- `src/guards/auth.guard.ts`  
- `src/decorators/auth-token.decorator.ts`  
