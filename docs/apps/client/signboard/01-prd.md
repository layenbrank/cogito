# 01 — PRD：Signboard

## 1. 愿景

让个人任务的**状态流转**像挪动桌面上的便签一样自然：拖得稳、看得清、记得住，且与日历/提醒同源，而不是又一个需要「学一遍」的项目管理系统。

## 2. 问题陈述

市场上 Kanban / Board 产品普遍存在：

1. **拖拽体验差** — 卡顿、跨列无明确落点、仅鼠标可用  
2. **信息过载** — 卡片堆满字段、看板变成小仪表盘  
3. **新建摩擦高** — 多步弹窗才能写下一个动作  
4. **状态语义弱** — 列名随意，Done / Blocked 缺少视觉差  
5. **与时间脱节** — 到期日是「装饰」，不进真正的提醒系统  
6. **本地工具缺失** — 云端优先，桌面端离线与隐私场景被忽视  

cogito client 已有 Signboard 磁贴占位与本地 SQLite（Calendar / Reminder），具备差异化落地条件。

## 3. 目标用户

| Persona | 场景 | 核心诉求 |
|---------|------|----------|
| 个人创作者 / 开发者 | 自己的一周工作流 | 快拖、快建、本地可靠 |
| 已用 Calendar/Reminder 的用户 | 卡片有截止日期 | 到期自动进提醒，不双写两套系统 |
| 多主题并行者 | 生活 / 工作 / 副业 | 多看板切换；标签筛选 |

**非目标用户（MVP）：** 需要成员权限、评论@、Sprint 报表的团队。

## 4. 产品原则

1. **手感优先** — DnD 与键盘同权；任何拖拽都有 Overlay 与落点指示  
2. **一屏一事** — 主视图只有看板；详情进侧栏  
3. **时间同源** — `dueAt` / `reminderID` 对齐现有 Reminder 语义（见 [05-reminder-calendar](../tauri-command-database/05-reminder-calendar.md)）  
4. **模型可长** — 首日即多看板 + 标签表；不为「以后加」而改 schema  
5. **克制视觉** — shaders 作氛围，不抢卡片可读性  

## 5. MVP 范围（In）

- 多看板 CRUD（至少默认「个人」看板）  
- 列 CRUD + 排序；卡片 CRUD + 列内/跨列排序  
- `@dnd-kit` 多容器拖拽 + 键盘移动  
- 标签（多对多）与筛选  
- 卡片 `dueAt`；可选绑定 / 创建 Reminder  
- 侧栏详情（notes、标签、到期、归档）  
- 本地 SQLite 持久化 + Zustand store  
- Empty 态 shaders 氛围  
- 窗口壳：`Decorations` + 现有 Caption  

## 6. 明确 Out（MVP）

- 实时协作、成员、评论、附件云同步  
- 自定义工作流规则引擎 / 自动化  
- 看板 ↔ Collection 磁贴文件夹混用  
- Cogito HTTP 同步层  
- 移动端独立布局（桌面优先；窗口缩小时列纵向堆叠可后续）  

## 7. 成功指标（设计验收）

| 指标 | 目标 |
|------|------|
| 首次添加卡片 | ≤ 2 次点击或 1 次快捷键 |
| 跨列拖拽 | 有 Overlay + 落点条；无布局抖动 |
| 键盘完成「卡片下移一格」 | 有文档化快捷键且可用 |
| 设到期并开提醒 | 侧栏一次操作；Reminder 列表可见同源项 |
| 刷新 / 重启后顺序 | 与拖拽结果一致（持久化） |

## 8. 品牌语气（Signboard 文案）

- 短、动作导向：「添加卡片」「拖到这里」「设到期」  
- 避免：Jira 黑话（Epic、Sprint）、恐吓式空状态  
- 空状态示例：「还没有列。先建一列，再把事情放进去。」  

## 9. 依赖与约束

- 路由 / 磁贴：已有 `signboard` component、`/signboard`  
- UI：`@cogito/design` + Tailwind v4  
- DnD：优先 `@dnd-kit`（仓库已装；browser sidebar 有垂直先例）  
- 工具：`lodash-es`（`debounce` 搜索、`throttle` 滚动）  
- 持久化：client SQLite migrations（对齐 album / calendar）
