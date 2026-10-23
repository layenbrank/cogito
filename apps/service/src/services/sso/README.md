# SSO

路由前缀：`/api/v1/sso`

## 概述

单点登录（OIDC）。租户级配置 IdP 连接，登录走标准授权码流程。

| 能力     | 说明                                                                                   |
| -------- | -------------------------------------------------------------------------------------- |
| 连接管理 | 每个租户可配 OIDC 连接（issuer / clientID / clientSecret / redirectUri）               |
| 授权跳转 | `/sso/{id}/authorize` 重定向到 IdP                                                     |
| 回调     | `/sso/{id}/callback` 用 code 换取 token、校验 id_token，并在该连接所属租户处理成员关系 |

`authorize` / `callback` 是**匿名**端点，而 `sso_connection` 受行级安全保护（见「连接 id 能力键」），
所以本模块是所有模块里唯一有两条作用域通道的：管理面走平台运维通道，登录流程走能力键引导。

## 与同域其他模块的区别

- [`auth`](../auth/README.md)：账号密码 / OTP / 图形验证码等本服务自有的登录方式；本模块是**外部 IdP** 委托登录。
- [`tenant`](../tenant/README.md)：连接按 `tenantID` 归属；回调后落到该租户的成员关系。

## 路由一览

公开（无需 JWT）：

| 方法 | 路径                         | 说明                            |
| ---- | ---------------------------- | ------------------------------- |
| GET  | `/api/v1/sso/{id}/authorize` | 跳转 IdP 授权页                 |
| GET  | `/api/v1/sso/{id}/callback`  | IdP 回调，换取 token 并建立会话 |

后台（平台 ADMIN）：

| 方法   | 路径                           | 说明     |
| ------ | ------------------------------ | -------- |
| GET    | `/api/v1/sso/connections`      | 连接列表 |
| POST   | `/api/v1/sso/connections`      | 新建连接 |
| PUT    | `/api/v1/sso/connections/{id}` | 更新连接 |
| DELETE | `/api/v1/sso/connections/{id}` | 删除连接 |

## 鉴权说明

- `connections` 系列在 `Auth::admin()` 下，需令牌有效且库中平台角色为 `ADMIN`（令牌 `role` 声明只用于快速拒绝）。
  确权之后，四个 handler 各自开一段 [`PlatformScope`](../../guards/platform.rs)：连接按租户隔离，
  但运维要跨租户看、建连接时也由平台管理员指定 `tenantID`，只有特权通道能做到（见 [`guide/database.md`](../../guide/database.md#平台运维通道)）。
- `authorize` / `callback` 是浏览器重定向入口，**不挂鉴权**（[`src/guards/public.rs`](../../guards/public.rs) 按后缀放行），
  靠 `state` / `id_token` 校验；数据侧靠连接 id 能力键限定可见范围。

## 数据表

Entity：[`entity/src/sso_connection.rs`](../../../entity/src/sso_connection.rs)（表 `sso_connection`）

| 列 (DB)                                                            | 类型    | 说明                              |
| ------------------------------------------------------------------ | ------- | --------------------------------- |
| id                                                                 | uuid PK | 连接 ID                           |
| tenantID                                                           | uuid FK | → `tenant.id`，删除租户时 CASCADE |
| provider                                                           | text    | IdP 类型标识                      |
| issuer                                                             | text    | OIDC Issuer                       |
| clientID                                                           | text    | 客户端 ID                         |
| clientSecretEnc                                                    | text    | 客户端密钥（密文）                |
| redirectUri                                                        | text    | 回调地址                          |
| status                                                             | text    | ACTIVE / DISABLED，默认 ACTIVE    |
| archivedAt / createdAt / creator / updatedAt / updater / expiresAt |         | 审计字段                          |

表受 **FORCE ROW LEVEL SECURITY** 保护：读要么在租户作用域内（本租户的连接，含已归档），要么命中连接 id 能力键
（只有那一行 **未归档** 连接）；写必须满足 `"tenantID" = app_current_tenant_id()`，所以管理面只能走平台特权通道。

## 实现架构

```
SsoModule::configure
  ├── /connections、/connections/{id}   .wrap(Auth::admin())   ← 逐条 web::resource 注册
  │     └── SsoController：actor() 确权 → PlatformScope::open → SsoService 连接 CRUD
  │            （平台面唯一使用点，R8 门禁正向登记 4 处）
  └── /{id}/authorize、/{id}/callback   公开
        ├── authorize：SsoConnectionScope 读回连接 → 关事务 → 组装授权 URL 并重定向
        └── callback ：SsoConnectionScope 读回连接与租户 → 关事务
                        → code 换 token（token_endpoint）→ 校验 id_token(JWKS) / userinfo
                        → SsoLoginScope(该租户)：账号 upsert + 成员关系，一次提交
```

管理面路由必须逐条 `web::resource` 注册，不能套一层 `web::scope("")`：同一层级出现空前缀 scope 时，
actix 的 `ResourceMap` 只在第一个匹配节点内继续查找，后面注册的 `/{id}/authorize`、`/{id}/callback` 永远不会被命中。

## 连接 id 能力键

IdP 把浏览器跳回来时**没有我们的会话**，唯一能当凭证的就是回调地址里的连接 id，而 `sso_connection` 是租户隔离表。
出路是在读策略上加一条**能力键**分支：

```sql
-- USING
"tenantID" = app_current_tenant_id()
OR ("id" = app_current_sso_connection_id() AND "archivedAt" IS NULL)
```

- 只放宽读：`WITH CHECK` 仍是 `"tenantID" = app_current_tenant_id()`，拿到连接 id 也写不进任何一行，
  写入必须先建立租户作用域。
- 只借出那一行**未归档**连接：连接被归档后回调地址随之作废，猜到 id 也读不到。
- 流程因此分成两段，见 [`src/guards/sso.rs`](../../guards/sso.rs)：

  | 段 | 句柄 | 做什么 | 收尾 |
  | --- | --- | --- | --- |
  | ① 读连接 | `SsoConnectionScope::open(storage, connection_id)` | 读回那一行连接，拿到 `"tenantID"` | **立刻 `close()` 回滚**，之后才动网络 |
  | ② 落库 | `SsoLoginScope::open(storage, tenant_id)` | 账号 upsert + 成员关系 | 一起 `commit()`；中途失败 `rollback()` |

- 两段分开是刻意的：discovery / token / userinfo 都是网络往返（可能几秒），事务绝不能跨越它们，
  否则连接池会被长事务占满；而且先读到连接再动网络，也避免了「拿着看不到的连接去做外部请求」。
- 阶段一的租户 id 来自**读到的连接行**，不是请求参数，因此调用方已经确权：
  能读到连接就意味着这次登录本来就是为那个租户发起的。
- 一次提交到底，避免出现「有账号没成员关系」的半截状态；`generate_token` 失败同样回滚。
- 连接管理不在这条通道上：它是运维面，走 `PlatformScope`。

## 错误码

| code   | 场景                     |
| ------ | ------------------------ |
| 200003 | 参数无效                 |
| 300006 | 权限不足（非平台 ADMIN） |
| 400001 | 连接不存在               |
| 400002 | 连接已存在               |
| 600001 | 数据库错误               |
