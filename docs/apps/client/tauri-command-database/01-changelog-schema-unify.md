# 01 — Schema Reminder 统一改动总结

破坏性重构（产品未上线）：单一迁移、通用 reminder、calendar 重命名、响铃 claim-then-notify。

## 目标

- 单一 `migrations_v001`；删除 v002 / v003
- 全表 camelCase 列 + 审计三元组 `createdAt` / `updatedAt` / `archivedAt`
- **删除独立 `alarm` 表**，闹钟能力并入 `reminder`（`fireTime` + `weekDays`）
- `calendarEvent` → `calendar`；IPC `calendar-event:*` → `calendar:*`
- Reminder ticker：先 claim 再通知，支持启动即 tick 与追赶

## 为何删除 alarm

| 原因 | 说明 |
|------|------|
| 语义重叠 | alarm 与 reminder 都是「某时提醒用户」：标题、开关、重复、snooze、响铃 |
| 重复基建 | 独立表意味着双份 entity / service / IPC / store / ticker |
| 未上线 | 无真实用户数据迁移成本；合并为「带 `fireTime` 的 reminder」即可 |

Clock 侧筛选：`fireTime != null && archivedAt == null`（见 `apps/client/src/features/magnetic-tiles/clock/alarm-time.ts`）。

## 命名与字段

| 旧 | 新 |
|----|-----|
| `alarm` 表 / `alarm:*` | 无；用 `reminder` + `fireTime` |
| `calendarEvent` / `calendar-event:*` | `calendar` / `calendar:*` |
| `isEnabled` / `isAllDay` 等 | `enabled` / `entireDay`（无 `is` 前缀） |
| `isCompleted` / `completedAt` | 用 `archivedAt`（`NULL` = 活跃） |
| snake_case 列 | SQLite **camelCase** 列名 |

`archivedAt` 表示终态时间戳：完成、软删、一次性闹钟响过后关闭等。

## IPC / 前端对照

| 层 | 变更 |
|----|------|
| IPC | `reminder:write\|read\|update\|remove`；`calendar:write\|read\|update\|remove` |
| 事件 | `reminder:fired`（payload：reminder id） |
| Store | 删除 `stores/alarm.ts`、`stores/calendar-event.ts`；用 `stores/reminder.ts`、`stores/calendar.ts` |
| Clock | `useReminderStore` + `findClockReminders` |

## 后端路径变更（摘要）

| 删除 / 废弃 | 现行 |
|-------------|------|
| `entity/calendar_event.rs` | `entity/calendar.rs` |
| `core/calendar_event/` | `core/calendar/` |
| `command/calendar_event.rs` | `command/calendar.rs` |
| `migrations_v002`（及曾规划的 v003 alarm） | 仅 `migrations_v001` |
| `src/alarm/worker.rs` | `src/reminder/worker.rs` |

## 冷启动

1. 退出应用
2. 删除本地 `cogito-client.db`（应用 data 目录下）
3. 重新启动，由 v001 建库

未删旧库时：迁移版本/表结构不一致，读写会失败或行为异常。详见 [06-pitfalls.md](./06-pitfalls.md)。
