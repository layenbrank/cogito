# Design System Master File — Signboard

> **LOGIC:** When building a specific page, first check `design-system/signboard/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.
>
> **Product alignment:** Token values mirror [`packages/design/src/styles/globals.css`](../../packages/design/src/styles/globals.css).
> Do not invent a parallel palette; Signboard is a magnetic-tile app inside i-thinking client.

---

**Project:** Signboard（看板）
**Category:** Personal productivity / Kanban (desktop magnetic tile)
**Design Dials:** Variance 4/10 | Motion 7/10 | Density 5/10
**Style:** Soft UI Evolution + calm depth (shaders as atmosphere, not decoration noise)

---

## Positioning

- **Job:** 让任务状态流转「摸得到、拖得稳、一眼懂」——比 Trello 更轻、比 Linear 更本地、比 Notion 看板更专注。
- **Not:** 团队协作平台、Jira 替代品、富文档工作区。
- **MVP scope:** 单用户本地 SQLite；多看板 + 标签；卡片到期 ↔ Reminder/Calendar；团队同步明确延后。

---

## Color Palette (semantic → product tokens)

| Role | Approximate | CSS Variable | Source |
|------|-------------|--------------|--------|
| Primary | indigo-violet | `--primary` | `globals.css` `:root` |
| On Primary | near-white | `--primary-foreground` | same |
| Background | white / dark slate | `--background` | light + `.dark` |
| Foreground | cool near-black | `--foreground` | same |
| Card | surface | `--card` | same |
| Muted | cool gray | `--muted` / `--muted-foreground` | same |
| Border | cool gray | `--border` | same |
| Warning (due soon) | amber | `--warning` | calendar/reminder |
| Destructive | red | `--destructive` | same |
| Success (done column) | teal-green | `--success` | same |
| Ring | = primary | `--ring` | same |

**Column accent (component-level, optional stripe):**

| Column semantic | Token use |
|-----------------|-----------|
| Backlog / Inbox | `--muted-foreground` |
| Active / Doing | `--primary` |
| Blocked | `--destructive` |
| Done | `--success` |

**Anti-patterns:** purple-on-white marketing gradients as the whole theme; cream+#terracotta; newspaper dense rules; glow-heavy cyberpunk; emoji icons.

---

## Typography

- **UI type:** 跟随 client / design 包现有字体栈（实现时不新增 Inter / Roboto / Arial / system-ui 作为品牌字体）。
- **Prototype / docs display:** Plus Jakarta Sans（Friendly SaaS pairing from ui-ux-pro-max）——仅用于 HTML 原型与设计文档示意。
- **Scale (board density 5):**
  - Board title: 20–22px / 600
  - Column title: 13px / 600 / uppercase tracking optional off（避免全大写噪音）
  - Card title: 14px / 500
  - Meta (due, tags): 12px / 400 / `--muted-foreground`

---

## Spacing

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | 4px | chip gap |
| `--space-sm` | 8px | card inner tight |
| `--space-md` | 12–16px | card padding |
| `--space-lg` | 20–24px | column padding |
| `--space-xl` | 32px | board chrome |
| Column width | 280–300px | fixed; horizontal scroll for overflow |
| Card radius | `var(--radius)` (~10px) | match design |
| Column radius | `calc(var(--radius) + 2px)` | slightly softer well |

---

## Shadows & depth

| Level | Usage |
|-------|-------|
| none / hairline border | resting card |
| `--shadow-sm` | card hover |
| `--shadow-md` | drag overlay |
| soft inset well | column body background (`--muted` at low opacity) |

Avoid multi-layer neon glows. Depth comes from **column wells + drag lift**, not glow.

---

## Motion

| Interaction | Duration | Easing | Notes |
|-------------|----------|--------|-------|
| Card hover lift | 150–200ms | ease-out | translateY(-1px) only; no layout shift |
| Drag overlay | immediate attach | — | opacity 0.95, shadow-md |
| Drop settle | 200–250ms | ease-out | `@dnd-kit` transform transition |
| Column enter | 300–400ms | power1.out | stagger 0.04s per column |
| Card appear | 250–350ms | power1.out | stagger ≤0.03s; long lists virtualize |
| Empty board shader | continuous, low | — | `prefers-reduced-motion: reduce` → static gradient |

**Do:** keyboard equivalents for every drag (`Cmd/Ctrl+↑↓` move within column; `Cmd/Ctrl+←→` cross column).
**Don't:** animate width/height of columns during drag; decorative-only particle spam.

---

## Component specs (Signboard-specific)

### Board chrome

- Top: board switcher (select) + search + filter chips + 「新建卡片」primary
- No secondary marketing strips; one job: manage this board

### Column

- Header: title + count + `⋯` menu (rename / archive / WIP limit optional later)
- Body: vertical scroll; `SortableContext` per column
- Footer: 「添加卡片」ghost — inline create, Enter to commit, Esc cancel

### Card

- Title (required) + optional due chip + up to 2 tag chips visible (+N)
- Drag handle optional: whole card is draggable; pointer sensor `activationConstraint: { distance: 6 }`
- Click opens side sheet (not modal) for notes / due / reminder / tags / archive

### Drag affordances

- Drop indicator: 2px primary bar between cards
- Empty column: dashed well + short hint「拖到这里」
- Cross-column: `onDragOver` highlights column border with `color-mix(primary 35%)`

---

## Shaders (atmosphere)

| Surface | Effect | Package |
|---------|--------|---------|
| Empty board / first-run | soft Swirl or mesh under content at 8–12% opacity | `shaders/react` |
| Drag success micro | optional CursorRipples at drop point, one-shot | same |
| Done column | very subtle FilmGrain 3–5% | same |

Shaders **never** sit under dense card text at high opacity. Respect reduced motion.

---

## Anti-patterns

- ❌ Trello-style rainbow labels as primary hierarchy
- ❌ Cards as heavy bordered “dashboard widgets” with stats
- ❌ Hero overlays / floating badges on the board
- ❌ Instant DnD without overlay or keyboard path
- ❌ Overloading Collection (`collectionID` magnetic tiles) as kanban boards

---

## Pre-Delivery Checklist

- [ ] Uses `@i-thinking/design` tokens / Tailwind semantic classes
- [ ] Lucide icons only (marketplace already maps `lucide:kanban`)
- [ ] `cursor-pointer` + visible focus ring (`--ring`)
- [ ] Drag + keyboard parity
- [ ] `prefers-reduced-motion`
- [ ] Light + dark via `.dark`
- [ ] Window shell: `Decorations` + Caption（`decorations: false`）
