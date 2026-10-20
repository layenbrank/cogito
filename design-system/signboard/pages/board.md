# Page override — Board（看板主视图）

Overrides [`../MASTER.md`](../MASTER.md) for `/signboard` main surface.

## Layout

```
┌─ Decorations / Caption ─────────────────────────────────┐
│  Signboard · {boardTitle}                    ○ ● ×      │
├─ Toolbar ───────────────────────────────────────────────┤
│  [Board ▾]  🔍 Search   Tags…   Due…   [+ 新建卡片]     │
├─ Board (horizontal scroll) ─────────────────────────────┤
│  ┌ Column ┐ ┌ Column ┐ ┌ Column ┐ ┌ + 列 ┐             │
│  │ cards  │ │ cards  │ │ cards  │ │      │             │
│  └────────┘ └────────┘ └────────┘ └──────┘             │
└─ Side sheet (card detail, overlay from right) ──────────┘
```

## Density

- Column gap: 12px
- Card gap: 8px
- First viewport = **board only**（无统计 strip、无「本周」营销块）

## States

| State | UI |
|-------|-----|
| Loading | column skeletons (3×) |
| Empty board | shader atmosphere + CTA「添加第一列」/「从模板开始」 |
| Empty column | dashed drop zone |
| Filtering | non-matching cards `opacity: 0.28`; columns stay |
| Offline / IPC error | toast + retry；不丢本地乐观顺序 |

## Interaction priorities

1. Cross-column drag (dnd-kit multiple containers)
2. Inline create
3. Due chip → open reminder link
4. Board switcher
