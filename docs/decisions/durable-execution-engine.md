# 可靠执行引擎：duroxide + duroxide-pg（不采用 pg_durable）

> 目标：长任务（RAG 索引、批量导入、服务端 agent 多轮）在进程被杀、部署重启、活动超时时**不丢进度**——
> 已完成的步骤不重跑，没完成的步骤按同一个幂等键续跑。
> 结论：用 **`duroxide` + `duroxide-pg`**（进程内嵌库 + 编排历史存 Postgres），
> **不采用** `pg_durable`（把可靠执行做成 Postgres 扩展）。

> **这是一条补记**。P4c（`2a9717f8`）落地时只留下了「把 duroxide 关在 `crates/durable` 端口之后」的做法，
> 没有留下相对最初建议（`pg_durable`）的取舍理由。本记录于 P9 收尾补写，**不改动任何实现**：
> 涉及本仓库的部分以仓库内既有文档与门禁为准；上游事实于 2026-09-28 逐个核对（来源见 §6）。

## 0. 候选对照

| 候选                                  | 形态                                                                                   | 结论                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **duroxide + duroxide-pg**            | Rust 库，进程内嵌（Tokio），编排写成 `async` Rust；`Provider` 背后是 Postgres 表       | **采用**，落地在 `apps/service/crates/durable/`                            |
| pg_durable                            | Postgres **扩展**：编排写成 SQL（`df.start(...)`、`~>`、`\|=>`），后台 worker 在库内跑 | 不采用，理由见 §2                                                       |
| Temporal / 外部编排服务               | 独立服务端 + 自己的存储                                                                | 不采用：多一个常驻组件，与「一个 Postgres」的取舍相反                   |
| 框架自带 checkpoint（LangGraph 等）   | 内存里的「存档点」                                                                     | 不采用：checkpoint ≠ 可靠执行（无自动故障检测与恢复、无防重复、单进程） |
| 自研「任务表 + 状态列 + 轮询 worker」 | 手写                                                                                   | 不采用：这正是 pg_durable 自己列出的「你现在大概正在这么做」的痛苦清单  |

## 1. 四条约束是「我们的」，不是通用的

选型要对着约束看，这四条决定了后面每一条理由：

| #   | 约束                                                                                              | 出处                                            |
| --- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | 应用角色**不是**超级用户；租户表 `ENABLE + FORCE ROW LEVEL SECURITY`，提权只走一个登记入口        | `apps/service/guide/database.md`、门禁 R8          |
| 2   | **唯一 LLM 出网点 = `gateway`**（唯一计量点、唯一审计点），业务侧不许自己出网                     | `apps/service/crates/gateway/`、P9a 的服务受众设计 |
| 3   | 编排跑的是**代码**：agent 循环里「剩余轮次 ≤ 1 就清空工具白名单」、组请求、解析内部契约、写进度串 | `apps/service/src/orchestrations/agent.rs`         |
| 4   | 一个 Postgres，且**不假设我们能对数据库服务器动手**（托管 Postgres 也得跑得起来）                 | `apps/service/guide/deployment.md`                 |

## 2. 决定性理由

### 2.1 装不装扩展，决定部署面

pg_durable 是**扩展**：官方发布物是按 PG 大版本切分的 Debian 包，装进数据库服务器；官方 Docker 镜像
只有 `linux/amd64`，且自述仅供评估、明确警告不得用于生产（它为此开启了 superuser durable instances）。
它自己的文档把「你无法在你的 Postgres 里装扩展或跑后台 worker」列为**不该用它**的情形之一。
对得上约束 4：托管 Postgres 的扩展白名单通常不包含它，PG 大版本一动就要重装并重新验证。

`duroxide-pg` 相反，它是一个**客户端**：表由它自己 `CREATE TABLE`，版本记在它自己的
`_duroxide_migrations` 里，对 Postgres 的要求只有「能建表、能跑 SQL」。托管 Postgres 能跑，
本机 `docker compose` 也能跑——`docker/postgres/Dockerfile` 不需要为它加任何东西。

### 2.2 权限姿态与 RLS 冲突（最硬的一条）

pg_durable 的执行体在**数据库服务器进程内**，执行的是库内函数，并且可以通过 `df.http()` 从库里出网。
它的安装本身、以及官方评估镜像的姿态（superuser durable instances）都在超级用户世界里。

对得上约束 1 与 2：这等于在 RLS 边界之外再引入一个**能读能写、还能出网**的执行体。
我们的两条不变量会当场破掉——隔离靠 RLS（`FORCE` + 非超级用户角色），出网只有 `gateway`（计量与审计
成立的前提）。

duroxide 的运行时跑在**我们自己的进程**里（`orchestrator` 二进制），走我们自己的配置、traceparent
和 HTTP 契约；它能碰到的 Postgres 权限不比 `api` / `worker` 多。边界也写清楚了：`durable` schema
不用业务连接通道、没有 RLS、编排历史是**平台级数据**（见 `apps/service/crates/durable/README.md`）。

### 2.3 编排是代码，不是 SQL

pg_durable 的模型是 SQL 形状的。它的 Limitations 明说：某个步骤需要任意代码、非 HTTP 的 SDK、
或者丰富的内存控制流时，得把逻辑包进 SQL 函数、暴露成 HTTP 端点交给 `df.http()`、或者另找通用编排器。

