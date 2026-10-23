# 图标体系：Iconify React / Vue 与 unplugin-icons

## 1. 总览

本仓库会出现（或曾经出现）两套图标方案，职责不同，不要混用。

| 方案 | 包 / 插件 | 时机 | 典型写法 |
|------|-----------|------|----------|
| **Iconify 组件** | `@iconify/react` / `@iconify/vue` | **运行时** | `<Icon icon="mdi:home" />` |
| **unplugin-icons** | `unplugin-icons` + Vite `Icons()` | **构建期** | `import Home from '~icons/mdi/home'` |

**本仓库约定（目标态）：只使用 Iconify 字符串组件 + `addCollection` 离线注册；弃用 unplugin-icons 与本地 SVG 目录。**

---

## 2. Iconify React / Vue

### 2.1 是什么

Iconify 提供跨图标集的统一 API。组件根据字符串 id（`前缀:名称`）渲染 SVG。

- React：`@iconify/react`
- Vue：`@iconify/vue`

### 2.2 基本用法

```tsx
// React
import { Icon } from '@iconify/react'

<Icon icon="mdi:home" width={20} height={20} />
<Icon icon={status === 'ok' ? 'mdi:check' : 'mdi:alert'} />
```

```vue
<!-- Vue -->
<script setup>
import { Icon } from '@iconify/vue'
</script>

<template>
  <Icon icon="ant-design:setting-outlined" />
  <Icon :icon="item.icon" />
</template>
```

**优点：** id 可以是变量、配置、菜单数据，适合工具栏、magnetic-tile、settings 等场景。

### 2.3 数据从哪来

组件查图标时顺序大致是：

1. **已通过 `addCollection` / `addIcon` 注册的本地数据**
2. 若未关闭远程 API：**向 Iconify CDN 请求**（需网络；桌面端不稳定）

Tauri client / 桌面端应走离线注册（使用 **offline** 入口，无 CDN）：

```ts
import { addCollection } from '@iconify/react/offline'
import mdi from '@iconify/json/json/mdi.json'
import antDesign from '@iconify/json/json/ant-design.json'
import custom from '@cogito/shared/iconify.json' // → icons/custom.json

addCollection(mdi)
addCollection(antDesign)
addCollection(custom)
```

组件侧同样从 offline 导入：

```ts
import { Icon } from '@iconify/react/offline'
// Vue: import { Icon } from '@iconify/vue/offline'
```

说明：

- `@iconify/json`：全集仓；**只 import 用到的** `json/<prefix>.json`。Vite 只会打进这些文件（例如 mdi 约 3.5MB、ant-design 约 0.7MB），不会把整仓数百套都打进包。
- `@iconify-json/<prefix>`：单套细包（如 `simple-icons`）；与全集仓里同名 JSON 内容等价，按需安装即可。
- **custom.json**：项目私有图标（窗口按钮、原 SVG 迁入的 path 等），prefix 一般为 `custom`。

### 2.4 包名别混淆

| 路径 | 含义 |
|------|------|
| `node_modules/@iconify/json/json/mdi.json` | 全集仓中的 mdi |
| `node_modules/@iconify-json/mdi/` | 细包（需单独 `pnpm add @iconify-json/mdi`） |
| `node_modules/@iconify-json/simple-icons/` | 仅表示**装了** simple-icons，不代表只有这一套图标 |

`@iconify-json/` 目录下有几个子目录，取决于你装了几个细包；与 `@iconify/json` 是否包含该集合无关。

### 2.5 与本仓库的对应关系

| 应用 | 库 | 注册位置（目标） |
|------|-----|------------------|
| `apps/client` | `@iconify/react` | `main.tsx` → `addCollection` |
| `apps/extension` | `@iconify/vue` | 入口同样 `addCollection` |

使用处示例：

- `<Icon icon="mdi:briefcase-clock-outline" />`
- `icon="ant-design:setting-outlined"`
- `icon="custom:close-fill"`

---

## 3. unplugin-icons

