---
name: coding-conventions
description: >-
  Enforces team coding standards for naming, API functions, TypeScript types,
  file layout, error handling, async, and UI tokens. Use when writing or reviewing
  new code, creating API modules, defining types, naming variables/functions, or
  when the user mentions 开发规范, 编码规范, naming conventions, POST_SIGNIN,
  GET_INFO, or code style in this project.
---

# 编码规范

编写或审查**新代码**时严格遵循。存量不合规命名可在触及该文件时渐进替换，不要求一次性全仓改完。命名尽量简洁优雅。

正误对照与完整片段见 [examples.md](examples.md)。

## 快速检查

- [ ] 命名不含 `chrome`（外壳用 `shell` / 区域用 `surface`）
- [ ] API 与常量：全大写下划线（`POST_SIGNIN`、`GET_INFO`、`API_BASE_URL`）
- [ ] 禁止 `get` 前缀；查询用 `find` / `fetch`，解析用 `parse` / `parsed`
- [ ] 禁 `load` / `apply` / 泛化 `create`；常量不加 `DEFAULT` 前缀
- [ ] 布尔用 `is` / `has` / `can`；非 `useState` 不用 `set`；避免 `list` 后缀
- [ ] UI 区域用 `surface`，不用 `panel`
- [ ] 非必要不用箭头函数；导出用 `function`；对象方法用简写；模块末尾 `export { ... }`
- [ ] 同目录 `./x`；跨目录 `@/...`，不写 `../../`
- [ ] `catch` 必 throw 或输出一次；独立并行用 `Promise.allSettled`
- [ ] 对象形状用 `interface`；联合/交叉/工具类型映射用 `type`
- [ ] 组件走 `@cogito/design` + registry；语义 token；按压用色阶
- [ ] 嵌套滚动笼需要时用 `overscroll-contain` / `overscroll-y-contain`
- [ ] 不用 `scrollbar-width: thin` / `scrollbar-thin`

## 命名

### 禁止 `chrome`

与浏览器 Chrome 重名。UI 外壳 / 窗框用 `shell`；侧栏 / 区城容器用 `surface`。

- ❌ `KnowledgeChrome`、`showsChrome`、`op-chrome`
- ✅ `KnowledgeSurface`、`showsShell`、`op-shell`

产品名「导入 Chrome 书签」等指浏览器品牌的文案除外。

### 禁止 `get` 前缀

用 `find`、`fetch` 等替代查询；解析用 `parse`，解析结果用 `parsed`（不要用 `resolve` 表示解析）。

- ❌ `getUserInfo` → ✅ `findUserInfo`
- ❌ `resolveDate` → ✅ `parseDate`

### 禁 `load` / `apply` / 泛化 `create`

- 初始化用 `bootstrap`，不用 `load`
- 不用 `apply` 作动词命名
- 创建类语义用更具体动词（`insert`、`increment`），避免泛化 `create`

### 常量与配置

常量、枚举键、全局配置：**全大写** + 下划线。不加 `DEFAULT` / `default` 前缀（全大写已表示常量）。

- ✅ `API_BASE_URL`、`MAX_RETRY_COUNT`、`PAGE_SIZE`
- ❌ `DEFAULT_PAGE_SIZE`

### 命名原则

- 非 `useState` 禁止 `set`
- 布尔用 `is` / `has` / `can`
- 集合用复数、不含 `list`（`users` 非 `userList`）
- 简洁；有命名空间时可精简重复前缀；>20 字符应拆分
- 同概念用词一致；不同概念不复用同名
- 接口 / 类型：PascalCase（`ChannelSpec`）

## 文件组织

- 粒度适中：不过度拆分 / 聚合
- 按模块划分；**导出名 = 文件名 = 职责**；模块末尾 `export { ... }`
- 一个域多个文件 → 开目录（目录名即域）；单文件域平铺
- 默认不建 barrel；仅对外需统一入口时才放 `index.ts`

### 导入路径

- 同目录 `./x`
- 跨目录一律别名（如 `@/...`），不写 `../../`
- 层 / 进程边界靠 lint 兜底

