# 部署与运维探针

本文件说明 cogito 服务对外暴露的三个运维端点及其编排含义。契约本身见 `spec/openapi.json`（生成物），
版本策略见 [`api-versioning.md`](api-versioning.md)。

## 1. 三个端点各回答什么问题

| 端点 | 回答的问题 | HTTP 状态 | 用在哪里 |
|------|-----------|-----------|----------|
| `GET /api/live` | 进程还在跑吗 | **恒 200** | `livenessProbe`（实在不行就重启） |
| `GET /api/ready` | 现在能接流量吗 | 200 / **503** | `readinessProbe`（从负载均衡里摘掉/放回） |
| `GET /api/health` | 各依赖现在什么状态 | **恒 200** | 人工排查、看板、值班巡检 |

三者都不需要鉴权，都不带 `/api/v1` 版本前缀（运维语义不随业务版本变化）。

**为什么 liveness 不碰依赖**：依赖故障时重启本进程毫无帮助，只会把「一次故障」放大成「反复重启」。
liveness 只证明事件循环还在转；依赖坏了由 readiness 摘流量，由值班修依赖。

**为什么 health 恒 200**：它是给人看的依赖全景。探针化改造前它就是这么用的（异常只体现在
`data.status=degraded`），这条既有契约保持不变；用 HTTP 状态码表达可用性的是 `/api/ready`。

## 2. 关键依赖与非关键依赖

「关键」的判定标准只有一条：**缺了它，是不是所有请求都无法正确服务**。

| 依赖 | 关键 | 缺失后果 | 探针判定 |
|------|------|----------|----------|
| PostgreSQL | ✅ | 连接池一断，读写全线失败；两个二进制启动即 `expect` 它 | `ping()`：`up` / `down` |
| Redis | ✅ | JWT 黑名单、验证码/OTP 挑战与限流、网关日配额计数、订阅档位缓存都在它上面，鉴权入口直接不可用 | `ping()`：`up` / `down` |
| ai-worker（Python） | ❌ | 只影响 RAG 长任务 | 未配置 → `unconfigured`（不算故障）；配了就按 2s 超时探 `/internal/v1/health` |

- 关键依赖任一故障 → `/api/ready` 返回 **503**，`code = 100002`（`system.SERVICE_UNAVAILABLE`），
  `msg` 点名故障项（例：`依赖未就绪：postgres`）。
- 仅非关键依赖异常 → **200**，`data.status = degraded`，**照常接流量**。
- 每条判定随响应自述：`data.checks[].critical`，运维侧不必对着本文档猜。

`/api/ready` 的 `details` 只在非生产环境返回完整快照（统一约定：生产不回调试细节）。

## 3. 响应示例

`GET /api/live`：

```json
{ "code": 200000, "success": true, "msg": "服务进程存活", "data": { "status": "alive", "version": "0.1.0", "timestamp": 1739000000000 } }
```

