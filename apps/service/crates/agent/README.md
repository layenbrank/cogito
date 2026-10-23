# agent · 服务端 agent 台账

租户级自治 agent 的**任务册**：一次任务在哪个租户下、以什么目标起、跑到第几轮、最终给出结论还是失败。

## 数据所有权

- `agent_task`：任务台账一行一次任务（发起人、目标、模型、轮次上限与工具白名单、进度、终态结果）。
- `agent_approval`：审批台账一行一次**人做的决定**（谁、第几步、哪个工具、参数原文、批还是驳回、理由、逾期时间）。
  `applied_at IS NULL` 表示「已提交、还没投递出去」；`EXPIRED` 不落这张表——超时没有人参与。
- 只拥有台账，不重复记别人的数据：模型调用的用量与主体归 `gateway`（`gateway_usage` / `gateway_audit`），
  编排实例历史在 `durable` 自己的 schema 里，知识库与长期记忆归 compute。

## 对外接口

- `persistence::{create, find, finish}`：建行、读行、终态写回，三件事之外什么都不做。
  `finish` 是**唯一的终态入口**，靠「读行加锁 + 条件判断」保证终态只写一次。
- `persistence::{record_approval, find_approval, mark_applied}`：记一次人的决定、读一条决定、
  标记「决定已经送进编排邮箱」。同一审批不能改判（`Error::DecisionConflict`），
  「超时」不能由记进来冒充（`Error::NotHumanDecision`）。
- `TaskState`（`RUNNING` / `SUCCEEDED` / `FAILED`）与 `TaskState::parse`：状态词汇的唯一落点。
- `ApprovalState`（`APPROVED` / `REJECTED` / `EXPIRED`）与 `ApprovalState::parse`：决定词汇的唯一落点
  （编排侧复用同一份，见 `src/orchestrations/agent.rs` 的 `pub use`）。
- `NewTask` / `TaskOutcome` / `NewApproval`：写入与收尾的入参形状。

## 边界约束

- 不依赖 HTTP 框架，也不依赖 `cogito`（R1）：多轮循环在 `src/orchestrations/agent.rs`，
  对外路由在 `src/services/agent`，两者都只经上述接口读写台账。
- 不做权限判断：谁能起任务由作用域层（`TenantCtx`）与网关决定。
- 不认编排句柄：`finish` 只接收 `TaskOutcome`，所以「至少执行一次」的重复收尾天然无害。
- 轮次上限与工具白名单是任务的**输入**，写下后不再改；要改就是另一个任务。

## 迁移状态

- `migrated`：本能力没有遗留路径可吸收（`absorbs` 为空），边界与实现都已就位——
  `crates/agent` + `src/services/agent` + `src/orchestrations/agent.rs` +
  `tests/agent_scope.rs` / `tests/agent_fault_injection.rs`。
  `src/services/agent` 的 HTTP 层按 R6 留在 api 二进制，归属登记在 `scripts/capabilities.ts`
  的 `LEGACY_SERVICES`。
