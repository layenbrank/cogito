# Master Service

基于 **Actix Web + SeaORM + PostgreSQL** 的 Rust HTTP 服务，提供认证、用户管理、分片上传、搜索建议等 API。

## 技术栈

| 组件             | 说明                                                                   |
| ---------------- | ---------------------------------------------------------------------- |
| Actix Web 4      | HTTP 框架                                                              |
| SeaORM 2         | PostgreSQL ORM                                                         |
| JWT              | 登录鉴权                                                               |
| Argon2 / AES-GCM | 密码与加密配置                                                         |
| utoipa           | OpenAPI 3.x 文档生成                                                   |
| Bun + ky         | 仓库脚本（`scripts/`，`@/` 由 tsconfig paths 解析）；见 `package.json` |

## 快速开始

### 配置

分层 YAML（见 [`guide/configuration.md`](guide/configuration.md)）：

```powershell
Copy-Item config.local.yaml.example config.local.yaml
# 编辑 database.url、security.jwt_secret 等
```

默认 `config.yaml` 已包含开发连接串；本机差异用 `config.local.yaml` 覆盖。

### 数据库迁移

```bash
cargo run -p migration -- up
```

详见 [`migration/README.md`](migration/README.md)。

### 启动服务

```bash
# 安装 Bun 与脚本依赖（架构检查 / 格式化 / 上传 e2e）
bun install

# 开发热重载（cargo-watch；监听 src/entity/migration，Windows 下 --poll）
bun run dev
# 不打断正在运行的进程：变更排队，等当前 cargo run 结束后再启
bun run dev:no-restart
# 需已安装: cargo install cargo-watch --locked
# 无 watch（可选）
cargo run --bin cogito --features openapi

# 生产构建（不含 Swagger UI）
cargo run --bin cogito --release
# 或：bun run build
```

服务默认监听 `http://127.0.0.1:3000`。

### 启动 worker（outbox 发布）

HTTP 服务只写事件，投递由独立进程负责（二者共用同一份配置与数据库）：

```bash
cargo run --bin worker --release
```

- 以配置里的 `events.endpoint` 为下游终点，把 outbox 里未发布的事件推出去；返回 2xx 记为已发布，
  其余码累加 `attempts` 并阻塞同一聚合的后续事件（退避重试）
- **首轮失败直接退出**（多半是平台角色没授予或库连不上），由编排器拉起重试；之后的单轮失败只记日志继续
- `events.endpoint` 为空时退化为只记日志，事件照样算已发布（本地联调）

### 启动 orchestrator（长任务）

跨步骤、跨重启的长流程（文档索引、批量导入、需要重试与补偿的作业）由可靠执行引擎负责，
运行时的宿主是独立进程（同样共用这份配置）：

```bash
cargo run --bin orchestrator --release
```