`GET /api/ready`（全部就绪）：

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
      { "name": "ai-worker", "critical": false, "status": "unconfigured", "detail": "未配置 ai_worker.base_url" }
    ]
  }
}
```

`GET /api/ready`（关键依赖故障）：

```json
{ "code": 100002, "success": false, "msg": "依赖未就绪：redis", "data": null }
```

## 4. 编排接线

一次最小接线（K8s 语义，compose 等编排器同理）：

```yaml
startupProbe:   { httpGet: { path: /api/ready, port: 3000 }, failureThreshold: 30, periodSeconds: 2 }
livenessProbe:  { httpGet: { path: /api/live,  port: 3000 }, periodSeconds: 10 }
readinessProbe: { httpGet: { path: /api/ready, port: 3000 }, periodSeconds: 10 }
```

- **不要**把 `/api/live` 配成 `readinessProbe`：它永远 200，摘不掉坏实例。
- **不要**把 `/api/ready` 配成 `livenessProbe`：依赖抖动会变成滚动重启风暴。
- **不要**把 `/api/health` 当摘流量判据：它恒 200，用它判断是把坏实例留在负载均衡里。

## 5. 已知边界

- 探针不缓存结果，每次请求都真探依赖；`/api/ready` 对 ai-worker 每次现建 HTTP 客户端
  （2s 超时），因此它比 `/api/health` 贵一点，仍属于同一量级。
- 探针路径在同一份 OpenAPI 里公开（tag `System`），便于契约漂移门禁覆盖；暴露探测结果
  不构成信息泄露（无业务数据），但若面向公网，建议只在编排器可达的内网端口暴露。

## 6. 全栈一键起（`apps/cogito/docker-compose.yml`）

本文件描述的是「进程怎么被编排」，落地形态就在仓库里的 compose：依赖三个
（Postgres+pgvector / Redis / go-captcha）+ 后端四个进程
（cogito-api / cogito-worker / cogito-orchestrator / ai-worker），外加一个 Jaeger 收链路，一条命令起齐。

```bash
cd apps/cogito
cp .env.example .env          # 首次：compose 的三个凭据变量没有默认值，必须给
$EDITOR .env                  # 本机开发可直接用样例里的值
docker compose up -d          # 全栈
docker compose logs -f cogito-api
docker compose down
```

手动（不走容器）时的对应关系，供对照排障：

| compose 服务 | 二进制 / 镜像 | 端口 | 说明 |
|--------------|---------------|------|------|
| `postgres` | `cogito-postgres:18-zh-pgvector` | 5432 | 带 pgvector 与 zh_CN locale，首次 initdb 会建 `ai_worker` 库 |
| `redis` | `redis:8-alpine` | 6379 | 会话/限流/幂等/JWT 黑名单 |
| `gocaptcha` | `wenlng/go-captcha-service:1.0.5` | 8080 | 侧车，不是 cogito |
| `migrate` | cogito 镜像 | — | 一次性 `./migration up`，跑完即退（cogito-api 等它成功） |
| `cogito-api` | cogito 镜像 | 3000 | `./cogito` |
| `cogito-worker` | cogito 镜像 | — | `./worker`，outbox 投递 |
| `cogito-orchestrator` | cogito 镜像 | — | `./orchestrator`，可靠执行运行时 |
| `ai-worker` | `cogito-ai-worker:local` | 8081（仅内网） | `./migration up` 由它自己启动时 apply |
| `jaeger` | `jaegertracing/jaeger:2.9.0` | 16686 / 4318 | 链路后端（可省），见 §9 |

接线要点（都和上面的探针约定对应）：

- `cogito-api` 的健康检查打 `/api/live`（进程活着），`depends_on` 用 `migrate: service_completed_successfully`
  ——迁移没成功就不该放它接流量。真正的「能不能接流量」由 `readinessProbe` 打 `/api/ready` 决定。
- `cogito-orchestrator` 的 `stop_grace_period: 30s` 必须大于 `durable.shutdown_grace_ms`（默认 5000），
  否则停机时在跑的活动会被硬杀。
- `ai-worker` **不对宿主机发布端口**：它的 `X-Internal-Token` 是长期共享密钥，只在内网可达即可。
  想单独验证它：`docker compose exec ai-worker curl -fsS http://127.0.0.1:8081/internal/v1/health`。
- `ai-worker` 的迁移**不由 `migrate` 服务负责**：它在自己库上启动时自动 apply（`apps/ai-worker/src/ai_worker/db.py`），
  所以探针在 DB 不可用时回 503 而不是崩掉。
- `gocaptcha` 关掉了 healthcheck（compose 里 `healthcheck: disable: true`）。该镜像是 distroless（无
  sh/curl/wget），镜像自带的自检 `--health-check` 在 1.0.5 里恒失败：它少传参数，且要求
  `/status/health` 返回 404 而实际返回 200。留着只会永远显示 unhealthy 掩盖真问题；
  要手工确认它活着：`curl -fsS http://127.0.0.1:8080/status/health`。`cogito-api` 对它只要求
  `service_started`，不依赖它的健康态。

### 6.1 起完自查（4 条命令）

```bash
curl -sS http://127.0.0.1:3000/api/live                       # 进程活着
curl -sS http://127.0.0.1:3000/api/ready                      # 三个依赖 + ai-worker 全部 up
docker compose exec ai-worker curl -fsS http://127.0.0.1:8081/internal/v1/health
docker compose exec postgres psql -U machenike -d postgres -c 'SELECT datname FROM pg_database'
```

### 6.1.1 默认平台管理员（Backend Console）

公开注册只会建 `USER`，`apps/backend` 全挂 `Auth::admin()`，没有首个 `ADMIN` 就进不了管理面。

`cogito-api` 启动时按 `auth.bootstrap_admin` **幂等**就位平台管理员（见 [`bootstrap/admin.rs`](../src/bootstrap/admin.rs)）：

| profile | 默认账号 | 说明 |
|---------|----------|------|
| `development`（compose 默认） | `admin` / `admin123456` | 写在 `config.development.yaml` |
| `production` | 关闭（空用户名） | 必须用 `COGITO__AUTH__BOOTSTRAP_ADMIN__*` 显式配置真密码 |

