# Signboard（看板）产品设计包

> 状态：**企业级交互抛光中**（已去掉 `window.prompt`，补齐 Dialog / 菜单 / Toast / 拖拽手柄 / Switch 侧栏）。  
> 场景：**2A+2B+2C** — 个人本地 + 日历/提醒联动 + 多看板/标签预留；团队同步延后。  
> 实现见 [06-implementation-roadmap.md](./06-implementation-roadmap.md)。

| 文档 | 内容 |
|------|------|
| [01-prd.md](./01-prd.md) | 愿景、用户、范围、成功指标 |
| [02-competitive.md](./02-competitive.md) | 市场对标与「为什么不好用」 |
| [03-ia-interaction.md](./03-ia-interaction.md) | 信息架构、关键、快捷键 |
| [04-data-model.md](./04-data-model.md) | SQLite 表、IPC、与 Reminder/Calendar |
| [05-visual-motion.md](./05-visual-motion.md) | 视觉、shaders、动效 |
| [06-implementation-roadmap.md](./06-implementation-roadmap.md) | 确认后的实现清单 |
| [prototype/index.html](./prototype/index.html) | 可交互 HTML 原型（SortableJS 跨列拖拽） |

设计系统：[`design-system/signboard/MASTER.md`](../../../design-system/signboard/MASTER.md)

## 一句话

**Signboard** 是 i-thinking 桌面端磁贴应用：本地持久化的多列看板，拖拽手感与即时反馈优先，并与现有 Reminder / Calendar 到期语义打通。
