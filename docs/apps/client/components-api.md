# cogito Client 业务组件文档

本文件包含 `apps/client/src/components` 下业务通用组件的聚合文档。

> 总计 5 个组件包：ContextMenu、Combobox、Glide、Fallback、Provider  
> 不含 tiptap-\* 编辑器子树。

---

## contextmenu-cn

Source: `apps/client/src/components/contextmenu/`

---

category: Components
title: ContextMenu
subtitle: 右键菜单
description: 企业级可无限嵌套的右键菜单，支持声明式与命令式 API，主题走设计 token。
group:
title: 通用
order: 1
---

## 实现总结 {#implementation-summary}

ContextMenu **未**使用设计系统的 `DropdownMenu` 组合，而是自研递归面板，原因：

1. 全局 Menu recipe（侧栏黑底）会污染弹出菜单外观
2. 需要统一的 motion 进退场与多级定制渲染
3. 需要细粒度视口边界策略（每级子菜单独立 flip / shift）

| 能力     | 实现                                                                                 |
| -------- | ------------------------------------------------------------------------------------ |
| 面板     | 自研递归 `MenuPanel`（`panel.tsx`）                                                  |
| 数据结构 | `ContextMenuItem` 递归 `children`，`parseItems` 规范化                               |
| 定位     | `parsePopupOrigin`：根菜单相对指针，子菜单相对父项；flip + shift + `boundaryPadding` |
| 主题     | `contextmenu.scss` 全部使用设计 token（`var(--popover)` / `var(--border)` …）        |
| 动效     | `motion/react`（导入别名 `motion as Motion`）+ `useReducedMotion`                    |
| 声明式   | `<ContextMenu items={...}>{children}</ContextMenu>`                                  |
| 命令式   | `useContextMenu().open({ x, y, items })` + `<ContextMenu.Host />`                    |

键盘：↑↓ 移动、→ 进子级、← 回退、Enter / Space 激活、Esc 关闭。点击外部或窗口 resize 关闭。

## 何时使用 {#when-to-use}

- 需要在区域上右键弹出操作菜单
- 需要多级子菜单、快捷键提示、危险项、分组与分割线
- 画布 / 非 DOM 触发场景需按坐标命令式打开菜单

## 代码演示 {#examples}

### 基本（声明式）

```tsx
import { Icon } from '@iconify/react/offline'

import { ContextMenu } from '@/components/contextmenu'

export default function Demo() {
  return (
    <ContextMenu
      items={[
        {
          key: 'copy',
          label: '复制',
          icon: <Icon icon="ant-design:copy-outlined" />,
          shortcut: 'Ctrl+C'
        },
        { type: 'divider' },
        {
          key: 'delete',
          label: '删除',
          icon: <Icon icon="ant-design:delete-outlined" />,
          danger: true
        }
      ]}
      onClick={function (info) {
        console.log(info.key, info.keyPath)
      }}>
      <div style={{ padding: 48, border: '1px dashed #d9d9d9' }}>在此区域右键</div>
    </ContextMenu>
  )
}
```

### 多级子菜单

```tsx
import { ContextMenu, type ContextMenuItem } from '@/components/contextmenu'

const items: ContextMenuItem[] = [
  { key: 'edit', label: '编辑' },
  {
    key: 'export',
    label: '导出',
    children: [
      { key: 'png', label: 'PNG' },
      {
        key: 'vector',
        label: '矢量',
        children: [
          { key: 'svg', label: 'SVG' },
          { key: 'pdf', label: 'PDF' }
        ]
      }
    ]
  },
  { type: 'divider' },
  { key: 'delete', label: '删除', danger: true }
]

export default function NestedDemo() {
  return (
    <ContextMenu items={items}>
      <div style={{ padding: 48 }}>右键打开多级菜单</div>
    </ContextMenu>
  )
}
```

### 命令式

需在应用树中挂载一次 `ContextMenu.Host`（通常放在根布局）。