覆盖示例（写 `docker/stack.env`，不要写 `.env`）：

```bash
COGITO__AUTH__BOOTSTRAP_ADMIN__USERNAME=admin
COGITO__AUTH__BOOTSTRAP_ADMIN__PASSWORD=<真随机密码>
# 仅当需要把已有账号的密码改成配置值时开一次，改完关掉
# COGITO__AUTH__BOOTSTRAP_ADMIN__SYNC_PASSWORD=true
```

改完库里的 `role` 后仍要用**新签发的令牌**（重新登录）：`Auth::admin()` 会先按 JWT 声明快速拒绝。

### 6.2 一个容易误判的现象

- **首次冷启动慢**：全栈从零（`./data` 为空）起齐要等 Postgres 首次 initdb、`migrate` 跑完，
  以及 ai-worker 首次在自己库上 apply 迁移，大约 1–2 分钟；之后 `down` 再 `up` 约 30 秒就
  `/api/live` 200。这就是 §4 里 `startupProbe` 给 30×2s 宽限的原因，别把冷启动慢当成卡死。
- **容器里 `/guide/*.md` 打不开**：这是故意的——镜像只装二进制与 `config*.yaml`，不放仓库文档
  （`docker/cogito/Dockerfile` 里建的是空 `guide/` 目录，只为了不让 actix 在构造静态挂载时报
  `Specified path is not a directory`）。看文档直接看仓库里的 [guide/](.)。

## 7. 配置从哪来：文件 → 环境变量

加载顺序（后者覆盖前者）：`config.yaml` → `config.{profile}.yaml` → `config.local.yaml` → **`COGITO__*` 环境变量**。

镜像里**只有** `config.yaml` / `config.development.yaml` / `config.production.yaml`
三个文件，且和二进制同目录（`configures/src/loader.rs` 按可执行文件所在目录找配置）。
容器态的地址与密钥全部由环境变量注入，键名规则：`COGITO__` 前缀 + 层级用 `__` 分隔，
例：`COGITO__DATABASE__URL` → `database.url`、`COGITO__SERVER__PORT` → `server.port`。

两个放环境变量的位置（都在 `apps/cogito/.gitignore` 里，不入库）：

| 文件 | 作用 | 例子 |
|------|------|------|
| `apps/cogito/.env` | 只参与 compose 的 `${VAR}` 插值 | `POSTGRES_PASSWORD`、`AI_WORKER_INTERNAL_TOKEN`、`SERVICE_TOKEN_SECRET`、`APP_ENV` |
| `apps/cogito/docker/stack.env` | 直接注入 cogito 容器的额外 `COGITO__*` | `COGITO__EVENTS__ENDPOINT`、`COGITO__CORS__ORIGINS`、`COGITO__LOGGING__FORMAT` |

`apps/cogito/.env` 是**必建**的：`cp .env.example .env`，三个凭据变量（`POSTGRES_PASSWORD`、
`AI_WORKER_INTERNAL_TOKEN`、`SERVICE_TOKEN_SECRET`）刻意没有默认值，缺任何一个 compose 直接报错退出，
不会被弱默认值悄悄顶上。`docker/stack.env` 可选：`cp docker/stack.env.example docker/stack.env`。
优先级：compose 里显式写的 `COGITO__*` > `stack.env` > 镜像内的 `config*.yaml`。

配置是**烤进镜像**的（`docker/cogito/Dockerfile` 里 `COPY config.yaml config.development.yaml config.production.yaml /app/`）：
改了仓库里的 `config*.yaml` 必须重建镜像才生效，否则容器跑的还是旧值（看起来像「改了没用」）。
不想重建就写 `stack.env`，例如跨域：`COGITO__CORS__ORIGINS=http://localhost:9523`（列表用逗号分隔）。

`COGITO__*` 环境变量的**空串视为未设置**（`configures/src/loader.rs` 的 `ignore_empty(true)`）：
编排里 `${VAR}` 展开成空串不会把配置清空，也就不会把密钥悄悄抹成空串。
要「关掉」某个可选项，用它的关闭值（例如 `COGITO__GATEWAY__AUDIT_ENABLED=false`），别用空串。

三处**必须成对一致**的值，不一致的表现往往是「能起但一发请求就 401/503」：