### 3.1 是什么

Vite / Webpack 插件：在**构建时**把 `~icons/<集合>/<名称>` 编译成 React / Vue 组件（内联 SVG），按 **import 树摇**。

```ts
// vite.config.ts
import Icons from 'unplugin-icons/vite'

Icons({
  compiler: 'jsx', // 或 'vue3'
  autoInstall: true,
  customCollections: {
    local: FileSystemIconLoader('path/to/svgs')
  }
})
```

```tsx
import Home from '~icons/mdi/home'
import Close from '~icons/local/close'

;<Home />
;<Close />
```

### 3.2 `autoInstall: true` 是什么意思

仅当使用 `~icons/<set>/...` 时生效：

- 若本地没有 `@iconify-json/<set>`，构建过程中尝试 **自动 `pnpm add` / `npm install` 该细包**
- 装的是 **npm 包**，不是运行时从 CDN 拉单个 SVG
- 与 `<Icon icon="mdi:home" />` **无关**——字符串 Icon 不会触发 autoInstall

CI / 只读环境里自动改 lockfile 可能不合适；生产项目更常见显式声明依赖。

### 3.3 本地 SVG（`FileSystemIconLoader`）

把某目录下的 `.svg` 映射成 `~icons/local/<文件名>`。本仓库 extension 曾用：

`packages/shared/src/assets/icons/*.svg` → `~icons/local/close` 等。

### 3.4 优缺点（相对 Iconify 组件）

| | unplugin-icons | Iconify `<Icon icon>` |
|--|----------------|------------------------|
| 灵活性 | 差：必须静态具名 import | 好：字符串 / 变量 |
| 体积 | 只打包用到的图标 | 整集 JSON（Tauri 桌面端通常可接受） |
| 配置驱动 UI | 不方便 | 方便 |
| 依赖 | 构建插件 + 细包 / SVG | 运行时库 + JSON |

**结论：** 若业务需要动态 `icon` 字段，选 Iconify 组件。unplugin-icons 更适合「图标写死、强树摇」的 Web 场景。本仓库 **不再需要** unplugin-icons。

---

## 4. 本仓库目标架构

```text
@iconify/json/json/mdi.json ────────────┐
@iconify/json/json/ant-design.json ─────┼── addCollection ──► <Icon icon="prefix:name" />
packages/shared/.../icons/custom.json ──┘
```

目标态（已落地）：

- **已删除** `icons/*.svg`
- **已删除** 手维护子集 `icons/mdi.json`、`icons/ant-design.json`（改由 `@iconify/json` 提供）
- **仅保留** `icons/custom.json`（exports：`@cogito/shared/iconify.json`）
- client / extension / ui：**已移除** Vite `Icons()` / `~icons` / `FileSystemIconLoader`
- 组件与注册均使用 **offline** 入口，无 CDN

### 不在本体系内

- TipTap 编辑器内的 `tiptap-icons/*` 手写 SVG 组件：独立，不纳入本约定。
- `@ant-design/icons`：**已随 antd 全量移除**；原 `DownOutlined` 之类改用 `Icon` + `@iconify/json` 的 ant-design 图标集（`icon="ant-design:down-outlined"`）。

---

## 5. 快速对照：怎么选

```text
需要 icon 来自配置 / 变量 / 列表？
  └─ 是 → @iconify/react 或 @iconify/vue + addCollection
需要极限树摇、每个图标单独 import？
  └─ 是 → unplugin-icons（本仓库不采用）
只要项目私有图形？
  └─ 写入 custom.json，用 custom:xxx
要官方图标集（mdi / ant-design）？
  └─ 从 @iconify/json/json/<prefix>.json addCollection
     （或装 @iconify-json/<prefix>，本仓库 client 选用 @iconify/json）
```

---

## 6. 常用 id 格式

```text
mdi:home
ant-design:setting-outlined
custom:close-fill
```

格式：`{prefix}:{name}`，可在 Iconify 图标集浏览器中检索：

https://icon-sets.iconify.design/
