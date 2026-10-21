# 06 — 实现路线图（确认设计后执行）

> 设计已确认（「确认落地」）。Phase 1–5 已在本 PR 落地；Phase 6 待桌面端手测。

## Phase 0 — 设计确认门禁

- [x] 产品原则与 MVP 范围无异议（[01-prd](./01-prd.md)）  
- [x] 数据表与 Reminder 联动可接受（[04-data-model](./04-data-model.md)）  
- [x] 交互快捷键与 DnD 选型可接受（[03-ia-interaction](./03-ia-interaction.md)）  
- [x] 原型手感 OK（[prototype/index.html](./prototype/index.html)）  

## Phase 1 — 持久化

1. [x] `migrations_v001.rs`：七表 + 索引 + down（signboard 并入第一代）  
2. [x] Entity + `lib.rs` 注册  
3. [x] `core/signboard*/service.rs`：CRUD One|Many  
4. [x] `command` + `CHANNELS.SIGNBOARD*`  
5. [x] 默认种子（个人看板 + 三列，前端 `toBootstrap`）  

## Phase 2 — Store + 壳

1. [x] `stores/signboard.ts`  
2. [x] 替换 [`views/signboard/signboard.tsx`](../../../apps/client/src/views/signboard/signboard.tsx) 占位  
3. [x] 保持 `Decorations` + `findComponentLabel('signboard')`  

## Phase 3 — DnD 看板 UI

1. [x] Board / Column / Card / Toolbar / CardSheet（`views/signboard/`）  
2. [x] `@dnd-kit` 多 `SortableContext` + `DragOverlay`  
3. [x] 键盘移动  
4. [x] `debounce` 搜索  

## Phase 4 — Reminder / Calendar 联动

1. [x] 侧栏 due +「提醒我」  
2. [x] `reminderID` 写入与清理  
3. [x] 逾期/今日 chip 样式（`--warning` / `--destructive`）  

## Phase 5 — 视觉抛光

1. [x] Empty shader  
2. [x] 列语义色点  
3. [x] reduced-motion 回退  
4. [ ] 暗色回归（跟随时下产品 `.dark`；建议手测）  

## Phase 6 — 质量

1. [x] migration 内存测（`migration_runs_on_empty_sqlite`）  
2. [ ] 手动：拖拽持久化、重启恢复、提醒列表可见  
3. [ ] React Doctor / lint（若仓库惯例要求）  

## 非目标（仍延后）

- Cogito 同步 / `syncedAt` 逻辑  
- 协作、评论、附件  
- WIP 强制拦截 UI（字段可先存）  
