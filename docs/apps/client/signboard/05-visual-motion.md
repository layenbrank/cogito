# 05 — 视觉与动效

依据：[`design-system/signboard/MASTER.md`](../../../design-system/signboard/MASTER.md)、ui-ux-pro-max Soft UI Evolution、产品 [`globals.css`](../../../packages/design/src/styles/globals.css)。

## 1. 视觉方向

- **Soft UI Evolution**：轻阴影、清晰对比、冷灰中性面 + 产品 indigo-violet primary  
- **第一屏**：只有品牌壳（Caption）+ 看板本体；禁止统计条 / 营销 chip 云  
- **卡片默认不像「仪表盘卡片」**：细边框 + 井式列背景即可；拖起时才明显抬升  

## 2. 颜色语义（组件层）

| 元素 | 处理 |
|------|------|
| 列「完成」 | 左侧 3px `--success` 条或标题旁小圆点 |
| 列「阻塞」（用户自建） | `--destructive` 点，**同时**文案/图标，不止靠色 |
| 逾期 chip | `--destructive` 底 12% + 文字 |
| 今日到期 | `--warning` |
| 标签 | 低饱和色点 + 文字；最多展示 2 个 |

## 3. Shaders 用法

实现位置建议：`views/signboard/` 内小组件，import from `shaders/react`（与 signin brand / gallery vault 一致）。

| 时机 | 效果 | 强度 |
|------|------|------|
| 空看板 | Swirl 或柔和 mesh | opacity 0.08–0.12，在内容层下 |
| 首次完成跨列拖到「完成」 | 一次性短 CursorRipples | 400ms 后卸载 |
| 「完成」列背景 | FilmGrain | 0.03–0.05 |

`prefers-reduced-motion: reduce` → 静态 `linear-gradient` 替代连续 shader。

## 4. 动效时间表

对齐 ui-ux-pro-max Stagger List（Subtle/Standard）：

- 列挂载：opacity + y:8，stagger 0.04s，250–350ms，`power1.out`（**不用** back.out，避免看板发飘）  
- 卡片插入：同 subtle stagger  
- 拖拽：交给 `@dnd-kit` transform；勿再包一层抢 CSS transition  

## 5. lodash-es

| API | 用途 |
|-----|------|
| `debounce` | 搜索输入 200ms；侧栏标题同步 Reminder 400ms |
| `throttle` | 看板横向自动滚动（靠近边缘时）100ms |
| `isEmpty` | 空态判断 |

## 6. 原型与实现差异

| 原型 HTML | 生产 |
|-----------|------|
| SortableJS CDN | `@dnd-kit` |
| CSS mesh 背景 | `shaders/react` |
| 内存数组 | SQLite + Zustand |
| Plus Jakarta Sans | 跟随 app 字体栈 |

## 7. Banner / 市场物料（可选后续）

若需应用商店或官网封面：按 banner-design — Website Hero 1920×600–1080，Art：Minimalist + Geometric，文案「拖得稳的本地看板」，**确认实现后再出**，避免设计空转。
