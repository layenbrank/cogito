# audit · 事件与审计

统一的领域事件写入（outbox）与消费去重（consumed_event）：所有「先落库、后处理」的审计与
异步副作用都经由本 crate。

## 数据所有权

| 表 | 说明 |
| --- | --- |
| `outbox` | 待发布事件（同一业务事务内追加写入，发布者只读已提交行）。 |
| `consumed_event` | 消费端幂等去重（复合主键）。 |

## 对外接口

- `Event` / `EventType` / `Envelope`：事件载荷、类型标识（`<聚合>.<过去式动词>`）与线上信封
  （字段名与 outbox 列名一致：camelCase + `xxxID` 后缀，如 `aggregateID` / `tenantID`；
  `eventType` 是字符串——消费者版本可以落后于写入方）。
- `append(tx, &Event)`：在**调用方的事务**内追加事件，保证业务写入与事件写入同生共死。
- `Publisher` + `Dispatcher` + `PlatformChannel`：读待发布事件、投递、置位 `publishedAt`。
  投递方式与特权通道都由调用方注入，本 crate 不引入 HTTP 框架、不起事件循环。
- `consume_once(tx, consumer, event_id)`：消费端幂等去重，返回 `false` 表示「已处理过，跳过」。
  去重登记必须与实际副作用同一个事务。

## 语义

- **至少一次**：投递成功后才写 `publishedAt`，因此崩溃或失败只会重投；重复由 `consume_once`
  或下游自身的幂等键消除。
- **同聚合有序**：同一聚合（`aggregate` + `aggregateID`）的前一条失败时，后续事件本轮跳过并
  按指数退避重试；其他聚合照常前进，一条投不出去的事件不会堵住整个 outbox。
- **平台级事件**（`tenantID IS NULL`）只能在 `PlatformChannel` 开启的事务里写入与跨租户读取，
  因为 `outbox` 强制启用行级安全。

## 边界约束

- 只追加：事件内容不可更新、不可删除；唯一允许的列变更是发布标记（`publishedAt`、`attempts`、`lastError`）。
- 不依赖 HTTP 框架、不依赖 `cogito`（R1）、不依赖 `tokio`/`tracing`。
- 不 JOIN 其他 crate 的表，不做跨边界副作用（发布由 `cogito` 的 worker 驱动）。
- 事件写入必须与业务写入在同一事务；不允许在事务外单独写 outbox。

## 迁移状态

- 已迁入（P4a）：`Event` / `Envelope` / `append` / `consume_once` / `Publisher` 已在本 crate 落地，
  事件表 DDL 与实体在 `migration` / `entity` 中；`attempts`、`lastError` 只用于可观测与退避判断。
- 待办（P4b）：发布循环、HTTP 派发实现与 worker 二进制在 `cogito` 侧组装。
