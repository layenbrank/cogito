# 03 — 信息架构与交互

## 1. 对象模型（用户语言）

```
看板 Board
 └─ 列 Column（有序）
     └─ 卡片 Card（有序）
卡片 ↔ 标签 Tag（多对多）
卡片 → Reminder?（可选）
卡片 → dueAt（可与 Reminder.dueAt 同步）
```

## 2. 导航

| 入口 | 行为 |
|------|------|
| Overview 磁贴 Signboard | 打开 `/signboard` 窗口 |
| 窗口内 Board ▾ | 切换看板；「管理看板…」 |
| 侧栏详情 | 点卡片打开；Esc / 点遮罩关闭 |
| 深链（后续） | `signboard?boardId=&cardId=` |

## 3. 核心流程

### 3.1 首次使用

1. 打开 Signboard → 若无看板，自动创建默认看板 + 三列：`待办` / `进行中` / `完成`  
2. Empty 氛围（shader）+ 「添加卡片」  
3. 用户可改列名、加列  

### 3.2 快速建卡

1. 点列底「添加卡片」或 `⌘N`（当前聚焦列）  
2. 仅输入标题，Enter 提交；Shift+Enter 保留并再建  
3. Esc 取消  

### 3.3 跨列拖拽

1. Pointer 移动 ≥6px 激活拖拽  
2. Overlay 跟随；原位半透明占位  
3. 落点：卡片之间的 primary 条，或空列虚线井  
4. `dragEnd`：乐观更新顺序 → IPC `update` 持久化 `index` + `columnID`  
5. 失败：回滚 + toast  

### 3.4 设到期 + 提醒

1. 侧栏选日期 → 写 `card.dueAt`  
2. 开关「提醒我」→ `toWriteReminder({ title: card.title, dueAt })` → 回写 `card.reminderID`  
3. 改标题时可选同步 Reminder.title（debounce 400ms，`lodash-es`）  
4. 归档卡片：不自动删 Reminder；可提示「同时关掉提醒」  

### 3.5 筛选

- 搜索：标题 / notes，`debounce(200)`  
- 标签：多选 OR  
- 到期：逾期 / 今日 / 七日 / 无日期  
- 筛选时保持列结构，弱化不匹配卡片  

## 4. 快捷键

| 键 | 动作 |
|----|------|
| `⌘N` | 当前列新建 |
| `⌘F` | 聚焦搜索 |
| `Enter` | 打开侧栏 / 提交 inline |
| `Esc` | 关闭侧栏 / 取消 inline |
| `⌘↑` / `⌘↓` | 列内上移/下移 |
| `⌘←` / `⌘→` | 移到相邻列（同 index 策略：插到目标列末或同相对位置） |
| `⌘⌫` | 归档当前卡片（需确认或可撤销 toast） |

键盘路径为 **可访问性硬需求**，不是锦上添花。

## 5. DnD 技术选型

| 方案 | 结论 |
|------|------|
| `@dnd-kit` + sortable | **采用** — 已依赖；多 `SortableContext`；与 React 19 亲和 |
| SortableJS | 备用参考（controller 网格已用）；看板以 dnd-kit 为准，避免双栈 |
| 原生 HTML5 DnD | 不做生产路径（触控与 Overlay 弱） |

模式参考：`apps/client/src/views/browser/sidebar.tsx`（单列表）扩展为多列表；文档笔记见 [`docs/reference/dnd-kit-grid.md`](../../../reference/dnd-kit-grid.md)。

## 6. 错误与空状态文案

| 状态 | 文案 |
|------|------|
| 无列 | 「还没有列。先建一列，再把事情放进去。」 |
| 无卡片 | 「拖到这里，或点下方添加。」 |
| 保存失败 | 「没能保存顺序，已恢复。再试一次？」 |
| Reminder 校验失败 | 「提醒需要到期时间。」（对齐现有校验） |
