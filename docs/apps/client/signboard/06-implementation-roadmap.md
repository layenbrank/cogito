# 06 — 实现路线图（确认设计后执行）

> **现在不要改业务代码。** 本文件是 1B「确认后再落地」的执行清单。

## Phase 0 — 设计确认门禁

- [ ] 产品原则与 MVP 范围无异议（[01-prd](./01-prd.md)）  
- [ ] 数据表与 Reminder 联动可接受（[04-data-model](./04-data-model.md)）  
- [ ] 交互快捷键与 DnD 选型可接受（[03-ia-interaction](./03-ia-interaction.md)）  
- [ ] 原型手感 OK（[prototype/index.html](./prototype/index.html)）  

确认方式：在本 PR 或聊天回复「确认落地」即可进入 Phase 1。

## Phase 1 — 持久化

1. `migrations_v00N.rs`：五表 + 索引 + down  
2. Entity + `lib.rs` 注册  
3. `core/signboard*/service.rs`：CRUD One|Many  
4. `command` + `CHANNELS.SIGNBOARD*`  
5. 默认种子（个人看板 + 三列）  

参考：`entity/calendar.rs`、`migrations_v002.rs`、`stores/calendar.ts`。

## Phase 2 — Store + 壳

1. `stores/signboard.ts`  
2. 替换 [`views/signboard/signboard.tsx`](../../../apps/client/src/views/signboard/signboard.tsx) 占位  
3. 保持 `Decorations` + `findComponentLabel('signboard')`  

## Phase 3 — DnD 看板 UI

1. Board / Column / Card / Toolbar / CardSheet 组件（建议 `views/signboard/` 或 `features/signboard/`）  
2. `@dnd-kit` 多 `SortableContext` + `DragOverlay`  
3. 键盘移动  
4. `debounce` 搜索  

## Phase 4 — Reminder / Calendar 联动

1. 侧栏 due +「提醒我」  
2. `reminderID` 写入与清理  
3. 逾期/今日 chip 样式（`--warning` / `--destructive`）  

## Phase 5 — 视觉抛光

1. Empty shader  
2. 列语义色点  
3. reduced-motion  
4. 暗色回归  

## Phase 6 — 质量

1. IPC / service 单测或现有测试风格对齐  
2. 手动：拖拽持久化、重启恢复、提醒列表可见  
3. React Doctor / lint（若仓库惯例要求）  

## 非目标（仍延后）

- Cogito 同步 / `syncedAt` 逻辑  
- 协作、评论、附件  
- WIP 强制拦截 UI（字段可先存）  