```tsx
import { ContextMenu, useContextMenu } from '@/components/contextmenu'

export function AppShell() {
  return (
    <>
      <ContextMenu.Host />
      <Canvas />
    </>
  )
}

function Canvas() {
  const menu = useContextMenu()

  return (
    <div
      style={{ width: 400, height: 300, background: '#f5f5f5' }}
      onContextMenu={function (event) {
        event.preventDefault()
        menu.open({
          x: event.clientX,
          y: event.clientY,
          items: [
            { key: 'pin', label: '固定' },
            { key: 'remove', label: '移除', danger: true }
          ],
          onClick: function (info) {
            console.log(info.key)
          }
        })
      }}
    />
  )
}
```

## API

### ContextMenu

| 属性               | 说明                                                 | 类型                                   | 默认值                |
| ------------------ | ---------------------------------------------------- | -------------------------------------- | --------------------- |
| items              | 菜单数据（可递归 `children`）                        | `ContextMenuItem[]`                    | —                     |
| children           | 触发区域；右键打开菜单。可为单一可克隆元素或任意节点 | `ReactNode`                            | —                     |
| disabled           | 禁用右键菜单                                         | `boolean`                              | `false`               |
| open               | 受控打开状态                                         | `boolean`                              | —                     |
| className          | 触发器 class（合并到子元素或包装 div）               | `string`                               | —                     |
| classNames         | 语义化 class，见 Semantic 文档                       | `ContextMenuClassNames`                | —                     |
| styles             | 语义化行内样式                                       | `ContextMenuStyles`                    | —                     |
| motion             | 覆盖根面板 / 子菜单 motion variants                  | `ContextMenuMotion`                    | 内置                  |
| offset             | 根菜单相对指针偏移 `[x, y]`                          | `[number, number]`                     | `[0, 4]`              |
| submenuOffset      | 子菜单相对父项偏移                                   | `[number, number]`                     | `[4, 0]`              |
| boundaryPadding    | 视口 / 容器内边距                                    | `number`                               | `8`                   |
| submenuOpenDelay   | 悬停打开子菜单延迟（ms）                             | `number`                               | `100`                 |
| submenuCloseDelay  | 离开后关闭子菜单延迟（ms）                           | `number`                               | `160`                 |
| findPopupContainer | 弹层挂载容器                                         | `() => HTMLElement`                    | `() => document.body` |
| renderItem         | 自定义单项渲染                                       | `(item, node) => ReactNode`            | —                     |
| renderPanel        | 自定义面板内容包装                                   | `(nodes, meta) => ReactNode`           | —                     |
| onOpenChange       | 打开状态变化                                         | `(open: boolean) => void`              | —                     |
| onClick            | 点击叶子项                                           | `(info: ContextMenuClickInfo) => void` | —                     |

### ContextMenuItem

| 属性              | 说明                                             | 类型                  | 默认值  |
| ----------------- | ------------------------------------------------ | --------------------- | ------- |
| key               | 唯一键；缺省时由 `parseItems` 生成               | `string`              | —       |
| type              | `item` / `divider` / `group`；可省略，按结构推断 | `ContextMenuItemKind` | `item`  |
| label             | 文案                                             | `ReactNode`           | —       |
| icon              | 左侧图标                                         | `ReactNode`           | —       |
| shortcut          | 右侧快捷键提示（亦可使用 `extra`）               | `ReactNode`           | —       |
| extra             | 额外节点（与 shortcut 二选一展示逻辑）           | `ReactNode`           | —       |
| danger            | 危险样式                                         | `boolean`             | `false` |
| disabled          | 禁用                                             | `boolean`             | `false` |
| children          | 子菜单项（无限级）                               | `ContextMenuItem[]`   | —       |
| className / style | 单项样式                                         | —                     | —       |
| onClick           | 单项点击（先于菜单级 `onClick`）                 | `(info) => void`      | —       |

