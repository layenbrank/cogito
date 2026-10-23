# rag · RAG 索引任务台账

一份资产**正在被索引**（或曾经被索引成什么）的唯一记录。切块与向量不在 Rust 侧，
这里只留「谁、在哪个租户下、把哪份资产、起了第几次索引、结果如何」。

## 数据所有权

- `rag_index_task`：索引任务台账一行一次索引（发起人、资产、状态、编排实例标识、终态结果）。
- 只拥有台账，不重复记别人的数据：切块与向量在 compute（`rag_chunk` / `rag_embedding` / `rag_index`），
  编排实例历史在 `durable` 自己的 schema 里，资产本身归 `upload`（`asset` 表）。
- **资产是输入不是子资源**：台账只存 `assetID`，字段语义（mime、名字、可索引性）由服务层查 `asset` 后喂进来。

## 对外接口

- `persistence::{create, find, running_for, finish}`：建行、读行、查在跑的行、终态写回。
  `finish` 是**唯一的终态入口**，靠「读行加锁 + 条件判断」保证终态只写一次。
- `IndexState`（`RUNNING` / `SUCCEEDED` / `FAILED`）与 `IndexState::parse`：状态词汇的唯一落点。
- `NewIndexTask` / `IndexOutcome`：写入与收尾的入参形状。

## 边界约束

- 不依赖 HTTP 框架，也不依赖 `cogito`（R1）：阶段推进在 `src/orchestrations/rag.rs`，
  对外路由在 `src/services/rag`，两者都只经上述接口读写台账。
- 不做权限判断：谁能索引由作用域层（`TenantCtx`）与网关决定。
- **不认编排句柄**：`finish` 只接收 `IndexOutcome`，所以「至少执行一次」的重复收尾天然无害。
- **同一资产同时只有一个在跑的任务**：由部分唯一索引
  `uidx_rag_index_task_running`（`("tenantID", "assetID") WHERE status = 'RUNNING'`）保证，
  不靠调用方的先查一次——先查只是为了 409 能带上已有任务的 id。
- 台账刻意**不含轮次**：索引的阶段数随资产大小变化，写进台账只会是一个永远对不上的数字；
  实时进度从 durable 的 custom status 拿。

## 迁移状态

- `migrated`：本能力没有遗留路径可吸收（`absorbs` 为空），边界与实现都已就位——
  `crates/rag` + `src/services/rag` + `src/orchestrations/rag.rs` +
  `tests/rag_index.rs`（编排）/ `tests/rag_index_scope.rs`（入口与隔离）。
  `src/services/rag` 的 HTTP 层按 R6 留在 api 二进制，归属登记在 `scripts/capabilities.ts`
  的 `LEGACY_SERVICES`。