对得上约束 3：我们的编排**就是**「任意代码 + 内存控制流」——每步组装请求、解析 compute 的返回、
按剩余轮次收窄工具白名单、把进度写进 `custom_status`、按失败分类决定重试。把它塞进 SQL 字符串，
类型安全、单元测试与确定性重放会一起消失，也和 R1（能力 crate 不许依赖 Web 框架）/R10（封禁依赖）
的 crate 边界门禁对不上。

我们实际要的语义是「编排确定性 + 活动幂等 + 步骤级重试 + 进度可见」，并且实现本体必须能被
`cargo test` 直接测——`tests/agent_fault_injection.rs` 这种真起子进程、真杀进程的用例只有在这个形态下成立。

### 2.4 风险落在哪，比风险多大更重要

两者都是 preview：duroxide 的 README 自己标注 preview，当前 0.1.x；pg_durable 现在 0.2.x。
真正拉开差距的是**风险落点**：

- duroxide 的风险落在**一个可被换掉的 crate 后面**：上层只看 `Store` / `Client` / `Orchestrations` /
  `Activities` / `Runtime` / `InstanceStatus` 这些端口，`scripts/capabilities.ts` 的
  `CONFINED_CRATE_DEPS` + `scripts/arch.ts` 的 R10 保证全仓库只有 `crates/durable` 碰它。
  换实现或升级只动这一个 crate。
- pg_durable 的风险落在**数据平面本身**：扩展版本与 PG 大版本绑死，坏一次的现场是数据库而不是我们的
  二进制，回退要动数据库。

补充一条可信度事实：duroxide 由 Microsoft 官方发布管道发版（crates.io 上 `duroxide-pg` 的 publish
账号是 `microsoft-oss-releases`），不是个人随手发布的包。

### 2.5 许可证（查过，但不是理由）

| 依赖                 | 许可证                                | 结论                                                    |
| -------------------- | ------------------------------------- | ------------------------------------------------------- |
| `duroxide` 0.1.30    | MIT                                   | 在 `apps/service/deny.toml` 白名单内，CI 门禁绿            |
| `duroxide-pg` 0.1.35 | MIT                                   | 同上                                                    |
| pg_durable           | PostgreSQL License（同样 permissive） | 它是数据库扩展、不是 Rust 依赖，本就不参与 `cargo deny` |

两者都不构成阻碍，因此这一项**不参与决策**——写在这里是为了说明「不是漏查」。

## 3. 采用 duroxide 之后我们接受的代价

- 0.1.x preview，API 在 1.0 前可能变。对冲是一个 crate、一个二进制、一份 R10 门禁。
- **单写者**：同一套注册表 + 同一个 schema 只应有一个运行时进程。
- **活动至少一次**：崩溃恢复会重跑在飞的那一步，下游必须用幂等键（`<实例>:<步骤>`）去重。
- **编排历史不带租户隔离**：`durable` schema 是平台级数据，租户边界靠编排输入里的 `tenantID` 加下游契约。
- 「崩溃恢复最慢多久」等于活动租约 `durable.worker_lock_timeout_ms`，是运维旋钮，不是自动的好事。

## 4. 什么情况下重新考虑 pg_durable

不是「以后再说」，而是有明确的触发形状——三条同时成立才考虑：

1. 要跑的是**每个文档 / 每行一个**的纯数据库内流水线（chunk → 调嵌入 API → upsert pgvector 这类）；
2. 且部署目标是**我们自己可控、能装扩展**的 Postgres（并接受现行的 amd64 限制）；
3. 且这条流程**不参与** `gateway_usage` 与审计（即不靠网关取模型算力、不走唯一出网点）。

那时正确的做法是**并存**（pg_durable 管库内批处理），而不是替换 cogito 的可靠执行。
反过来，只要流程需要任意外部调用、需要落进计量与审计、或者部署面包含托管 Postgres，就仍是 duroxide。

## 5. 后向指针

| 位置                                                                                                 | 说明                                                         |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `apps/service/crates/durable/README.md`                                                                 | 端口、语义、边界约束、崩溃恢复长什么样                       |
| `apps/service/guide/configuration.md`                                                                   | `durable` 配置段（连接串 / schema / 并发 / 停机宽限 / 租约） |
| `apps/service/scripts/capabilities.ts`、`apps/service/scripts/arch.ts`                                     | R10：封禁依赖只能出现在允许的 crate 里                       |
| `apps/service/tests/orchestration.rs`、`tests/rag_fault_injection.rs`、`tests/agent_fault_injection.rs` | 重启续跑、已完成步骤不重跑、真杀进程的故障注入               |

## 6. 上游来源（2026-09-28 核对）

- **duroxide**：crates.io `duroxide 0.1.30`（MIT，2026-07-29 发布）、`duroxide-pg 0.1.35`（MIT，
  2026-08-25 发布，发布账号 `microsoft-oss-releases`）；仓库 <https://github.com/microsoft/duroxide>
  （README 标注 preview；「Embeddable — runs in-process on Tokio. No separate server to operate.」）。
- **pg_durable**：仓库 <https://github.com/microsoft/pg_durable>（PostgreSQL License）；README 的
  Packages 段、「When not to use it」段、Limitations 段；最新 release `v0.2.8`（2026-09-11），
  资产为 `pg-durable-postgresql-<PG 大版本>_<版本>-1_amd64.deb`；官方镜像 `ghcr.io/microsoft/pg_durable`
  自述仅用于评估与学习、不得用于生产。
