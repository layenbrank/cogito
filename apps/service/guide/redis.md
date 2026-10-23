# Redis 接入指南

> **状态：已落地**
> **推荐开发依赖**：`docker compose up -d`（先在仓库根 `cp .env.example .env`，见 [`compose.yaml`](../../../compose.yaml)）。

注入方式：

```
Configure::load → RedisPool → Arc → bootstrap_app! → web::Data
```

实现位置：

| 组件 | 路径 |
|------|------|
| Redis 客户端 | [`src/clients/redis.rs`](../src/clients/redis.rs) |
| 配置 | [`configures/src/configure.rs`](../configures/src/configure.rs) |
| 启动注入 | [`src/bin/service.rs`](../src/bin/service.rs)、[`src/lib.rs`](../src/lib.rs) |
| JWT 黑名单 | [`src/guards/blacklist.rs`](../src/guards/blacklist.rs)、`POST /api/v1/auth/signout` |

---

## 依赖

```toml
fred = { version = "10", features = ["enable-rustls", "partial-tracing"] }
```

---

## 配置

| YAML 键 | 环境变量 | 默认 | 说明 |
|---------|----------|------|------|
| `redis.url` | `COGITO__REDIS__URL` | `redis://127.0.0.1:6379` | 连接串 |
| `redis.pool_size` | `COGITO__REDIS__POOL_SIZE` | `8` | fred 池大小（下限 1） |

启动时 **fail-fast**：`RedisPool::new` 会 `init` + `ping`，连不上则 `cogito` 进程直接退出（与 PostgreSQL 一致）。

运行期带**重连**：连接池显式设置了 `ReconnectPolicy`（默认每 1s 重试、永不放弃）。
fred 的 `Builder` 不会自动套用默认值——其 `policy` 为 `None` 时 `should_reconnect()` 返回 `false`，
即**不设就等于完全关闭重连**（连接断开后池永久空转、命令一直排队）。所以这里必须显式设置，
详见 `src/clients/redis.rs`。有此策略后 redis 容器重建/重启，进程会自行恢复，无需重启服务。

### 本机联调（Docker）

```powershell
Copy-Item .env.example .env      # compose 的三个凭据变量是必填的
docker compose up -d
docker compose ps
docker exec cogito-redis redis-cli PING
# 应用连宿主机映射端口，见 config.yaml / config.local.yaml
```

---

## 业务能力

Redis 只承担「跨进程共享的短生命周期状态」；权威数据一律在 PostgreSQL（Redis 丢失只影响会话态与计数，不丢业务事实）。

| 用途 | 键 | 位置 |
|------|-----|------|
| JWT 黑名单 | `auth:jwt:bl:{sha256(token)}`，TTL = 令牌剩余有效期 | [`guards/blacklist.rs`](../src/guards/blacklist.rs) |
| 验证码 IP 限流 | `auth:captcha:rate:{ip}`，固定窗口 60s | [`services/auth/captcha.rs`](../src/services/auth/captcha.rs) |
| OTP 挑战 | `auth:otp:{purpose}:{channel}:{target}`，另有 `:rate:` / `:fail:` 冷却与失败计数 | [`services/auth/otp.rs`](../src/services/auth/otp.rs) |
| 网关日配额计数 | `gateway:quota:{scope}:{id}:{yyyy-mm-dd}`，按 UTC 午夜重置 | [`services/gateway/quota.rs`](../src/services/gateway/quota.rs) |
| 订阅档位缓存 | `gateway:plan:{tenantID}`（60s），开通/取消订阅时立即失效 | [`services/subscription/service.rs`](../src/services/subscription/service.rs) |
| OIDC 流程态 | `sso:state:{state}` → `nonce`，短 TTL | [`services/sso/service.rs`](../src/services/sso/service.rs) |

### JWT 黑名单

1. `POST /api/v1/auth/signout`（需 JWT）→ `SET auth:jwt:bl:{sha256(token)}` + TTL=剩余有效期
2. `Auth` 在校验签名后查询黑名单；命中则拒绝

### 健康检查

`GET /api/health` 返回 `postgres` / `redis` 状态字段（恒 200，异常只体现在 `data.status`）。
`GET /api/ready` 复用同一批探测并按「关键依赖」判定能否接流量：Redis 与 PostgreSQL 是关键依赖，
故障即 503；compute 只是 `degraded`，不摘流量。运维含义见 [`deployment.md`](deployment.md)。

---

## 与 `engine` 模块边界

[`engine`](../src/services/engine/README.md) 代理外部搜索 HTTP API；检索能力（向量 / 全文）归 Python 的 compute，
cogito 不持有检索引擎客户端。