- 从 `durable.database_url`（留空则回落 `database.url`）连库，在 `durable.schema`（默认 `durable`，**不允许 `public`**）里建自己的表
- 编排与活动的注册表在 [`src/orchestrations/`](src/orchestrations/mod.rs) 里装配：**只有这个二进制**会跑编排
- **一个部署单元只能有一个 orchestrator 进程**：多个进程同时跑没有意义（实现本体用锁保证正确性，但会互相抢同一实例的轮次）
- 停机时先给在跑的活动 `durable.shutdown_grace_ms` 毫秒收尾，再退出；进度都在库里，重启接着跑，不需要任何补偿脚本
- 其他进程（api / worker）用 `durable::Client` 起实例、投事件、查状态，不跑运行时
- 内置的第一条长任务是 **RAG 索引**（`rag.index-asset`：分块 → 嵌入 → 落索引）。AI 步骤不在
  Rust 侧做，而是由活动通过内部 HTTP 契约调用 Python 的 ai-worker（契约见 [`spec/internal.yaml`](spec/internal.yaml)，
  配置见 [`guide/configuration.md`](guide/configuration.md#ai-计算车间ai-worker--orchestrator)）
- 活动是**至少一次**语义：崩溃后已完成步骤不重跑，但在飞的那一步会重跑，靠幂等键
  （`<实例>:<步骤>`）让 ai-worker 去重

引擎细节（端口、语义、边界）见 [`crates/durable/README.md`](crates/durable/README.md)，配置见 [`guide/configuration.md`](guide/configuration.md#长任务durable--orchestrator)。

**Swagger UI**（debug 构建 + `openapi` feature 默认开启）：

- UI：`http://127.0.0.1:3000/swagger-ui/`
- OpenAPI JSON：`http://127.0.0.1:3000/api-docs/openapi.json`

环境变量：

| 变量                   | 说明                                                                   |
| ---------------------- | ---------------------------------------------------------------------- |
| `ENABLE_SWAGGER=true`  | 强制开启 Swagger UI 与 `/guide/*` 静态文档（release 亦可用，仅限内网） |
| `ENABLE_SWAGGER=false` | 强制关闭文档端点                                                       |

生产环境默认不暴露 `/swagger-ui` 与 `/api-docs/openapi.json`。

### 导出 OpenAPI（Apifox 离线导入）

```bash
bun run docs
# 或：cargo run --bin docs
# 生成 spec/openapi.json
```

### 测试

```bash
bun run arch
cargo test --lib -p cogito
cargo test --test oas_consistency

# 长任务（需要独立测试库，见 tests/orchestration.rs 头部）
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/cogito_service_test \
  cargo test --test orchestration -- --test-threads=1

# 同一测试库（先 export / set 一次 TEST_DATABASE_URL 即可复用）
cargo test --test rag_index -- --test-threads=1
cargo test --test rag_index_scope -- --test-threads=1
cargo test --test rag_fault_injection -- --test-threads=1
cargo test --test agent_scope -- --test-threads=1
cargo test --test agent_fault_injection -- --test-threads=1
```

## 项目结构

```
scripts/                  # Bun 脚本（bun run …）
  apis/                   # 接口封装（auth / upload）
  types/                  # 请求/响应类型
  utils/                  # http（ky）/ auth / http.errors
  arch.ts | dev.ts | imports.ts | upload.ts
crates/
  agent/                  # 能力 crate：agent 任务台账（agent_task 表的唯一写者）
  audit/                  # 能力 crate：跨模块审计（事件信封契约）
  durable/                # 能力 crate：可靠执行端口（编排/活动/停机，实现本体只在这里）
  rag/                    # 能力 crate：rag 索引任务台账（rag_index_task 表的唯一写者）
src/
  bin/service.rs          # HTTP 入口
  bin/worker.rs           # outbox 发布入口（事件投递由独立进程负责）
  bin/orchestrator.rs     # 长任务宿主（编排运行时；一个部署单元只能有一个）
  worker/
    dispatcher.rs         # 终点装配：HTTP 下游 / 只记日志
    runner.rs             # 发布循环 + 停机（平台通道在这里登记，见 R8）
  clients/                # 出站调用（内部 ai-worker 契约客户端）
  orchestrations/         # 编排与活动注册表（只有 orchestrator 会用；retry 重试策略 + rag 索引流水线）
  services/
    auth/                 # 登录、注册、个人 profile（含 profile 辅助）
    user/                 # 后台用户 CRUD（复用 auth::service 中 profile 辅助）
    upload/               # 分片上传（validation/storage/repository）
    engine/               # Bing 搜索建议代理
    markdown/             # Markdown 占位脚手架（未挂载到路由）
    tenant/               # 多租户组织与成员
    subscription/         # 个人租户订阅（免费 / 付费档位）
    gateway/              # 模型网关：转发 / 配额 / 用量 / 审计
    sso/                  # 单点登录（OIDC）
    application/          # 应用入口（挂载 v1 路由）
    agent/                # 服务端 agent 任务（起任务 / 查进度；运行时见 guide/agent-runtime.md）
    rag/                  # rag 索引长任务（起任务 / 查进度；复用 agent 域的入口模式）
  middlewares/            # CORS、AccessLog（Nest Middleware）
  guards/                 # Auth、黑名单、公开路径（Nest Guard）
  interceptors/envelope.rs    # Body / Paginated（Nest Interceptor）
  filters/exception.rs   # Exception（Nest Filter）
  utils/code.rs   # 业务状态码
  oas/                    # utoipa 文档定义（path doc + OpenDoc）
entity/                   # SeaORM Entity（auth / asset / chunk / tenant / tenant_member / subscription / gateway_* / sso_connection）
migration/                # 数据库迁移
http/                     # REST Client 测试文件
guide/                    # 项目指南（人工文档）
spec/                     # OpenAPI 生成物 + cogito↔ai-worker 内部契约（internal.yaml，R11 强制）
```

## 模块文档

每个 `src/services/{name}/` 的职责、路由、数据表与错误码见其 README：

| 模块         | 路由前缀                             | 文档                                                |
| ------------ | ------------------------------------ | --------------------------------------------------- |
| 认证         | `/api/v1/auth`                       | [auth](src/services/auth/README.md)                 |
| 用户(后台)   | `/api/v1/users`                      | [user](src/services/user/README.md)                 |
| 上传         | `/api/v1/upload`                     | [upload](src/services/upload/README.md)             |
| 搜索引擎代理 | `/api/v1/engine`                     | [engine](src/services/engine/README.md)             |
| Markdown     | —（未挂载）                          | [markdown](src/services/markdown/README.md)         |
| 租户         | `/api/v1/tenants`                    | [tenant](src/services/tenant/README.md)             |
| 订阅         | `/api/v1/tenants/{id}/subscriptions` | [subscription](src/services/subscription/README.md) |
| 支付         | `/api/v1/tenants/{id}/orders`        | [payment](src/services/payment/README.md)           |
| 模型网关     | `/api/v1/gateway`                    | [gateway](src/services/gateway/README.md)           |
| 单点登录     | `/api/v1/sso`                        | [sso](src/services/sso/README.md)                   |
| 应用         | `/api/v1/application`                | [application](src/services/application/README.md)   |
| 异常上报     | `/api/v1/exception`                  | [exception](src/services/exception/README.md)       |
| agent 任务   | `/api/v1/agent/tasks`                | [agent](src/services/agent/README.md)               |
| rag 索引任务 | `/api/v1/rag/index-tasks`            | [rag](src/services/rag/README.md)                   |

模块导航（含 HTTP 测试文件）见 [`guide/README.md`](guide/README.md#模块导航)。

## API 文档

- **OpenAPI 规范**：[`spec/openapi.json`](spec/openapi.json)（`cargo run --bin docs` 生成）
- **Swagger UI**：开发环境 `http://127.0.0.1:3000/swagger-ui/`
- **业务错误码**：[`guide/error-codes.md`](guide/error-codes.md)
- **[项目指南](guide/README.md)** — 鉴权、调用顺序、模块导航
- **[数据库表协作](guide/database.md)** — ER 图、auth/asset 字段、跨模块流程

> `cargo doc` 生成 Rustdoc；`cargo run --bin docs` 导出 OpenAPI 规范。

> 导出的规范是**规范序**（所有对象键按升序排列），因此产物字节稳定，CI 可用
> `cargo run --bin docs && git diff --exit-code spec/openapi.json` 做漂移校验；
> 手工编辑 `spec/openapi.json` 会被下一次生成覆盖。

### Apifox 导入

1. Apifox → **导入** → **OpenAPI**
2. 选择以下任一方式：
   - URL：`http://127.0.0.1:3000/api-docs/openapi.json`（需先启动服务并开启 Swagger）
   - 文件：导入 `spec/openapi.json`
3. 配置环境变量（参考 [`http/http-client.env.json`](http/http-client.env.json)）：
   - `baseUrl` / 前置 URL = `http://127.0.0.1:3000`
   - `token` = 登录后从 `POST /api/v1/auth/signin` 的 `data.token` 写入（后置提取）
4. **鉴权组件 `bearer_auth`**：Token 填 `{{token}}`（不要用导入时默认的 `{{bearerToken}}`）
5. 建议开启 Apifox「自动同步」，指向 openapi.json URL

> Apifox 断言请检查 `body.code === 200000`，而非 HTTP status code。  
> OpenAPI 的 `bearer_auth` 已标注 `x-default: {{token}}`；若导入后仍是 `bearerToken`，按上一步手动改一次即可。

| 模块             | 文档                                                                     |
| ---------------- | ------------------------------------------------------------------------ |
| 认证             | [src/services/auth/README.md](src/services/auth/README.md)               |
| 用户(后台)       | [src/services/user/README.md](src/services/user/README.md)               |
| 上传             | [src/services/upload/README.md](src/services/upload/README.md)           |
| 搜索引擎         | [src/services/engine/README.md](src/services/engine/README.md)           |
| 应用             | [src/services/application/README.md](src/services/application/README.md) |
| Markdown（占位） | [src/services/markdown/README.md](src/services/markdown/README.md)       |

## HTTP 测试

使用 VS Code / Cursor **REST Client** 打开 [`http/`](http/) 目录下 `.http` 文件，按注释顺序执行。

## 职责划分

| 场景           | 接口                       |
| -------------- | -------------------------- |
| 用户自助改资料 | `PUT /api/v1/auth/profile` |
| 后台管账号     | `/api/v1/users/*`          |
| 文件/头像上传  | `/api/v1/upload/*`         |
