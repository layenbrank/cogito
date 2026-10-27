# 定时任务（服务端排期）

路由前缀：`/api/v1/automations`

## 概述

把一句话的目标按 cron 定时起成一次 **agent 任务**。特点是**关掉客户端也会跑**：排期、认领、起任务
全在服务端，由 `worker` 进程的调度循环驱动（[`worker/scheduler.rs`](../../worker/scheduler.rs)），
跑起来的仍是同一套 agent 编排，配额、计量、审计照旧走网关。

| 能力   | 说明                                                                   |
| ------ | ---------------------------------------------------------------------- |
| 建/改删 | 纯 CRUD；cron 与时区在**保存时**校验，`nextRunAt` 由服务端算            |
| 认领   | worker 每轮取到期任务，CAS 推进 `nextRunAt`，认领即落 `lastStatus=running` |
| 起任务 | 以任务声明的身份进租户 → 建 agent 台账 → 提交 → 起编排实例              |
| 回写   | 起成功写 `succeeded`+`lastTaskID`，起失败写 `failed`+`lastError`        |

**与客户端 `automation` 域的关系**：客户端那份是「本机 / goose 调度器」的本地排期（SQLite 表
`automation`），关掉客户端就不跑；这里是「服务端排期」（`scheduled_job`），与客户端无关。
两边字段语义刻意对齐（5 段 crontab、`runAsKind`、`lastTaskID` 指向一次 agent 任务），但**各存各的**，
不互相同步——把两套排期叠在一起会让「这个任务到底谁在跑」变得没法回答。

## 数据所有权

| 表              | 归属   | 说明                                                          |
| --------------- | ------ | ------------------------------------------------------------- |
| `scheduled_job` | 本模块 | 任务定义 + 排期 + 最近一次执行结果                            |

`agent_task` **不是本模块的表**：起任务时通过 `AgentService::prepare/launch` 走 agent 域的正常入口，
只把自己的 `last_task_id` 指过去，不写它的行。这与 rag 域「跨域只读别人的行」是同一个立场。

`scheduled_job` 是**严格租户表**（`STRICT_TENANT_TABLES` 成员）：`tenant_id` 非空、带 RLS，
租户作用域之外的读写拿不到行。`creator` / `run_as_user_id` 是指向用户的 FK，用户被删则任务随之消失
——没有创建人的任务既跑不了（`user` 身份）也追溯不了。

## 谁在跑

```
worker 进程：spawn_scheduler（独立线程 + current-thread runtime + LocalSet）
        │  每 events.poll_interval_ms（≥1s）一轮；有活则 1s 后再来
        ▼
   Service::claim_due  ① 平台事务跨租户扫 enabled && nextRunAt <= now（一轮最多 20 条）
        │             ② 逐条 CAS：UPDATE ... WHERE id = ? AND nextRunAt = ?
        │                rows_affected == 0 → 别的副本先拿走了，跳过
        ▼
   run_job             ③ 合成该用户的 claims → Session::resolve → TenantCtx::enter（校验成员关系）
        │             ④ AgentService::prepare 落台账 → ctx.commit() → launch 起编排
        ▼
   Service::finish     ⑤ 写 lastStatus / lastError / lastTaskID
```

**为什么要独立线程 + `LocalSet`**：编排客户端（duroxide）内部用 `spawn_local`，多线程 runtime 的
worker 线程没有 `LocalSet`，直接 panic（`spawn_local called from outside of a task::LocalSet`）。
api 进程没事是因为 `#[actix_web::main]` 本身就是单线程 runtime + `LocalSet`。

`tick` **不等执行结果**：`prepare` 落行 + `launch` 起实例都是毫秒级，真正的执行在编排里，
结果看 `lastTaskID` 指向的那条 agent 台账。

## 三条铁律

1. **保存即校验**：cron 段数、表达式、IANA 时区写错当场 `500802`，不留到 worker tick。
   留下一条算不出下次时间的任务，只会让每轮 tick 都刷一遍错。
2. **只补一次**：迟到（`now - scheduledFor > 2min`）算补跑，只补最近这一格，
   并把 `nextRunAt` 推到**未来的下一个**时间点；停机三天不会醒来连跑三天。
3. **认领用 CAS**：`UPDATE ... WHERE id = ? AND nextRunAt = ?`。多副本并发时只有一个能推进排期，
   比 `SELECT ... FOR UPDATE` 省锁（认领是毫秒级，冲突直接重试下一轮）。

## 时间与时区

- `cron` 是**5 段 crontab**（分 时 日 月 周），按任务自己的 `timezone` 解释，缺省 `Asia/Shanghai`。
  `cron` crate 要 6–7 段，落库前补一个 `0` 秒，所以「秒级」不对外暴露。