## 改动审查

- 优先合并进现有逻辑，别叠补丁；能删旧路径就删，避免双轨
- 只改任务所需，不做无关重构
- 整段行为按场景替换 → 策略模式；按输入取值 → 对象映射表

## 错误捕获

`catch` / `.catch()` 必须**二选一**：throw，或至少输出一次（`console.*` / toast / 事件总线）。**只写注释不算数**。

- 降级到默认值 / 空列表前也要先留痕
- 能不 catch 就别 catch：优先不抛异常的 API，或状态判断
- 多失败用 `AggregateError` 汇总
- 日志前缀 `[模块] 说明:`
- 良性清理 / 探针：`console.debug`；真异常：`console.warn`
- 测试刻意断言异常可 `eslint-disable-next-line` 并写理由

## 异步

- 非必要不用 `Promise.all`
- 任务互相独立 → `Promise.allSettled`，逐条处理并各自报错
- 仅真 fail-fast 用 `Promise.all`
- 每项已自带 try/catch 的 `Promise.all` → 改 `allSettled`，错误收到一处

## UI / 滚动

- 嵌套滚动笼（过程摘要、终端、下拉列表等）：用 `overscroll-contain` / `overscroll-y-contain`，触底不链式拖走父级
- 整页 / Thread 主滚动：保持默认 overscroll，或按需 `overscroll-auto` / `overscroll-none`
- **禁止** `scrollbar-width: thin`、`scrollbar-thin`、`[scrollbar-width:thin]`（会盖掉全局 6px）
- 滚动条：默认交给 app 全局 webkit 6px；隐藏用 `scrollbar-width: none` + `::-webkit-scrollbar { display:none }`
- ESLint：`ith/no-scrollbar-width-thin`（client / studio）；design 走 `no-restricted-syntax`

## 简化写法

- 可选链 / 空值合并优先
- 假值判断直接写 `x` / `!x`；不写 `!= null`；布尔上下文不要 `Boolean(x)`
- `0` / `''` / `false` 是合法值的位置不许换成假值判断

## 函数与写法

### 优先普通函数

非必要禁止箭头函数。对外导出用 `function` 声明。

箭头函数仅用于：简短回调、必须保持外层 `this`、compose / pipe 等约定工具。

### 对象方法用简写

```ts
// ✅
bindSortableGrid(gridEl, {
  onDragStart() {
    scrollFx.pause()
  }
})

// ❌
bindSortableGrid(gridEl, {
  onDragStart: function () {
    scrollFx.pause()
  }
})
```

### 未使用参数

加 `_` 前缀（如 `_data`）。

## 类型与质量

- 类型命名：大驼峰
- **对象形状优先 `interface`**；联合、交叉不便 `extends`、映射/条件类型用 `type`
- 非专用类型文件：类型放在 import 下方
- 避免 `any`；公开 API 需有类型
- 遵循 ESLint / 格式化；复杂逻辑补充必要注释

## UI

- 组件一律 `@cogito/design`；不手写 `<button>` / `<dialog>`；不在业务侧造一次性组件
- 新组件走 `pnpm --filter @cogito/design registry:add`
- 设计 token 唯一源（`packages/design` globals）；业务侧不得另定义同名变量
- 语义 token 工具类（`bg-primary`、`text-muted-foreground`）；禁硬编码色 / 任意值色
- 按压反馈用色阶（`hover:` / `active:` 背景），禁 `active:translate-y-px` / `active:scale-*`
- 结构简洁；每层容器有明确作用；图标作层次点缀，不抢主内容

## 架构

- 跨进程 / 跨层契约是单一事实源：改一处同批改**全部消费点**

## 边界

| 场景 | 使用 |
|------|------|
| 前端 HTTP / TS 命名与写法 | 本 Skill（`coding-conventions`） |
| Tauri IPC / Command / Service | `naming-conventions`（client `src-tauri`） |

## 存量代码

新代码严格执行。存量不合规（含 `*Chrome`、`getXxx`）在触及该文件时渐进替换。