### ContextMenuClickInfo

| 字段     | 说明                  | 类型                          |
| -------- | --------------------- | ----------------------------- |
| key      | 当前项 key            | `string`                      |
| keyPath  | 从根到当前的 key 路径 | `string[]`                    |
| domEvent | 鼠标或键盘事件        | `MouseEvent \| KeyboardEvent` |
| item     | 原始项（解析后）      | `ContextMenuItem`             |

### useContextMenu

```ts
const { open, close } = useContextMenu()

open(payload: OpenPayload): void
close(): void
```

`OpenPayload`：`{ x, y, items, ...HostConfig }`，可覆盖与 `ContextMenu` 相同的定制字段（`classNames`、`motion`、`onClick` 等）。

### ContextMenu.Host

无 props。渲染命令式菜单的 Portal 宿主，应用内通常只挂一次。

### 工具函数

| 函数                        | 说明                                                      |
| --------------------------- | --------------------------------------------------------- |
| `parseItems(items)`         | 规范化 items，补全 key / type / 递归 children             |
| `findFocusableItems(items)` | 可键盘聚焦的 item 列表（跳过 divider / group / disabled） |
| `parsePopupOrigin(input)`   | 计算面板 `left/top` 与 `flipX/flipY`                      |

---

## combobox-cn

Source: `apps/client/src/components/combobox/`

---

category: Components
title: Combobox
subtitle: 组合输入框
description: 带可展开下拉区的输入组合框，支持前缀/后缀、IME 合成与 motion 展开动画。
group:
title: 通用
order: 2
---

## 何时使用 {#when-to-use}

- 需要「输入 + 下拉面板」一体的组合控件
- 下拉内容自定义（列表、复杂区块均可通过 `section` 传入）
- 需要处理中文等 IME 合成输入，避免合成过程中频繁 `onUpdate`

## 代码演示 {#examples}

### 基本

```tsx
import { useState } from 'react'
import { Combobox } from '@/components/combobox'

export default function Demo() {
  const [value, setValue] = useState('')
  const [visible, setVisible] = useState(false)

  return (
    <Combobox
      value={value}
      visible={visible}
      placeholder="搜索…"
      onClick={function () {
        setVisible(true)
      }}
      onUpdate={function (next) {
        setValue(next)
        setVisible(true)
      }}
      section={
        <Combobox.Series
          options={[
            { key: '1', label: '选项一', value: '1' },
            { key: '2', label: '选项二', value: '2', mark: '★' }
          ]}
        />
      }
    />
  )
}
```

### 自定义列表项

```tsx
<Combobox
  visible
  section={
    <Combobox.Series
      options={options}
      single={function (option) {
        return (
          <span>
            {option.label} ({option.value})
          </span>
        )
      }}
    />
  }
/>
```

## API

### Combobox

| 属性        | 说明                                         | 类型                                     | 默认值    |
| ----------- | -------------------------------------------- | ---------------------------------------- | --------- |
| value       | 受控输入值                                   | `string`                                 | —         |
| placeholder | 占位符                                       | `string`                                 | —         |
| className   | 根 class                                     | `string`                                 | —         |
| classNames  | `root` / `trigger` / `section`               | `object`                                 | —         |
| offset      | 下拉相对根高度的偏移（px）；不传则用测量高度 | `number`                                 | 测量值    |
| prefix      | 输入前缀                                     | `ReactNode`                              | —         |
| suffix      | 输入后缀                                     | `ReactNode`                              | —         |
| section     | 下拉面板内容                                 | `ReactNode`                              | —（必填） |
| visible     | 是否展示下拉                                 | `boolean`                                | —         |
| onUpdate    | 输入更新（IME 合成中不触发；合成结束触发）   | `(value, domStringified, event) => void` | —         |
| onClick     | 根节点点击                                   | `(event) => void`                        | —         |
| ref         | 根 div ref                                   | `Ref<HTMLDivElement>`                    | —         |