- `nextRunAt` / `lastRunAt` 一律是 **epoch 毫秒**，客户端按本地时区展示即可。
- `enabled=false` 时 `nextRunAt` 为空；**启用会从「现在」重排**，不补停用期间错过的时间点。

## 身份语义（`runAsKind`）

| 值       | 执行身份                                        | 适用                         |
| -------- | ----------------------------------------------- | ---------------------------- |
| `user`   | `runAsUserId`，缺省用 `creator`；进租户时校验仍是成员 | 个人任务（缺省）        |
| `tenant` | 服务主体（`SERVICE_ACTOR_ID`）                   | 团队共享任务                 |

不是成员就落 `failed` 并把原因写进 `lastError`，**不静默跳过**——跳过会让人以为任务还在跑。

## 路由一览

| 方法   | 路径                        | 鉴权                         | 说明                                    |
| ------ | --------------------------- | ---------------------------- | --------------------------------------- |
| GET    | `/api/v1/automations`       | JWT + `X-Tenant-ID` 租户成员 | 列表（含最近一次执行状态）              |
| POST   | `/api/v1/automations`       | JWT + `X-Tenant-ID` 租户成员 | 新建（`id` 空）/ 整体替换（`id` 非空）  |
| PATCH  | `/api/v1/automations/{id}`  | JWT + `X-Tenant-ID` 租户成员 | 局部更新；启用/停用/改表达式会重排      |
| DELETE | `/api/v1/automations/{id}`  | JWT + `X-Tenant-ID` 租户成员 | 删除，返回被删行数                      |

## 鉴权说明

- `Auth::isRequired()` 挂在整个 scope 上，未登录直接 401 类。
- **租户来自 `X-Tenant-ID`，必填**，不降级到账号作用域：任务归属与执行身份都按它判定。
  缺头 `200001`、格式错 `200007`。
- 权限复用 agent 任务的那一对（`AgentTask/Write` 建改删、`AgentTask/Read` 查）——定时任务就是
  「按时起一个 agent 任务」，为它单开一对权限只会让权限种子多两份没人调的配置。
- 删除时「id 不是 UUID」「不属于本租户」「不存在」合并成同一个 404，避免用 id 探测别的租户。

## 错误码

| 码       | HTTP | 场景                                              |
| -------- | ---- | ------------------------------------------------- |
| `200001` | 400  | 缺少 `X-Tenant-ID` 请求头                          |
| `200007` | 400  | `X-Tenant-ID` 格式无效                            |
| `300007` | 403  | 非该租户成员 / 缺少对应权限                        |
| `500801` | 404  | 任务不存在 / 不属于当前租户 / id 非法              |
| `500802` | 400  | cron 或时区不合法（保存时就报，不留到 tick）       |
| `500803` | 422  | 名称为空、内容为空、执行身份非法                  |

## 出参

`lastStatus` 记的是**「把任务起起来了」**，不是「执行成功了」：

- `running`：已认领、正在起；
- `succeeded`：agent 任务已建好并起编排，真正的结果在 `lastTaskID` 指向的 agent 台账里；
- `failed`：没起来，原因在 `lastError`（编排未接通、身份不可用、准备任务失败等）。

内部原因（连接串、运行时错误）只进日志与 `lastError`，**响应体里只给面向调用方的说法**。

## 排查手册

```bash
# 列表里看三件事：nextRunAt 是否在往前走、lastStatus、lastTaskID
curl -s "$API/api/v1/automations" -H "Authorization: Bearer $TOKEN" -H "X-Tenant-ID: $TENANT"
# → nextRunAt 一直是过去时间：worker 没在跑（看 worker 日志里的「定时任务认领失败」）
# → lastStatus=failed 且 lastError 含「编排」：duroxide 没接通，任务本身没问题
# → lastStatus=succeeded：任务起成功了，去查 lastTaskID 那条 agent 台账
```

| 现象                                     | 常见原因                                                   |
| ---------------------------------------- | ---------------------------------------------------------- |
| 保存回 `500802`                          | cron 段数不是 5，或时区不是 IANA 名（如写成 `UTC+8`）      |
| 到点没跑，`nextRunAt` 仍停在过去         | worker 进程没起 / 编排库未接通（启动时会有 warn 日志）     |
| `lastStatus=failed`，`lastError` 提到成员 | `runAsUserId` 已不在该租户，改用 `tenant` 身份或换人       |
| 任务跑得很频繁                           | 5 段 crontab 的「周」与「日」是或关系，确认表达式本身      |

## 文档

- agent 任务怎么跑：[`agent/README.md`](../agent/README.md)
- 编排运行时与幂等：[`guide/agent-runtime.md`](../../guide/agent-runtime.md)
- 契约与错误码：[`guide/api-versioning.md`](../../guide/api-versioning.md) / [`guide/error-codes.md`](../../guide/error-codes.md)