| 值 | cogito 侧 | ai-worker 侧 |
|----|---------|--------------|
| 内部共享令牌 | `ai_worker.token`（= `COGITO__AI_WORKER__TOKEN`） | `AI_WORKER_INTERNAL_TOKEN` |
| 服务身份密钥 | `gateway.service_token_secret` | 无需配置（cogito 用它验令牌） |
| ai-worker 库 | 不涉及（cogito 不连它） | `AI_WORKER_DATABASE_URL` 必须指向 `ai_worker` 库 |

`gateway.service_token_secret` 为空 = `/api/v1/service/**` 整体 503，
表现就是 ai-worker 的摄取/嵌入全部失败（它换不到服务令牌）。

## 8. 切到生产要改什么

1. `APP_ENV=production`（compose 里 `COGITO__APP__ENV` 随之切换；ai-worker 用 `AI_WORKER_ENVIRONMENT`）。
2. `apps/cogito/.env` 里那三个凭据换成随机值（`openssl rand -base64 36`）：
   `POSTGRES_PASSWORD`、`AI_WORKER_INTERNAL_TOKEN`、`SERVICE_TOKEN_SECRET`。
   改 Postgres 密码后需 `ALTER USER` 或重建 `./data/postgres`。
3. `COGITO__SECURITY__SECRET` / `COGITO__SECURITY__JWT_SECRET` /
   `COGITO__GATEWAY__SERVICE_TOKEN_SECRET` 必须是真随机值：生产下占位值（含 `change-me`、
   `your-` 前缀等）会被 `validate()` 直接拒绝启动，空串也已被拦下
   （`security.secret` / `security.jwt_secret` 都不允许为空）。
   `COGITO__AI_WORKER__TOKEN` 的占位值由 `orchestrator` 启动时拒绝。
4. `COGITO__EVENTS__ENDPOINT` 不能为空：`worker` 二进制在 production 下启动即校验；
   留空等于让事件永远压在 outbox 里。
5. `auth.captcha.enabled` 必须为 `true`、`otp.mock` 强制为 `false`（生产校验项，配置文件里已是安全值）。
6. 数据目录（`./data/*`）与日志要纳入备份策略；`docker compose down -v` 会连数据一起删。

## 9. 链路追踪联调

cogito 的三个进程（Rust）与 ai-worker（Python）都接了 OpenTelemetry，导出目标是 compose 里的
`jaeger`（OTLP/HTTP `:4318`，界面 `:16686`）。前端（studio）会随请求带 `traceparent`，
所以一次操作能看到完整的 **Rust → Python → Rust** 调用树。

### 9.1 开关与端点

| 变量（`apps/cogito/.env`，参与 compose 插值） | 作用 | 默认 |
|---------------------------------------------|------|------|
| `TELEMETRY_ENABLED` | 同时喂 cogito 的 `COGITO__TELEMETRY__ENABLED` 与 ai-worker 的 `AI_WORKER_TELEMETRY_ENABLED` | `true` |
| `OTLP_ENDPOINT` | 同时喂 cogito 的 `COGITO__TELEMETRY__ENDPOINT` 与 ai-worker 的 `AI_WORKER_TELEMETRY_ENDPOINT` | `http://jaeger:4318` |

- **端点写基址即可**：两端都会自动补 `/v1/traces`，写成带路径的完整地址也没问题。
- **服务名不用手配**：cogito 按进程拼成 `cogito-{api,worker,orchestrator}`，
  ai-worker 是 `cogito-ai-worker`。同一个二进制跑出不同进程，看服务名就能分清谁发的 span。
- **关掉**：`TELEMETRY_ENABLED=0 docker compose up -d cogito-api cogito-worker cogito-orchestrator ai-worker`
  （或写进 `.env`）。关闭时是零开销：不建导出器、不入全局 Provider，trace-id 退回内置的 W3C 实现，
  **响应信封的 `traceID` 与响应头 `traceparent` 照旧**，所以关链路不会破坏前端的错误上报。
- **只起依赖**（`up -d postgres redis gocaptcha`）时 Jaeger 不在，导出侧只会打警告，
  请求本身不受影响——链路导出失败永远不阻塞业务。

### 9.2 冒烟：一次请求打穿两种语言

`ai-worker` 不对宿主机发布端口，所以从它容器内部发起。`POST /internal/v1/assets/{id}/chunks`
会让 ai-worker 回头调 cogito（先换服务身份令牌，再取资产正文），这一跳正好是「Python → Rust」。