展开时根节点带 `is-active` class；下拉使用 `motion` 做 scaleY / opacity 动画。

### Combobox.Series

| 属性    | 说明           | 类型                    | 默认值            |
| ------- | -------------- | ----------------------- | ----------------- |
| options | 选项列表       | `SeriesOption[]`        | —                 |
| single  | 自定义单项渲染 | `(option) => ReactNode` | 默认 mark + label |

### SeriesOption

| 属性  | 说明                      | 类型        |
| ----- | ------------------------- | ----------- |
| key   | React key                 | `string`    |
| label | 展示文案                  | `string`    |
| value | 选项值（写入 `datatype`） | `string`    |
| mark  | 可选标记节点              | `ReactNode` |

---

## glide-cn

Source: `apps/client/src/components/glide/`

---

category: Components
title: Glide
subtitle: 滚动容器
description: 横向 / 纵向滚动容器。`Glide.X` 通过 CSS 旋转技巧将垂直滚轮映射为水平滚动。
group:
title: 通用
order: 3
---

## 何时使用 {#when-to-use}

- 需要统一的横向或纵向可滚动内容区
- 横向列表希望保留鼠标滚轮的自然垂直手势（`Glide.X`）

## 代码演示 {#examples}

### 横向滚动

```tsx
import { Glide } from '@/components/glide/glide'

export default function Demo() {
  return (
    <Glide.X style={{ height: 120, width: 320 }}>
      {Array.from({ length: 12 }, function (_, i) {
        return (
          <div
            key={i}
            style={{ width: 80, height: 80, flexShrink: 0, marginRight: 8, background: '#eee' }}>
            {i}
          </div>
        )
      })}
    </Glide.X>
  )
}
```

### 纵向滚动

```tsx
import { Glide } from '@/components/glide/glide'

export default function Demo() {
  return (
    <Glide.Y style={{ height: 200, width: 280 }}>
      <div style={{ height: 800 }}>长内容…</div>
    </Glide.Y>
  )
}
```

## API

### Glide.X / Glide.Y

二者 Props 相同。

| 属性       | 说明                                  | 类型              | 默认值 |
| ---------- | ------------------------------------- | ----------------- | ------ |
| children   | 滚动内容                              | `ReactNode`       | —      |
| className  | 根 class（`ClassValue`）              | `ClassValue`      | —      |
| classNames | `root` / `wrapper` / `inner`          | `object`          | —      |
| style      | 根行内样式                            | `CSSProperties`   | —      |
| styles     | `root` / `wrapper` / `inner` 行内样式 | `object`          | —      |
| onScroll   | 滚动回调（绑在 wrapper 上）           | `(event) => void` | —      |

**结构**

- `Glide.X`：`root` → `wrapper(-90°)` → `inner(+90°, flex)`；通过 `--glide-width` / `--glide-height` CSS 变量同步尺寸
- `Glide.Y`：`root` → `wrapper(overflow-y)` → `inner`

---

## fallback-cn

Source: `apps/client/src/components/fallback/`

---

category: Components
title: Fallback
subtitle: 回退占位
description: 路由级全屏加载占位。
group:
title: 通用
order: 4
---

## 何时使用 {#when-to-use}

- React Router / 懒加载路由的 `Suspense` fallback
- 需要全视口居中的 Loading 指示

## 代码演示 {#examples}

### 路由 Fallback

```tsx
import { Suspense } from 'react'
import { Fallback } from '@/components/fallback'

export default function RouteShell() {
  return (
    <Suspense fallback={<Fallback.Route />}>
      <LazyPage />
    </Suspense>
  )
}
```

## API

### Fallback.Route

全视口居中的加载指示（`Spinner`）。

| 属性 | 说明   | 类型 | 默认值 |
| ---- | ------ | ---- | ------ |
| —    | 无入参 | —    | —      |

