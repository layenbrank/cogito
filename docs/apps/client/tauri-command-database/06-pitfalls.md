# 06 — 易错对照与排查

## 旧名 → 新名

| 旧                                       | 新                                      | 备注                                 |
| ---------------------------------------- | --------------------------------------- | ------------------------------------ |
| `alarm` 表 / `alarm:*`                   | `reminder` + `fireTime`                 | 无独立 alarm 域                      |
| `stores/alarm.ts`                        | `stores/reminder.ts`                    | Clock 用 `findClockReminders`        |
| `calendarEvent` / `calendar-event:*`     | `calendar` / `calendar:*`               |                                      |
| `stores/calendar-event.ts`               | `stores/calendar.ts`                    |                                      |
| `isEnabled`                              | `enabled`                               |                                      |
| `isAllDay`                               | `entireDay`                             |                                      |
| `isCompleted` / `completedAt`            | `archivedAt`                            | `NULL` = 活跃                        |
| `src/alarm/worker.rs`                    | `src/reminder/worker.rs`                |                                      |
| `migrations_v002` / v003（旧世代，已删） | `migrations_v002`（`album` 表，新世代） | 旧库留有旧世代记录 → `migrate:fresh` |

若代码或注释仍出现上表「旧」侧名称，视为过期。

## 看起来对、实际错

| 误用                                        | 后果                                                                                                                                        | 正确做法                                                                                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 未删本地 `cogito-client.db` 直接跑新迁移       | 启动失败 / 缺列 / 旧表残留；残留旧迁移记录时报 `Migration file of version 'migrations_v002' is missing`（`up` / `status` / App 启动均中招） | 删库冷启动（见 [01](./01-changelog-schema-unify.md)），或 `pnpm --filter @i-thinking/client migrate:fresh`（含自动备份，见 [03](./03-database.md#执行迁移migrate-脚本)） |
| 用 `calendar` 存闹钟时刻                    | 无 `fireTime`/worker 调度                                                                                                                   | 写 `reminder.fireTime`                                                                                                                                                   |
| 用 `reminder.dueAt` 当日程起止              | 无区间、无 calendar UI 语义                                                                                                                 | 写 `calendar.startAt/endAt`                                                                                                                                              |
| write reminder 既无 `dueAt` 又无 `fireTime` | Validation 错误                                                                                                                             | 至少填其一                                                                                                                                                               |
| 前端自己 setInterval 再弹通知               | 与 worker 双响                                                                                                                              | 只听 `reminder:fired`                                                                                                                                                    |
| 经 `reminder:update` 写 `lastFiredAt`       | Change 无此字段，无效或类型错                                                                                                               | 交给 `toClaimFire`                                                                                                                                                       |
| `weekDays: "[]"` 当重复闹钟                 | 被当成 **one-shot**；响后 archive                                                                                                           | 重复需非空 ISO 星期数组                                                                                                                                                  |
| update 省略字段 vs 传 `null` 搞混           | 该清的没清 / 不该改的被清                                                                                                                   | 见 [03](./03-database.md) 三态                                                                                                                                           |
| 读列表期望含已完成，却不传 `archived: true` | 默认过滤 `archivedAt IS NULL`                                                                                                               | `archived: true`                                                                                                                                                         |
| 照抄 `countdown:upsert` 做新业务 CRUD       | 模式不一致                                                                                                                                  | 用 `write/read/update/remove` + `*P`                                                                                                                                     |
| 仍 invoke `calendar-event:*` / `alarm:*`    | 未注册，调用失败                                                                                                                            | 用 `calendar:*` / `reminder:*`                                                                                                                                           |
| 布尔字段继续用 `isXxx` 写入                 | 与 schema 不符                                                                                                                              | `enabled` / `entireDay`                                                                                                                                                  |

## 响铃排查清单

1. 该条是否 `enabled === true` 且 `archivedAt == null`？
2. 有 `dueAt` 还是 `fireTime`？`should_fire` 路径不同。
3. 是否卡在 `snoozeUntil` 未来时刻？
4. 同分钟是否已有 `lastFiredAt`（claim 去重）？
5. 一次性（空 `weekDays`）是否已被 archive？
6. Worker 是否在 bootstrap 中启动？日志是否有 `reminder ticker:`？
7. 前端是否重复订阅或自己又发了一遍通知？

## 相关文档

- 改动背景：[01-changelog-schema-unify.md](./01-changelog-schema-unify.md)
- 分层：[02-architecture.md](./02-architecture.md)
- 载荷与三态：[03-database.md](./03-database.md)
- IPC 表：[04-command-ipc.md](./04-command-ipc.md)
- 领域语义：[05-reminder-calendar.md](./05-reminder-calendar.md)
