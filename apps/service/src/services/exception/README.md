# Exception 模块（异常上报）

客户端运行时异常上报与平台运维查询。路由前缀 `/api/v1/exception`。

与 `filters::Exception`（HTTP 错误信封）无关：本模块是业务「异常事件」表。

## 路由一览

| 方法 | 路径 | 鉴权 | 说明 |
| ---- | ---- | ---- | ---- |
| POST | `/` | 可匿名（可选 JWT） | 客户端上报 |
| GET | `/` | 平台 ADMIN | 事件列表（筛选 + 分页） |
| GET | `/groups` | 平台 ADMIN | 按 fingerprint 聚合 Issue |
| GET | `/sources` | 平台 ADMIN | 去重 source 列表 |
| GET | `/summary` | 平台 ADMIN | total / byLevel / bySource |
| GET | `/{id}` | 平台 ADMIN | 单条详情（库内 `id`） |
| DELETE | `/{id}` | 平台 ADMIN | 硬删除 |

## 鉴权

- **上报**：`Auth::isRequired()` + [`public.rs`](../../guards/public.rs) 白名单 `POST /api/v1/exception`。无 Bearer 放行；有 Bearer 则注入 Session，body 未带 `userID` 时回填 `session.user_id`。
- **列表 GET**：与 POST 同 resource（`Auth::isRequired`），handler 内再验平台 `Account.Manage`（与 `Auth::admin()` 同权）。
- **其余管理**：逐条 `Auth::admin()` + `PlatformScope`。

## 数据表

`exception`：平台表，RLS 恒假（与 `console_preference` / `billing_price` 同形）。

| 列 | 说明 |
| ---- | ---- |
| `id` | 库内主键（服务端 UUID） |
| `eventID` | 对外事件 ID（客户端生成，unique） |
| `fingerprint` | 聚合指纹 |
| `source` / `level` / `message` / `url` / … | 对齐 Node ExceptionEntity |
| `timestamp` | 发生时间（毫秒） |
| `receivedAt` | 入库时间 |
| `creator` | 可选；有 Session 时写入 |

事件不可变：无 `updatedAt` / `updater`。

## 业务规则

- Fingerprint：客户端传入则截断 64；否则 `sha256(message\|url\|status).hex[..64]`
- 无 upsert；重复 `eventID` → `DUPLICATE_DATA`
- `groups` / `summary` 故意忽略 query 中的 `fingerprint`
- 缺省 `source=client`、`level=error`；缺省 `environment` 用 `app.env`

## 实现架构

```
Controller → PlatformScope::open → ExceptionService → entity::exception
```
