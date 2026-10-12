# IPC Patterns

前端 `invoke` 字符串是四层命名的对外标准。格式固定为 `namespace:action`。

## Allowed shapes

| Pattern | Example | Notes |
|---------|---------|-------|
| CRUD verb (legacy) | `resource:read` | 存量 kebab namespace |
| Write / upsert (legacy) | `resource:write` | 语义由 service 解释 |
| CRUD to* (new) | `agentSession:toRead` | 新模块 camelCase namespace |
| Update field | `feature:update-mode` | 状态变更用 `update-*` |
| Badge / flag | `feature:update-badge` | 不用 `set-badge` |
| Pending drain | `feature:take-pending` | 多词 kebab-case |
| Capture / window | `feature:open` / `feature:close` | 短动词即可 |

One vs many 由 Entity 的 `*P::One | Many` 表达，IPC 保持单条（如 `resource:insert`）。避免 `insert-one` / `insert-many` 双 IPC。

## Separator rules

| Use | Avoid |
|-----|-------|
| `namespace:action` | `namespace/action` |
| `feature:update-badge` | `feature:update_badge` |
| `resource:read` | `resource_read` |
| `feature:update-badge` | `feature:updateBadge` |
| `feature:update-badge` | `feature:set-badge` |

## Action vocabulary

Prefer a small, stable set:

- Read path: `read`（legacy）或 `toRead`（新 CRUD IPC）
- Create / persist: `write` / `toWrite`
- Mutate: `update` / `toUpdate`、`update-*`
- Delete: `remove` / `toRemove`
- Lifecycle: `open`、`close`、`ensure`、`hide`、`mount`、`take-pending`

## Sync checklist when renaming IPC

1. Rust `#[tauri::command(rename = "...")]`
2. 所有前端 `invoke('...')` 调用点
3. 注释、文档、测试里的示例字符串
4. grep 旧名：snake_case、camelCase、`/`、`set-*`
