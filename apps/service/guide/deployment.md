# 部署指南

本地用 Docker Compose 起全栈；生产在构建机打镜像，部署机只 pull。运维探针、配置注入、链路追踪也写在这里。

契约见 [`../spec/openapi.json`](../spec/openapi.json)；配置字段细则见 [`configuration.md`](configuration.md)；API 版本见 [`api-versioning.md`](api-versioning.md)。

---

## 你要做什么

| 场景 | 跳转 |
|------|------|
| 本机第一次起开发栈 | [本地开发](#1-本地开发) |
| 改代码后重建镜像 | [build 与 up](#12-build-与-up) |
| 本机验产 / 真上线 | [生产部署](#3-生产部署) |
| 配密钥、跨域、成对令牌 | [配置从哪来](#2-配置从哪来) |
| K8s / 编排探针 | [运维探针](#4-运维探针) |
| Jaeger / OTel | [链路追踪](#5-链路追踪) |
| 「怎么起不来 / 行为不对」 | [常见误判](#6-常见误判) |

---

## 总览

### 栈里有什么

```text
宿主机 / 内网
├── postgres          业务库 cogito-service + compute（pgvector）
├── redis             会话 / 限流 / JWT 黑名单
├── gocaptcha         验证码侧车
├── migrate           一次性 ./migration up（退）
├── cogito-service        HTTP :3000
├── cogito-worker     outbox 投递
├── cogito-orchestrator  可靠执行（调 compute）
├── compute         Python 叶子计算（仅内网 :8081）
└── jaeger            链路（开发默认起；生产默认不起）
```

### 两套 Compose

| | 开发 | 生产 |
|--|------|------|
| 文件 | `compose.yaml` | `compose.prod.yaml`（**独立**，不叠加） |
| 默认环境 | `development` | `production` |
| 镜像 | 可 `build`；`pull_policy: missing` | **无 `build:`**；必须给三个 `*_IMAGE` |
| 依赖端口 | 对宿主机暴露 | 不暴露（只留 API） |
| Jaeger | 默认起 | `--profile tracing` 才起 |

### 原则：先构建，再部署

Rust 与 Python **同一条路径**——生产机不编译、容器启动不装依赖：

```text
构建机 / CI                      registry                 生产机
cargo → cogito 镜像  ──┐
uv.lock → compute   ┼── push tag ──► 仓库 ──► compose pull + up
postgres 定制镜像     ─┘
```

| 产物 | 构建机 | 生产机绝不做 |
|------|--------|--------------|
| cogito（Rust） | release 二进制进 OCI | `cargo build` |
| compute（Python） | `uv sync --frozen` 烤进 `.venv`（运行层无 uv） | `pip` / `uv sync` |
| postgres | pgvector + zh_CN 定制镜像 | 现场改 Dockerfile |

构建脚本：`docker/build-images.ps1`（Windows）或 `docker/build-images.sh`（Linux / CI）。

---

## 1. 本地开发

工作目录一律仓库根（`compose.yaml` 与 `.env` 都在根）。

### 1.1 第一次起栈

```bash
cp .env.example .env          # 三个凭据无默认值，必须填
# 可选：cp docker/stack.env.example docker/stack.env
docker compose build          # 首次才编译
docker compose up -d
docker compose logs -f cogito-service
```

停止：`docker compose down`。清数据：删 `./data/` 下对应目录后再 `up`（绑定挂载，便于备份）。

### 1.2 build 与 up

`pull_policy: missing`：**有镜像就直接起**，不会每次 `up` 都重编、重下 crates / pip。

| 时机 | 命令 |
|------|------|
| 首次 / 改了 Rust 或 Python | `docker compose build` 或 `up -d --build` |
| 日常起停 | `docker compose up -d` |
| 只起依赖 | `docker compose up -d postgres redis gocaptcha` |

### 1.3 服务一览

| 服务 | 镜像 / 二进制 | 宿主机端口 | 说明 |
|------|---------------|------------|------|
| `postgres` | `cogito-postgres:18-zh-pgvector` | 5432 | 首次 initdb 建 `compute` 库 |
| `redis` | `redis:8-alpine` | 6379 | |
| `gocaptcha` | `wenlng/go-captcha-service:1.0.5` | 8080 | 侧车；compose 关掉了自带 healthcheck |
| `migrate` | cogito 镜像 | — | 跑完即退；api 等它成功 |
| `cogito-service` | cogito 镜像 | 3000 | |
| `cogito-worker` | 同上 | — | |
| `cogito-orchestrator` | 同上 | — | `stop_grace_period: 30s` |
| `compute` | `cogito-compute:local` | 不暴露 | 内网 8081；迁移启动时自 apply |
| `jaeger` | `jaegertracing/jaeger:2.9.0` | 16686 / 4318 | 见 [§5](#5-链路追踪) |

### 1.4 起完自查

```bash
curl -sS http://127.0.0.1:3000/api/live
curl -sS http://127.0.0.1:3000/api/ready
docker compose exec compute curl -fsS http://127.0.0.1:8081/internal/v1/health
docker compose exec postgres psql -U machenike -d postgres -c 'SELECT datname FROM pg_database'
```

### 1.5 平台管理员（Backend Console）

公开注册只有 `USER`；`apps/backend` 要 `ADMIN`。`cogito-service` 启动时按 `auth.bootstrap_admin` **幂等**播种（[`bootstrap/admin.rs`](../src/bootstrap/admin.rs)）：

| profile | 默认 | 说明 |
|---------|------|------|
| `development` | `admin` / `admin123456` | `config.development.yaml` |
| `production` | 关闭 | 用 `COGITO__AUTH__BOOTSTRAP_ADMIN__*` 配真密码 |

写在 `docker/stack.env`（不要写 `.env`）：

```bash
COGITO__AUTH__BOOTSTRAP_ADMIN__USERNAME=admin
COGITO__AUTH__BOOTSTRAP_ADMIN__PASSWORD=<真随机密码>
# COGITO__AUTH__BOOTSTRAP_ADMIN__SYNC_PASSWORD=true   # 改密时开一次，改完关掉
```

改库里的 `role` 后要**重新登录**（新 JWT）。

### 1.6 接线要点（排障用）

- compose 健康检查打 `/api/live`；真正摘流量看 `/api/ready`（见 [§4](#4-运维探针)）。
- `compute` 不对宿主机开端口（长期 `X-Internal-Token`）；验证用 `docker compose exec`。
- `compute` 库迁移不走 `migrate` 服务，自己启动时 apply。
- `gocaptcha` 自检恒失败已禁用；手工：`curl -fsS http://127.0.0.1:8080/status/health`。

---

## 2. 配置从哪来

### 2.1 加载顺序

后者覆盖前者：

`config.yaml` → `config.{profile}.yaml` → `config.local.yaml` → **`COGITO__*` 环境变量**

镜像内只有前三个 profile 文件（与二进制同目录）。容器里的地址与密钥一律环境变量注入：`COGITO__` + 层级 `__`，例如 `COGITO__DATABASE__URL` → `database.url`。

### 2.2 两个 env 文件

都在 `.gitignore`，不入库。

| 文件 | 谁读 | 典型变量 |
|------|------|----------|
| `.env` / `.env.production` | **仅** compose 插值 `${VAR}` | `POSTGRES_PASSWORD`、`COMPUTE_*`、`SERVICE_TOKEN_SECRET`、`APP_ENV`、`*_IMAGE` |
| `docker/stack.env` | 注入 cogito 容器 | `COGITO__EVENTS__ENDPOINT`、`COGITO__CORS__ORIGINS`、`COGITO__SECURITY__*` |

优先级（容器内）：compose 显式 `environment` > `stack.env` > 镜像内 `config*.yaml`。

- 开发：`cp .env.example .env`（三凭据必填，否则 compose 直接报错）。
- 生产：`cp .env.production.example .env.production`。
- `stack.env` 可选：`cp docker/stack.env.example docker/stack.env`。

### 2.3 改配置要不要重建镜像

`config*.yaml` **烤进镜像**。改仓库里的 YAML → 必须 `build` 才生效。不想重建 → 写 `stack.env`（例如 `COGITO__CORS__ORIGINS=http://localhost:9523`）。

`COGITO__*` **空串视为未设置**（不会把密钥抹成空）。要关掉某选项，写关闭值（如 `…=false`），别写空串。

### 2.4 必须成对一致

不一致时常见表现：能起，一请求就 401 / 503。

| 值 | cogito | compute |
|----|--------|-----------|
| 内部共享令牌 | `COGITO__COMPUTE__TOKEN` | `COMPUTE_INTERNAL_TOKEN`（须相同） |
| 服务身份密钥 | `COGITO__GATEWAY__SERVICE_TOKEN_SECRET` | （cogito 验令牌，compute 不配） |
| compute 库 | — | `COMPUTE_DATABASE_URL` → 库名 `compute` |

`gateway.service_token_secret` 为空 → `/api/v1/service/**` 整面 503 → 摄取 / 嵌入全挂。

---

## 3. 生产部署

文件：`compose.prod.yaml`（独立；无 `build:`；强制 `COGITO_IMAGE` / `COMPUTE_IMAGE` / `POSTGRES_IMAGE`）。

### 3.1 本机验产

```bash
cp .env.production.example .env.production   # 凭据 + 三个 IMAGE（可先用 local tag）
cp docker/stack.env.example docker/stack.env # 填 §3.3 清单
./docker/build-images.sh                     # 或 .\docker\build-images.ps1
docker compose -f compose.prod.yaml --env-file .env.production up -d
```

生产栈看链路：加 `--profile tracing`，且 `TELEMETRY_ENABLED=true`。

### 3.2 真部署（只 pull）

**构建机：**

```bash
./docker/build-images.sh --tag 1.2.3 --registry registry.example/cogito --push
```

**部署机**（`.env.production` 写 registry tag；`pull_policy` 是字面量 `missing`，要先 pull）：

```bash
docker compose -f compose.prod.yaml --env-file .env.production pull
docker compose -f compose.prod.yaml --env-file .env.production up -d
```

### 3.3 上线检查清单

1. `APP_ENV=production`（compute：`COMPUTE_ENVIRONMENT=production`）。
2. `.env.production` 三凭据换成随机值（`openssl rand -base64 36`）。改过 Postgres 密码 → `ALTER USER` 或重建 `./data/postgres`。
3. `stack.env`：`COGITO__SECURITY__SECRET` / `COGITO__SECURITY__JWT_SECRET` / `COGITO__GATEWAY__SERVICE_TOKEN_SECRET` 为真随机；占位值（`change-me`、`your-` 等）会被 `validate()` 拒启。
4. `COGITO__EVENTS__ENDPOINT` 非空（否则 worker 拒启，事件永远压在 outbox）。
5. 验证码开启、`otp.mock=false`（生产 profile 已是安全默认）。
6. `./data/*` 与日志纳入备份；`docker compose down -v` 会删数据。

---

## 4. 运维探针

三者**免鉴权**，且不带 `/api/v1` 前缀（运维语义不随业务版本变）。

### 4.1 各回答什么

| 端点 | 问题 | HTTP | 用途 |
|------|------|------|------|
| `GET /api/live` | 进程还在跑吗 | **恒 200** | liveness（不行就重启） |
| `GET /api/ready` | 现在能接流量吗 | 200 / **503** | readiness（摘 / 放流量） |
| `GET /api/health` | 依赖各自怎样 | **恒 200** | 人工排查、看板 |

- **liveness 不探依赖**：依赖挂了重启本进程无用，只会放大成重启风暴。
- **health 恒 200**：给人看全景；可用性用 `/api/ready` 的状态码。

### 4.2 关键 vs 非关键

判定：**缺了它，是不是所有请求都无法正确服务。**

| 依赖 | 关键 | 缺失后果 | 判定 |
|------|------|----------|------|
| PostgreSQL | 是 | 读写全线失败 | `ping` → up / down |
| Redis | 是 | 鉴权入口不可用 | `ping` → up / down |
| compute | 否 | 仅 RAG 等长任务 | 未配置 → `unconfigured`；已配置则探 `/internal/v1/health`（2s） |

- 关键任一故障 → ready **503**，`code = 100002`，`msg` 点名（如 `依赖未就绪：postgres`）。
- 仅非关键异常 → **200**，`data.status = degraded`，照常接流量。
- `data.checks[].critical` 自述是否关键。生产环境 ready 不回完整调试 `details`。

### 4.3 响应示例

`GET /api/live`：

```json
{ "code": 200000, "success": true, "msg": "服务进程存活", "data": { "status": "alive", "version": "0.1.0", "timestamp": 1739000000000 } }
```

`GET /api/ready`（就绪）：

```json
{
  "code": 200000,
  "success": true,
  "msg": "依赖全部就绪",
  "data": {
    "status": "ready",
    "version": "0.1.0",
    "timestamp": 1739000000000,
    "checks": [
      { "name": "postgres", "critical": true, "status": "up" },
      { "name": "redis", "critical": true, "status": "up" },
      { "name": "compute", "critical": false, "status": "unconfigured", "detail": "未配置 compute.base_url" }
    ]
  }
}
```

`GET /api/ready`（关键依赖挂）：

```json
{ "code": 100002, "success": false, "msg": "依赖未就绪：redis", "data": null }
```

### 4.4 编排接线

```yaml
startupProbe:   { httpGet: { path: /api/ready, port: 3000 }, failureThreshold: 30, periodSeconds: 2 }
livenessProbe:  { httpGet: { path: /api/live,  port: 3000 }, periodSeconds: 10 }
readinessProbe: { httpGet: { path: /api/ready, port: 3000 }, periodSeconds: 10 }
```

| 错误接法 | 后果 |
|----------|------|
| live → readiness | 永远 200，摘不掉坏实例 |
| ready → liveness | 依赖抖动 → 滚动重启风暴 |
| health → 摘流量 | 恒 200，坏实例留在 LB |

### 4.5 边界

- 探针不缓存；ready 对 compute 每次现建客户端（2s），略贵于 health。
- 路径在 OpenAPI `System` tag；面向公网时建议只暴露给编排器内网。

---

## 5. 链路追踪

cogito（Rust 三进程）与 compute（Python）共用 OTel；开发栈默认打到 compose 里的 Jaeger（OTLP `:4318`，UI `:16686`）。前端带 `traceparent` 时可看到 **Rust → Python → Rust** 整树。

### 5.1 开关

| 变量（`.env` 插值） | 作用 | 开发默认 |
|---------------------|------|----------|
| `TELEMETRY_ENABLED` | 同时喂两端 | `true` |
| `OTLP_ENDPOINT` | 基址即可（自动补 `/v1/traces`） | `http://jaeger:4318` |

- 服务名不用手配：`cogito-{api,worker,orchestrator}`、`cogito-compute`。
- 关掉：`TELEMETRY_ENABLED=0`（或写 `.env`）。关闭零开销；响应里的 `traceID` / `traceparent` 仍在。
- 只起依赖、没有 Jaeger：导出打警告，**不阻塞业务**。

### 5.2 冒烟（跨语言一跳）

`compute` 无宿主机端口，从容器内打。期望业务上可能 400（租户不存在），**只要跨过 Python → Rust 且 Jaeger 两侧有 span 即通过**。

```bash
docker compose build cogito-service compute
docker compose up -d jaeger cogito-service cogito-worker cogito-orchestrator compute

docker compose exec -T compute sh -c 'curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $COMPUTE_INTERNAL_TOKEN" \
  -H "Idempotency-Key: smoke-trace-0001" \
  -H "traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" \
  -d "{\"schemaVersion\":1,\"tenantID\":\"4bf92f35-77b3-4da6-a3ce-929d0e0e4736\",\"mime\":\"text/plain\",\"name\":\"trace-smoke.txt\"}" \
  http://127.0.0.1:8081/internal/v1/assets/4bf92f35-77b3-4da6-a3ce-929d0e0e4736/chunks'
```

查 trace：

```bash
curl -sS 'http://127.0.0.1:16686/api/traces/4bf92f3577b34da6a3ce929d0e0e4736' \
  | python -c "import json,sys; d=json.load(sys.stdin)['data'][0]; print(d['traceID']); print(sorted({p['serviceName'] for p in d['processes'].values()}))"
```

期望同 trace 下同时有 `cogito-compute` 与 `cogito-service`。UI：<http://127.0.0.1:16686>。

orchestrator → compute 那一跳要真实 RAG + 凭据，不适合当冒烟；传播逻辑与上面相同。

---

## 6. 常见误判

| 现象 | 原因 / 处理 |
|------|-------------|
| 改了代码 `up` 行为不变 | `pull_policy: missing` 故意不重建 → `build` 或 `up --build`；`docker image inspect … Created` |
| 首次起很慢（1–2 分钟） | 空 `./data` 要 initdb + migrate + compute 迁移；之后 `up` 约 30s。对应 startupProbe 宽限 |
| 容器里打不开 `/guide/*.md` | 镜像故意不带文档，只留空目录给静态挂载；看仓库 [guide/](.) |
| live 通但没有 trace | 改 telemetry 后没 rebuild |
| Jaeger 只有 compute、cogito 无 span | 导出器用了异步 reqwest，批处理线程 panic；须 `reqwest-blocking-client` |
| Jaeger 空、日志有导出失败 | 内存存储，`restart jaeger` 会清空；采样默认 1.0 |
| 冒烟回 400 不是 404 | body / `Idempotency-Key` / UUID 校验在链路之后，400 仍可验 trace |
| 能起但请求 401/503 | [成对令牌](#24-必须成对一致) 不一致，或 `service_token_secret` 为空 |
