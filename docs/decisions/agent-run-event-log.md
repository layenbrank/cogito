# ADR：运行事件日志成为会话的唯一真相

- 状态：提议（2026-11-23）
- 影响范围：`apps/agentd`、`packages/agent-runtime`、`apps/client`、`apps/extension`
- 关联：[agent-audit.md](../apps/client/agent-audit.md) 的 F-003 / F-005 / F-012；
  [agent-run-state-machine.md](./agent-run-state-machine.md)、[agent-approval-service.md](./agent-approval-service.md)

## 1. 背景

现状（`apps/agentd/src/events.ts`）：

- `seq` 是**进程内**自增，跨重启归零；
- 事件只存在每线程的环形缓冲（`BUFFER_LIMIT = 2000`），**不落库**（`db.ts` 的 `run_events` 表零引用）；
- `since(after)` 只做 `seq > after` 过滤，**不判断是否发生过裁剪**；
- `sync` 只报 `lastSeq`，而协议层连 `approvals` 快照也不读（F-005）；
- 客户端游标是单个数字，只能靠 `sync` 回退来规避重启，无法区分「旧进程的 seq」与「新进程的 seq」。

结果：长回合断线后正文静默缺段；agentd 重启后已产出内容不可重建；恢复逻辑靠「重放 + 空闲超时」猜。

## 2. 决策

**agentd 内的运行事件改为持久、append-only 的日志，并成为会话状态的唯一真相。**

### 2.1 数据模型

```sql
CREATE TABLE run_events (
  thread_id   TEXT    NOT NULL,
  epoch       TEXT    NOT NULL,   -- agentd 进程启动标识（随机 ULID）
  seq         INTEGER NOT NULL,   -- 进程内严格递增，从 1 开始
  kind        TEXT    NOT NULL,   -- update | approval | elicitation | status
  payload     BLOB    NOT NULL,   -- 序列化后的事件体（含 raw session/update）
  run_id      TEXT,               -- 归属哪一轮（approval/status 必填）
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (thread_id, epoch, seq)
);
CREATE INDEX run_events_by_thread ON run_events(thread_id, created_at);
```

- `epoch` 在进程启动时生成一次，写进 `/health`、`AGENTD_READY` 握手行与每个事件；
- `seq` 仍是进程内单写者分配（事件产生在 agentd 一个进程里），但对外是不可复用的 `(epoch, seq)`；
- 保留策略按**字节 + 天数**双重淘汰（默认 7 天，与 agent cache 对齐），淘汰时记录每线程最小可用 `seq`。

### 2.2 写入路径

1. `emit()` 先分配 `(epoch, seq)`；
2. **先写库（同事务写事件 + 更新线程的最小可用游标），成功后再广播给订阅者**；
3. 写库失败不能阻塞回合：降级为「仅内存 + 标记 `durable:false`」，并立即向客户端发 `status{warning:'event-log-degraded'}`；
4. 批量写入（同一 tick 内合并，最多 32 条或 50ms）以降低 `node:sqlite` 同步写对事件循环的影响。

### 2.3 读取 / 重放

`GET /threads/:id/events?after=<epoch>:<seq>`（兼容旧的纯数字 `after`）：

1. 先 `subscribe`，再补发（保持现有硬约束）；
2. 补发从持久日志按 `(epoch, seq)` 读，**不依赖内存缓冲**；
3. `sync` 帧扩展为：

```json
{
  "epoch": "01J...",
  "lastSeq": 123,
  "minSeq": 1,
  "truncated": false,
  "run": { "runId": "…", "phase": "running|settled", "status": "ok|error|cancelled" },
  "approvals": [ … ],
  "elicitations": [ … ]
}
```

4. 若请求的 `epoch` 与服务端不同，服务端返回 `reset:true` 并从该线程的 `minSeq` 或 `1` 开始补发；
5. 若 `after < minSeq`，`truncated:true`，客户端必须从 SQLite 历史重建，而不是假装已同步。

### 2.4 客户端游标

- 游标从 `number` 改为 `{ epoch: string, seq: number }`；
- `createRunCursor` 的 `reset` 接受完整游标；
- `POST_ACP_BINDING` 落库 `lastEpoch + lastSeq`；
- **任何终态（finish / error / cancelled / aborted）都必须在 `finally` 落一次游标**，与扩展对齐（F-012）。

## 3. 理由

1. 断线/重启后的「正文缺段」是当前最高频的数据完整性问题，无法靠客户端补丁修复；
2. OpenHands（EventStream 派生 State）与 Codex（rollout 持久化 + resume）都证明这条路可行；
3. 事件落库后，审批重放（ADR-2）、run 状态查询（ADR-3）、可观测性都变成同一个日志的读视图，减少三套并行状态；
4. `(epoch, seq)` 用最小代价解决了「重启后 seq 归零」这个已两次导致线上叠字/缺段的坑。

## 4. 不变量

1. 同一线程的事件在日志里**只追加、不修改**；
2. 同一 `epoch` 内 `seq` 严格递增且不重复；跨 `epoch` 不比较大小；
3. 客户端对同一 `(epoch, seq)` **只应用一次**；
4. 补发与实时尾部重叠时，以 `emit` 分配的序号去重；
5. `sync` 报的 `lastSeq` 是「已写到这条连接」的位置，`truncated` 报的是「日志已不可完整重放」；
6. checkpoint 仍只用于图状态恢复，**不再承担事件存储**（两者职责分离）。

## 5. 代价

- 每轮多一次（批量）SQLite 写；`node:sqlite` 同步写会占事件循环，需要批量与慢查询监控；
- 磁盘增长：工具输出可能很大，需要对单事件 payload 设上限（例如 256KB，超出截断并标记 `truncatedPayload`）；
- 迁移：旧库没有 `run_events` 数据，首次升级只能保证「从升级后开始的回合可重放」；
- 客户端游标形状变更需要同时改 client、extension、`agent-runtime`，并保留一段兼容解析。

## 6. 备选方案

| 方案 | 否决理由 |
| --- | --- |
| 只加 `gap` 信号，不落库 | 能提示缺段，但重启后仍无法重建；用户只能重跑 |
| 事件写进客户端 SQLite | 违反「agentd 是循环宿主」的定位；扩展/多客户端无法共享；写入竞争更严重 |
| 依赖 goose `session/load` 重放历史 | 只能恢复「已完成的会话历史」，无法恢复审批票据与运行中事件；且重放粒度是消息不是事件 |
| 用 LangGraph checkpoint 当事件源 | checkpoint 是图状态快照，不包含 token 级增量与工具卡状态；体积与语义都不匹配 |

## 7. 验收

1. 单测：`emit` 的 `(epoch, seq)` 分配、批量写、写失败降级、保留淘汰；
2. 集成：断流 3000 条后重连，正文完整；`after` 落在已淘汰区时 `truncated:true`；
3. 重启：kill agentd 后重连，`epoch` 变化触发 `reset`，不把旧 `settled` 当成本轮结束；
4. 兼容：旧客户端传纯数字 `after` 时仍能工作（按同 epoch 解释）。

## 8. 重新考虑条件

- `node:sqlite` 写入成为明显瓶颈（事件循环延迟 > 50ms 常态）→ 改为独立写线程 / 批量更大；
- 引入云端多客户端共享会话 → 事件日志迁到服务端，agentd 退化为本地执行器；
- goose 提供稳定的「完整 turn 事件流」持久化 → 可评估只存引用而不是复制内容。
