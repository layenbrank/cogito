# durable · 可靠执行

长任务（RAG 索引、批量导入、对外同步）的**可靠执行**：把流程写成可重放的步骤链，
进程崩了、部署重启、活动超时都不丢进度——已经完成的步骤不会重跑，没完成的步骤继续。

本 crate 是 [duroxide](https://crates.io/crates/duroxide) + `duroxide-pg` 的**唯一**包装层：
整个仓库只有这里依赖它们（由 `scripts/capabilities.ts` 的 `CONFINED_CRATE_DEPS` 声明、
`scripts/arch.ts` 的 R10 强制）。上层只看本 crate 的端口，换实现或升级只动这一个 crate。

为什么是它、不是最初建议的 `pg_durable`（Postgres 扩展形态）：见
[`docs/decisions/durable-execution-engine.md`](../../../../docs/decisions/durable-execution-engine.md)。
一句话版本——扩展形态要把执行体放进数据库服务器（超级用户世界、能出网），与本仓库「隔离靠 RLS、
出网只有 gateway」两条不变量直接冲突；而这个库把风险关在一个可被换掉的 crate 后面。

## 数据所有权

| 对象 | 说明 |
| --- | --- |
| schema `durable`（默认名） | 编排实例、历史事件、活动队列、定时器、锁——全部由 provider 自带迁移创建与演进。 |

- **不参与业务迁移世代**：`durable` schema 里的表由 `duroxide-pg` 自己 `CREATE TABLE`（版本记录在
  它自己的 `_duroxide_migrations` 里），与 `migration` crate 的世代无关。业务表结构改动不需要
  管它，它升级也不需要写我们的迁移文件。
- **不用业务连接通道**：provider 用 `durable.database_url`（默认复用 `database.url`）自建连接池，
  不经过 `Storage`，不经过 `src/guards` 的作用域 / 平台通道，**没有行级安全、也不是租户数据**。
  因此 `R8`（平台特权入口）与 `R9`（无作用域访问）都不因为本 crate 增加提权点。
- **必须独立 schema**：`durable.schema` 为空或是 `public` 时 [`Store::connect`] 直接报错——同处
  `public` 会让两套迁移互相踩，`cleanup_schema()` 还会误删业务表。
- **编排输入里带 `tenantID` 是调用方的责任**：本 crate 不做租户过滤，编排历史本身是平台级数据。
- 生命周期：实例历史随业务需要保留；运维清理用 [`Store::cleanup_schema`]（只给测试与危险运维）。

## 对外接口

| 端口 | 用途 |
| --- | --- |
| `DurableSettings` | 连接串、schema、是否自动迁移。由 `Configure.durable` 映射。 |
| `Store` | `connect` / `schema` / `client` / `cleanup_schema`。每个进程各连一次，`Clone` 共享连接池。 |
| `Client` | `start` / `start_json` / `status` / `wait` / `raise_event` / `raise_event_json` / `cancel`。**不需要运行时**，api 进程用它起实例、投事件。 |
| `InstanceStatus` | `NotFound` / `Running` / `Completed` / `Failed`，附 `label()` / `is_terminal()` / `output()`。 |
| `Orchestrations` / `Activities` | 处理器注册表构建器；`names()` 供启动日志与自检。 |
| `Runtime` | `start` / `shutdown(grace_ms)`。一个部署单元只有一个进程跑它。 |
| `OrchestrationContext` / `ActivityContext` | 转发实现本体的上下文类型，调用方不必直接依赖 duroxide。 |

## 语义

- **编排确定性**：编排函数会被重放，所以只写「按什么顺序做什么」——不要在编排里直接做 IO、
  读时钟、抽随机数（要时间用 `ctx.utc_now()`，要随机用 `ctx.new_guid()`，IO 一律走活动）。
- **活动至少一次**：崩溃、锁过期、超时都会导致活动重跑。活动必须用 `ctx.instance_id()` 之类的
  幂等键把副作用做成幂等（下游按幂等键去重，或写入用 upsert）。
- **活动失败分类**：实现本体按 infrastructure / application 等分类重试，重试耗尽后实例判死
  （`InstanceStatus::Failed { category }`）；`poison` 表示某活动反复把实例毒化。
- **一个实例 id 一个实例**：`start` 重复使用同一个 id 会被运行时拒绝，不会起第二个。续跑不是靠
  重新启动，而是运行时按历史自己恢复。
- **外部事件一次性**：`raise_event` 按名字与编排的 `schedule_wait` 位置匹配，订阅几次就投几次；
  没人订阅的投递留在该实例的事件队列里。事件早于订阅到达属于未定义行为（实现本体的限制），
  所以投递方应当在编排已经进入等待之后再发——或者投一次、等一会儿、再投一次。
- **`wait` 超时不报错**：返回当时的 `Running`，由调用方决定继续等还是交出去。
- **进度串只在轮次边界持久化**：编排里 `ctx.set_custom_status()` 写的是**当前轮次**的进度，
  要等这一轮结束（编排去 await 下一步）才随历史落库。所以轮询到的进度永远「落后一步」：
  适合观测「某一步已经做完、下一步正在飞」，不能用来断言「整个实例做完了」——终态看
  `Completed` / `Failed`。
- **停机**：`shutdown(grace_ms)` 在宽限期内让在跑的活动收尾，超时强制中止；`0` 表示立即中止
  （只有测试模拟崩溃时才用）。无论哪种，进度都在存储里。
- **单写者**：同一套注册表 + 同一个 schema 只应该有一个运行时进程。多进程跑不会损坏数据
  （实现本体用锁），但会互相抢轮次、拖慢彼此。

## 边界约束

- 不依赖 `cogito`、不依赖任何 Web 框架（R1 已禁止），不起自己的进程/守护线程。
- 不碰业务表：不 JOIN、不读写 `entity`/`migration` 管理的表；跨边界副作用一律靠活动调用 HTTP 契约。
- 不引入 `tokio::spawn` 之类的外部事件循环：运行时的生命周期由调用方（`orchestrator` 二进制）管理。

## 迁移状态

- 已落地（P4c）：端口 crate、`duroxide 0.1.30` / `duroxide-pg 0.1.35` 接入、独立 schema、
  注册表与运行时装配、`orchestrator` 二进制、集成测试（含「重启后已完成步骤不重跑」）。
- 已落地（P4d）：第一条真实长任务（RAG 索引：分块 → 嵌入 → 落索引），活动经内部 HTTP 契约
  调用 compute，幂等键用实例 id；租约旋钮（`RuntimeTuning`）与启动前的不变量检查；
  真实杀进程的故障注入测试（见下）。
- 风险：duroxide 目前是 0.1.x preview，API 可能在 1.0 前变动。对冲手段就是本 crate——
  全仓库只有一个 crate 与一个二进制接触它，升级面被压到最小。

## 崩溃恢复长什么样

活动租约（`RuntimeTuning::worker_lock_timeout_ms`，默认 30s）是这套东西的物理依据：

- 执行者拿到一步就带租约，一边跑一边续期。进程活着 → 一直续 → 别人不碰这一步。
- 进程被硬杀（`kill -9` / OOM / 断电）→ 没人续期 → 租约到期后框架把这一步**重新投给活着的
  进程**。所以「崩溃恢复最慢多久」≈ 租约时长，调它就是调恢复速度（代价是抖动容忍度）。
- **已完成的步骤不重跑**：它们的结果已经在编排历史里，重放时直接取历史值，不会被重新调度。
- **在飞的那一步会重跑**：`至少一次`语义，所以活动必须靠幂等键（`ctx.instance_id()` 派生的
  `<实例>:<步骤>`）让下游去重。cogito 与 compute 的内部契约就是这么约定的。

`crates/durable` 的 `orchestrator` 集成测试覆盖了这两条：`tests/rag_index.rs` 跑通全流程并断言
幂等键与进度，`tests/rag_fault_injection.rs` 起真子进程、在「第二步正在飞」时硬杀，再起一个新
进程，断言「已完成的步骤不重跑、在飞的那一步按同一个幂等键重跑一次、实例最终完成」。
