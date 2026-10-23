# 项目指南

基础 URL：`http://127.0.0.1:3000`（见 [`configuration.md`](configuration.md)）

## 文档入口

| 类型 | 位置 |
|------|------|
| OpenAPI 规范（生成） | [`../spec/openapi.json`](../spec/openapi.json) · 开发环境 `/api-docs/openapi.json` |
| Swagger UI | `/swagger-ui/`（需 `--features openapi`） |
| 业务错误码 | [`error-codes.md`](error-codes.md) · 开发环境 `/guide/error-codes.md` |
| API 版本与兼容策略 | [`api-versioning.md`](api-versioning.md) |
| 契约代码生成 | [`contract-codegen.md`](contract-codegen.md) |
| 数据库协作 | [`database.md`](database.md) |
| 部署（本地 · 生产 · 探针 · 链路） | [`deployment.md`](deployment.md) |
| 事件发布（outbox → 下游） | [`../crates/audit/README.md`](../crates/audit/README.md) |
| 能力边界（crate 划分与门禁） | [`architecture-capabilities.md`](architecture-capabilities.md) |
| 配置（YAML） | [`configuration.md`](configuration.md) |
| 外部集成（出站） | [`integrations.md`](integrations.md) |
| 服务端 agent 运行时（长任务 · 无人在环） | [`agent-runtime.md`](agent-runtime.md) |
| Redis | [`redis.md`](redis.md) |
| 横切架构（Nest ↔ Actix） | [`architecture-cross-cutting.md`](architecture-cross-cutting.md) |
| 模块接口详情 | [`src/services/*/README.md`](../src/services/auth/README.md) |
| HTTP 测试 | [`http/`](../http/) |

生成 OpenAPI：`cargo run --bin docs`（输出为规范序，键升序，可做字节级漂移校验）

## 统一响应

HTTP 状态码表达「调用在协议语义上是否成功」，业务结果看 body：

- 成功：`code = 200000`，`success = true`，HTTP 200
- 失败：`success = false`，HTTP 状态码按 `code` 段位推导（见 [error-codes.md](error-codes.md)）

## 鉴权

```
Authorization: Bearer <JWT>
```

Token 来自 `POST /api/v1/auth/signin` 或 `signup` 响应的 `data.token`。

## 模块导航

| 模块 | 前缀 | 文档 | HTTP 测试 |
|------|------|------|-----------|
| 系统 | `/api/health` · `/api/live` · `/api/ready` | [deployment](./deployment.md) | [`http/00-health.http`](../http/00-health.http) |
| 认证 | `/api/v1/auth` | [auth](../src/services/auth/README.md) | [`http/01-auth.http`](../http/01-auth.http) |
| 用户(后台) | `/api/v1/users` | [user](../src/services/user/README.md) | [`http/02-users.http`](../http/02-users.http) |
| 上传 | `/api/v1/upload` | [upload](../src/services/upload/README.md) | [`http/03-upload.http`](../http/03-upload.http) |
| 搜索引擎代理 | `/api/v1/engine` | [engine](../src/services/engine/README.md) | [`http/04-engine.http`](../http/04-engine.http) |
| 应用 | `/api/v1/application` | [application](../src/services/application/README.md) | [`http/05-application.http`](../http/05-application.http) |
| 异常上报 | `/api/v1/exception` | [exception](../src/services/exception/README.md) | [`http/09-exception.http`](../http/09-exception.http) |
| 订阅 | `/api/v1/tenants/{id}/subscriptions` | [subscription](../src/services/subscription/README.md) | OpenAPI |
| 支付 | `/api/v1/tenants/{id}/orders` | [payment](../src/services/payment/README.md) | OpenAPI |
| 模型网关 | `/api/v1/gateway` · `/api/v1/tenants/{id}/audit` | [gateway](../src/services/gateway/README.md) | [`http/07-gateway-audit.http`](../http/07-gateway-audit.http) |
| agent 任务 | `/api/v1/agent/tasks` | [agent](../src/services/agent/README.md) · [运行时](./agent-runtime.md) | OpenAPI |
| rag 索引任务 | `/api/v1/rag/index-tasks` | [rag](../src/services/rag/README.md) | OpenAPI |

## 典型调用顺序

### 登录后访问受保护接口

1. `POST /api/v1/auth/signin` → 取 `token`
2. 后续请求带 `Authorization: Bearer {token}`

### 更新个人资料 + 头像

1. signin
2. `GET /api/v1/auth/profile`
3. upload prepare → chunk → finalize
4. `PUT /api/v1/auth/profile` 设置 `avatar`

### 后台管理用户

1. signin（管理员）
2. `GET/POST/PUT/DELETE /api/v1/users`

## 历史文档

过时设计笔记见 [`archive/`](archive/README.md)，不作为现行规范。
