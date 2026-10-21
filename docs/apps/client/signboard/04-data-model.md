# 04 — 数据模型与持久化

> 对齐 client SQLite + SeaORM。**不**走 cogito Postgres（MVP）。  
> 命名：表名与列名统一 **snake_case**；IPC JSON 仍为 camelCase（`boardID` 等）；IPC `namespace:action`。

## 1. 表一览

| 表 | 职责 |
|----|------|
| `signboard` | 看板 |
| `signboard_column` | 列（属看板） |
| `signboard_entry` | 条目（属列） |
| `signboard_tag` | 标签字典（属看板） |
| `signboard_tagged` | 条目↔标签 |
| `signboard_check` | 条目子任务（checklist） |
| `signboard_entry_asset` | 条目 ↔ 本地 asset 附件 |
| `signboard_automation` | 看板自动化规则 |

Migration：`migrations_v001`（第一代完整 schema）+ `migrations_v004`（`signboard_entry_asset`）。

## 2. Schema（列均为 snake_case）

### signboard

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | text PK | UUID |
| `title` | text | |
| `index` | integer | |
| `archived_at` | integer? | ms |
| `synced_at` | integer? | 预留 |
| `created_at` / `updated_at` | integer | |

### signboard_column

| 列 | 类型 |
|----|------|
| `id` | text PK |
| `board_id` | text FK → signboard CASCADE |
| `title` / `index` / `color` / `wip_limit` / `archived_at` | |
| `created_at` / `updated_at` | integer |

### signboard_entry

| 列 | 类型 |
|----|------|
| `id` | text PK |
| `column_id` | text FK → signboard_column CASCADE |
| `title` / `notes` / `index` | |
| `due_at` / `start_at` | integer? |
| `reminder_id` | text? FK → reminder SET NULL |
| `priority` / `color` / `archived_at` | |
| `created_at` / `updated_at` | integer |

### signboard_tag

| 列 | 类型 |
|----|------|
| `id` | text PK |
| `board_id` | text FK → signboard CASCADE |
| `title` / `color` | |
| `created_at` / `updated_at` | |

Unique：`(board_id, title)`。

### signboard_tagged

| 列 | 类型 |
|----|------|
| `entry_id` | text FK → signboard_entry CASCADE |
| `tag_id` | text FK → signboard_tag CASCADE |

PK：`(entry_id, tag_id)`。

### signboard_check

| 列 | 类型 |
|----|------|
| `id` | text PK |
| `entry_id` | text FK → signboard_entry CASCADE |
| `title` / `done` / `index` | |
| `created_at` / `updated_at` | integer |

### signboard_entry_asset

| 列 | 类型 |
|----|------|
| `entry_id` | text FK → signboard_entry CASCADE |
| `asset_id` | text FK → asset CASCADE |
| `index` | integer（0 = 封面） |
| `created_at` | integer |

PK：`(entry_id, asset_id)`。

### signboard_automation

| 列 | 类型 |
|----|------|
| `id` | text PK |
| `board_id` | text FK → signboard CASCADE |
| `title` / `enabled` / `trigger` | |
| `condition_json` / `action_json` | text |
| `index` / `created_at` / `updated_at` | |

## 3. IPC

```
signboard / signboard-column / signboard-entry / signboard-entry-asset
signboard-tag / signboard-tagged / signboard-check / signboard-automation
```

JSON 字段仍用 camelCase（`boardID`、`entryID`、`assetID`、`dueAt`…）。
