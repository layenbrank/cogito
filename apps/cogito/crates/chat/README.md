# chat · 会话同步

「客户端本地为主、服务端只做同步」的那一半：接住客户端推上来的会话 / 消息 / 用量，
按**批次**分配单调水位，并回答「自某个水位以来变了什么」。

## 边界

| 归本能力                                         | 不归本能力                                       |
| ------------------------------------------------ | ------------------------------------------------ |
| `chat_session` / `chat_message` / `chat_usage`   | 消息内容的语义（`format` 说明格式，服务端不解析） |
| `chat_sync_batch`（幂等凭据 + 水位台账）         | 模型调用与计费（`gateway_usage` 那张表）          |
| 冲突判定、水位分配、增量窗口切片                 | 会话的展示与编辑（客户端的事）                    |

## 数据所有权

- `chat_session`：会话头部（标题、置顶、工作区标识、客户端改写时间、墓碑）。
- `chat_message`：消息正文（内容不透明，`format` 说明格式，`parentID` 描述树）。
- `chat_usage`：客户端自报的 token 账（一次运行一笔，按 `runID` 去重）。
- `chat_sync_batch`：同步批次台账——幂等凭据（`clientBatchID`）与该批占用的水位。
- `gateway_usage` **不归本能力**：那是服务端视角的网关用量（含失败与延迟），
  覆盖不了 BYOK 直连上游的调用；两张账口径不同，不要合并。

## 对外接口

- `persistence::apply`：落一批改动（含幂等回放、冲突收集），返回水位与写入行数。
- `persistence::read_changes`：按水位窗口取增量，窗口按**整批**切。
- `persistence::{find_batch, current_revision, lock_tenant}`：幂等查询、当前水位、按租户串行化。
- `plan_sessions`：**纯函数**，把一批会话改动排成落库计划并挑出冲突（规则全在这里，可直接单测）。
- 形状类型：`PushBatch` / `SessionRow` / `MessageRow` / `UsageRow` / `SessionSnapshot` /
  `ChangeBatch` / `Changes` / `ApplyOutcome`。

## 边界约束

- 不依赖 HTTP 框架，也不依赖 `cogito`（R1）：路由与入参校验在 `src/services/chat`，
  只做形状映射与批量上限；水位与冲突规则一律回到本 crate。
- 不做权限判断：本 crate 的函数都要求调用方**已经在租户作用域里**（四张表都启用了 RLS），
  因此不写 `"tenantID" = ?` 条件。
- **服务端不解读消息内容**：客户端换消息格式不该要求服务端发版。

## 三条铁律

1. **一批一个水位**：一批里的行共用一个 `revision`，批次是这个协议的最小交付单位。
   增量拉取按批次切窗口，不会出现「批次只交付了一半」的裂缝。
2. **重发即无操作**：批次台账记下 `clientBatchID → (revision, applied)`，重发同批原样回放。
3. **冲突只报不改**：`title` / `pinned` 是唯一会被两端各自覆盖的字段，撞了就报冲突并**不落**
   本次改动；墓碑（删除）不可逆，一次改名不能把已删的会话改活。

## 为什么不用「行级水位」

行级水位（每行一个独立 `revision`，拉取按 `revision > since` 扫三张表）看着更简单，
但边界处理是错的：一个批次跨限流上限时会被切成两半，游标落在中间就会漏掉半批。批次台账把
「一批」变成不可分割的单位，边界问题直接消失。

## 并发

水位是「当前最大 + 1」算出来的，所以 `apply` 一开始就按租户取一把**事务级**咨询锁
（`pg_advisory_xact_lock`）。同一租户的同步本来就是一串短事务，排队比重试更可预期；
`(tenantID, revision)` 上的唯一索引是兜底——真有漏网的重叠，宁可报错也不要静默串号。

## 迁移状态

- `migrated`：本能力没有遗留路径可吸收（`absorbs` 为空），边界与实现都已就位——
  `crates/chat` + `src/services/chat` + `tests/chat_sync_scope.rs`（入口与隔离）。
  `src/services/chat` 的 HTTP 层按 R6 留在 api 二进制，归属登记在 `scripts/capabilities.ts`
  的 `LEGACY_SERVICES`。

