# 04 — 数据模型与持久化

> 对齐 client SQLite + SeaORM（calendar / album 模式）。**不**走 cogito Postgres（MVP）。  
> 命名：DB 列 camelCase；FK `xxxID`；IPC `namespace:action`；前端 store `toRead` / `toWrite` / `toUpdate` / `toRemove`。

## 1. 表一览

| 表 | 职责 |
|----|------|
| `signboard` | 看板 |
| `signboardColumn` | 列（属看板） |
| `signboardCard` | 卡片（属列） |
| `signboardTag` | 标签（属看板，便于看板内筛选） |
| `signboardCardTag` | 卡片↔标签 |

Migration 建议：`migrations_v003.rs`（以落地时最新版本号为准）。

## 2. Schema

### signboard

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | text PK | UUID |
| `title` | text | |
| `index` | integer | 看板切换器排序 |
| `archivedAt` | integer? | ms；NULL=活跃 |
| `createdAt` | integer | |
| `updatedAt` | integer | |
| `syncedAt` | integer? | **预留**云同步；MVP 恒 NULL，无逻辑 |

### signboardColumn

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | text PK | |
| `boardID` | text FK → signboard | ON DELETE CASCADE |
| `title` | text | |
| `index` | integer | 列序 |
| `color` | text? | 可选列强调色 token 名或 hex |
| `wipLimit` | integer? | 预留；MVP UI 可不展示 |
| `archivedAt` | integer? | |
| `createdAt` / `updatedAt` | integer | |

### signboardCard

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | text PK | |
| `columnID` | text FK → signboardColumn | ON DELETE CASCADE |
| `title` | text | |
| `notes` | text | 默认 `''` |
| `index` | integer | 列内序 |
| `dueAt` | integer? | ms；卡片面 chip |
| `reminderID` | text? FK → reminder | ON DELETE SET NULL |
| `priority` | integer | 默认 0；预留 |
| `color` | text? | 可选 |
| `archivedAt` | integer? | 完成/归档语义（与 Reminder 一致，无 `isCompleted`） |
| `createdAt` / `updatedAt` | integer | |

### signboardTag

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | text PK | |
| `boardID` | text FK → signboard | CASCADE |
| `title` | text | |
| `color` | text? | |
| `createdAt` / `updatedAt` | integer | |

Unique 建议：`(boardID, title)`。

### signboardCardTag

| 列 | 类型 |
|----|------|
| `cardID` | text FK → signboardCard CASCADE |
| `tagID` | text FK → signboardTag CASCADE |

PK：`(cardID, tagID)`。

## 3. 与 Reminder / Calendar

```
Card.dueAt  ──展示──► 到期 chip
Card.reminderID ──► Reminder（调度响铃）
可选：用户「放到日历」→ Calendar.write + 可选同一 reminderID
```

规则：

- 开提醒：必须有 `dueAt`（或 Reminder 要求的 dueAt/fireTime）  
- 删 Reminder：卡片 `reminderID` SET NULL，保留 `dueAt`  
- **不要**把卡片完成写成 Calendar；归档用 `archivedAt`  

详见 [05-reminder-calendar.md](../tauri-command-database/05-reminder-calendar.md)。

## 4. 索引

- `signboardColumn(boardID, index)`  
- `signboardCard(columnID, index)`  
- `signboardCard(reminderID)`  
- `signboardCard(dueAt)`  
- `signboardTag(boardID)`  
- `signboardCardTag(tagID)`  

## 5. IPC 草案

```
signboard:read | write | update | remove
signboardColumn:read | write | update | remove
signboardCard:read | write | update | remove
signboardTag:read | write | update | remove
signboardCardTag:write | remove   # 或并入 card update 的 tagIDs
```

读卡片时建议一次返回 `tagIDs: string[]`（service join），减少往返。

排序批量更新：`signboardCard:update` 支持 `Many`（`WriteP::Many` / Update Many），拖拽结束一次提交受影响行。

## 6. 前端 Store 草图

`apps/client/src/stores/signboard.ts`（Zustand + immer）：

- `boards` / `activeBoardID`  
- `columns` / `cardsByColumnID`  
- `tags`  
- `toReadBoardTree(boardID)` — 一次拉齐列+卡+标签  
- `toMoveCard({ cardID, toColumnID, toIndex })` — 乐观 + IPC  
- `toLinkReminder(cardID, reminderID | null)`  

搜索 UI：`debounce` from `lodash-es`。

## 7. 默认种子

首启无数据时：

1. Board「个人」  
2. Columns：待办(0)、进行中(1)、完成(2)  
3. 无示例卡片（尊重空态设计）  

## 8. 明确不做

- 复用 `collection` / `magneticTile.collectionID` 存看板  
- 复用 cogito `agent_task` 当卡片  
- MVP 写 `syncedAt` 同步逻辑  