导出形态：

```ts
export const Fallback = { Route, ErrorBoundary }
```

### Fallback.ErrorBoundary

错误边界；命中后在原位渲染一行提示，不冒泡打断整条路由。

| 属性     | 说明       | 类型        | 默认值 |
| -------- | ---------- | ----------- | ------ |
| children | 受保护子树 | `ReactNode` | —      |

---

## caption-cn

Source: `apps/client/src/features/window-shell/`

---

category: Components
title: Window Shell
subtitle: 主窗自绘操作栏与内容壳
description: decorations: false；ShellFrame 常驻 Caption + OverlayHost；页用 useShellSurface 申报槽。
group:
title: 窗口
order: 1
---

## 何时使用 {#when-to-use}

- 主窗由 `WorkspaceShell` 挂 `ShellFrame`（勿在页内再包一层壳）
- 应用页：`useShellSurface({ begin, final, section, summary, scrollable })`
- Overview：操作栏由壳按路由模式组合（`center` Omnibar + trailing）；页不写 slots
- Dialog / Sheet / AlertDialog 默认 Portal 进 `ShellOverlayHost`，**遮罩不得盖住操作栏与窗控**
- 命名禁用 `chrome`（与浏览器 Chrome 歧义）

## 代码演示 {#examples}

### 应用页申报槽

```tsx
import { Button } from '@cogito/design/components/button'
import { useShellSurface } from '@/features/window-shell/slots'

export default function Bookmark() {
  useShellSurface({
    summary: '书签库',
    scrollable: false,
    section: <Button>导入</Button>
  })
  return <div>…</div>
}
```

## API

### Caption（`features/window-shell/caption`）

| 属性      | 说明                                                           | 类型                                                                                | 默认值 |
| --------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------ |
| begin     | 顶栏左侧主区域                                                 | `ReactNode`                                                                         | —      |
| center    | 中间列（Overview Omnibar）；有值时用三列 grid，不插会话条      | `ReactNode`                                                                         | —      |
| final     | 顶栏右侧扩展区域（渲染在窗口键左侧）                           | `ReactNode`                                                                         | —      |
| controls  | 窗口键开关；`true` 默认键全开；对象可关单项或开可选键（`pin`） | `boolean \| Partial<Record<'minimize' \| 'maximize' \| 'close' \| 'pin', boolean>>` | `true` |

### useShellSurface

| 字段 | 说明 |
| ---- | ---- |
| begin / final / section | 操作栏与底栏槽 |
| summary | 无 begin 时的纯文本标题（有会话条时抑制） |
| scrollable | 内容区是否由壳滚动；复杂页 `false` |
| controls / className | 窗控与内容列 class |

**结构**

- 根透明；内容区 `bg-background`；`ShellOverlayHost` 为弹层 Portal 容器
- 拖拽：`data-region="true"|"false"`（不用 `data-tauri-drag-region`）
- 磁贴激活：`activateTile` → 主窗 `router.navigate`（会话列表切换，非整窗重建）

#### 窗口划分

应用**不再内置浏览器**。网址一律走系统默认浏览器（`openUrl`）。

| 路由 | 内容 |
| ---- | ---- |
| `/overview` | 磁贴墙；操作栏 center=Omnibar，final=镜像/状态/账号 |
| `/code` 等应用页 | `useShellSurface` + 业务内容；主窗会话条自动出现 |
| `/overlay` | 无操作栏浮层 |

打开网址：

- Overview Command Omnibar：本地优先（磁贴 / 日程 / Agent / 媒体 / 备忘 / 命令），Web 建议走 `search:suggest`；像 URL 或选中 Web 项 → `openUrl`
- `navigation` 磁贴：`activateTile` → `openUrl(tile.url)`
- 引擎切换：横向展开芯片（非下拉弹层）；快捷键 `mod+k` 聚焦命令栏

Chrome 书签导入（主路径）：