```bash
cd apps/cogito
docker compose build cogito-api ai-worker      # 首次或改了 telemetry 代码后必须重建：镜像里才有 OTel
docker compose up -d jaeger cogito-api cogito-worker cogito-orchestrator ai-worker

# 用固定 trace-id 发起，省得去 Jaeger 里翻
# 注意两点：-T 不加 TTY；包一层 sh -c '...' 才能让 $AI_WORKER_INTERNAL_TOKEN 在容器里展开
docker compose exec -T ai-worker sh -c 'curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $AI_WORKER_INTERNAL_TOKEN" \
  -H "Idempotency-Key: smoke-trace-0001" \
  -H "traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" \
  -d "{\"schemaVersion\":1,\"tenantID\":\"4bf92f35-77b3-4da6-a3ce-929d0e0e4736\",\"mime\":\"text/plain\",\"name\":\"trace-smoke.txt\"}" \
  http://127.0.0.1:8081/internal/v1/assets/4bf92f35-77b3-4da6-a3ce-929d0e0e4736/chunks'
```

这个租户不存在，所以会拿到 **400**（`换取服务身份令牌失败`）——**不影响验证**：请求已经跨过
Python → Rust 两个进程边界了，Jaeger 里能看到两边的 span。想更进一步确认传播，可以再直接打一次
cogito（同样会失败，但响应信封的 `traceID` 会原样回显注入的 trace-id）：

```bash
docker compose exec -T ai-worker sh -c 'curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $AI_WORKER_INTERNAL_TOKEN" \
  -H "Idempotency-Key: smoke-trace-0002" \
  -H "traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01" \
  -d "{\"schemaVersion\":1,\"tenantID\":\"4bf92f35-77b3-4da6-a3ce-929d0e0e4736\",\"mime\":\"text/plain\",\"name\":\"trace-smoke.txt\"}" \
  http://cogito-api:3000/internal/v1/assets/4bf92f35-77b3-4da6-a3ce-929d0e0e4736/chunks'
# 期望：{"code":400001,...,"traceID":"0af7651916cd43dd8448eb211c80319c",...}
```

查链路（用上面对应的 trace-id）：

```bash
curl -sS 'http://127.0.0.1:16686/api/traces/4bf92f3577b34da6a3ce929d0e0e4736' \
  | python -c "import json,sys; d=json.load(sys.stdin)['data'][0]; print(d['traceID']); print(sorted({p['serviceName'] for p in d['processes'].values()}))"
```

期望输出里同时有 `cogito-ai-worker` 与 `cogito-api`，且是**同一个 traceID**；
Jaeger 里 ai-worker 的 `POST /api/v1/service/token`（客户端 span）会挂在 cogito-api 同名服务端 span 上，
父子关系跨语言成立。浏览器里看更直观：<http://127.0.0.1:16686> → Service 选 `cogito-api`
→ Find Traces → 点开那条 trace，能看到 span 的父子关系与耗时瀑布。

Rust 内部那一跳（cogito 的 orchestrator → ai-worker）只在真实 RAG 工作流里发生，需要资产与供应商凭据，
不适合当冒烟用例；它和上面这条链路用的是同一套传播逻辑（入/出站统一注入 `traceparent`）。

### 9.3 四个容易误判的现象

- **`/api/live` 通、却查不到 trace**：先确认镜像是不是重建过——改动 telemetry 代码后不
  `build` 就 `up -d`，跑的还是旧镜像（`docker image inspect` 看 Created 时间）。
- **Jaeger 里只有 `cogito-ai-worker`，cogito 侧一根 span 都没有**：翻 cogito-api 日志找
  `thread 'OpenTelemetry.Traces.BatchProcessor' panicked ... there is no reactor running`。
  这是导出器选了**异步** HTTP 客户端（`opentelemetry-otlp` 的 `reqwest-client`）而批处理器跑在
  独立线程上的症状：第一次导出就把批处理器线程打死，之后每个 span 只留下一条
  `BatchSpanProcessor.OnEnd.AfterShutdown ... Spans will not be exported`。Cargo 特性必须是
  `reqwest-blocking-client`——「导出失败不阻塞业务」的前提是线程还活着。
- **Jaeger 界面空的、日志里有导出失败**：默认存储是内存，`docker compose restart jaeger` 会清空历史；
  另外采样率默认 1.0（`COGITO__TELEMETRY__SAMPLE_RATIO`），开发期不会漏采。
- **冒烟请求回 400 而不是 404**：内部接口的 body 必填 `schemaVersion`/`tenantID`/`mime`
  （`extra="forbid"`，多写字段也 400），头必带 `Idempotency-Key`（长度 8–200），且 `tenantID`
  必须是合法 UUID。这些校验发生在链路之后，所以报了 400 也不影响 trace 验证。