- 路由 `/bookmark`：资源管理器式导入 + 文件夹浏览（`views/bookmark`）
- **独立表 `bookmark`**：树形文件夹/链接入库；重复链接可选跳过或覆盖
- **可选挂磁贴**：文件夹页勾选后可添加为 `navigation` 或 `collection`（非导入默认全量建磁贴）
- IPC：`bookmark:import` / `bookmark:read` / `write` / `update` / `remove`
- 市场「网址」模式 / overview 顶栏有导入入口

---

## 磁贴激活（主窗路由会话）

原来的 `MagneticTile.Overlay`（antd `Modal` 门面）已删除：**磁贴双击在主窗内 navigate**（`activateTile` → `admitSession` + `router.navigate`）。

| 环节   | 位置                                                       |
| ------ | ---------------------------------------------------------- |
| 激活   | `src/features/magnetic-tile/activate.ts`（`activateTile`） |
| 窗口壳 | `src/features/window-shell/`（`ShellFrame` / `Caption`）   |
| 内容   | `src/views/<component>/<component>.tsx`                    |
| 路由   | `src/routers/index.tsx`                                    |

- 主窗 `decorations: false`；`ShellFrame` 根透明，材质由窗口自身（mica / 透明）承担
- 应用页经 `useShellSurface` 申报操作栏；切应用时 Caption / 窗控常驻

### 主窗口 Overview 操作栏

由 `WorkspaceShell` 注入 `ShellFrame`（`views/overview/caption/trail.tsx`）：

| 位置           | 内容                                                                  |
| -------------- | --------------------------------------------------------------------- |
| `center`       | Command Omnibar（`features/command-bar`）                             |
| `final`（右）  | **镜像**（`caption/mirror.tsx`）+ **状态** + **账号**                 |
| 窗口键         | `Caption` 自绘（最小化 / 最大化 / 关闭）                              |

- **镜像入口**（切换 + 管理）：触发按钮＝「序号 + 当前镜像标题」+ chevron，**始终可点** —— 多个时点开是切换，单个时点开是管理面，一个都没有时直接给「新建镜像」。列表支持 ↑↓、Home/End、Enter，Esc 关闭；每行带「重命名」（行内输入，Enter 保存 / Esc 取消 / 失焦保存）与「删除」（`AlertDialog` 二次确认，删的若是当前镜像会自动切到剩下的第一个）；底部「新建镜像」（按 `镜像-0N` 顺延命名）。注意这几个操作原先**全仓没有任何 UI**，`stores/mirror.ts` 的 `toInsertMirror` / `toUpdateMirror` / `toRemoveMirror` 因此一直没有调用者
- **状态区**：把原来两颗一次性 toast 变成常驻芯片 —— `corex 未就绪`（点击重新检测）、`可更新 vX.Y.Z`（点击安装，✕ 忽略）。更新来自启动时的静默检查（`autoCheckUpdate`），状态由 `utils/updater.ts` 的 `subscribeUpdateStatus` 暴露
- **账号**：未登录＝登录按钮（开 `ReSignIn`）；已登录＝头像 + 菜单（需要 `DropdownMenuGroup` 包住 `DropdownMenuLabel`，base-ui 的 `GroupLabel` 脱离 Group 会抛错）
- 曾经的 `OverviewCapsule`（贴边纵向胶囊：gsap 拖拽 + 贴左右边 + 位置持久化）**已删除**：镜像切换与账号收进标题栏，那套自定义拖拽状态机不再需要
- 别退回页内自挂操作栏：flex 高度由 `ShellFrame` 统一提供（`h-full flex-col` + 内容 `min-h-0 flex-1`）
- `/overlay` 是刻意的无操作栏浮层（alwaysOnTop、skipTaskbar、`maximized`、不可 resize）
- 弹层（Dialog / Sheet）Portal 进 `ShellOverlayHost`，不得盖住操作栏

### 目录职责：磁贴表面 vs 磁贴窗口

一个组件有两块实现，**别混着放**（`views/<tile>` 是窗口，`features/magnetic-tiles/<tile>` 是板上那块磁贴）：

| 目录                                  | 归属       | 放什么                                                                                                  |
| ------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| `src/views/<tile>/`                   | 磁贴窗口页 | 双击磁贴后开的整个界面：`<tile>.tsx` + 其私有实现（`workspace/**`、`panels/**`、`calendar-view.tsx` …） |
| `src/features/magnetic-tiles/<tile>/` | 磁贴表面   | 板上那块磁贴：`<tile>.tsx`（`MagneticTile.Section`）、`marker.tsx`、尺寸 scss                           |
| 两侧共用件                            | 同上       | 表面与窗口都要用的（如 clock 的 `faces/**`、`flip-digit.tsx`、`alarm-time.ts`）放 `features/…/<tile>/`  |

- 判定口径：只被 `views/<tile>/**` 可达 → 属于窗口；磁贴表面（`features/controller/reflection.tsx`）也用到 → 留在 features
- 窗口页的代码分割按 `views/<component>/**` 归到 `tile-<component>` chunk（见 `vite.chunk.ts`）

### 窗口内分屏：布局路由 + 子页（agent 窗口）

一个窗口要多个互斥页面时，用**布局路由当出口**，不要页内 Dialog / 布尔开关（对齐 studio 的 `/agent`）：

| 位置                                    | 职责                                                     |
| --------------------------------------- | -------------------------------------------------------- |
| `src/views/agent/agent.tsx`             | 出口：全局设置初始化 + `<Outlet />`（无自有 UI）         |
| `src/views/agent/chat/chat.tsx`         | 子页：三栏工作台（工作区 \| 主对话 \| Plan）             |
| `src/views/agent/settings/settings.tsx` | 子页：模型接入（原聊天页里的 Dialog）                    |
| `src/views/agent/components/`           | 两个子页共用（`titlebar.tsx` 窗口标题栏）                |
| `src/routers/index.tsx`                 | `/agent` 布局路由；`index` 重定向到 `chat`（查询串随带） |

- URL 只有两个：`/agent/chat`（默认）与 `/agent/settings`；磁贴窗口仍开 `/agent`，靠重定向落到默认子页
- 子页之间用 `navigate('/agent/settings')` / `navigate('/agent/chat')` 互跳
- 目录与路由同形：`views/agent/<子页名>/` 就是 URL 段名；**窗口 UI 归 views**（`views/agent/chat/components/**`），
  `features/agent/` 只留 `acp/`、`model/` 与领域类型（对齐 studio 的 `views/agent` + `features/chat`）

## provider-cn

Source: `apps/client/src/components/provider/`

---

category: Components
title: Provider
subtitle: 应用级提供者
description: React Query Provider。
group:
title: 通用
order: 5
---

## 何时使用 {#when-to-use}

- **QueryProvider**：为应用提供 TanStack Query 客户端（内部 `buildQueryClient`）

> 原先的 `PluginProvider`（`plugins/*` 的挂载宿主）已移除：它的 context 没有任何消费者，
> 副作用改由各窗口/视图自己负责（主窗口 `views/overview`、agent 窗口 `views/agent/chat`）。
> 插件契约留在 `src/plugins/types.ts`。

## 代码演示 {#examples}

### QueryProvider

```tsx
import { QueryProvider } from '@/components/provider/query'

export default function App() {
  return (
    <QueryProvider>
      <AppRoutes />
    </QueryProvider>
  )
}
```

## API

### QueryProvider

| 属性     | 说明 | 类型        | 默认值 |
| -------- | ---- | ----------- | ------ |
| children | 子树 | `ReactNode` | —      |

内部使用 `useState(buildQueryClient)` 创建稳定的 `QueryClient`，再包 `QueryClientProvider`。
