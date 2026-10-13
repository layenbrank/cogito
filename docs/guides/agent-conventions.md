# Agent 提示备忘

高频、易忘的约束。

## 协作

- 动手前先说明改动方案，等我确认再改。

## 文件组织

- 粒度适中：不过度拆分 / 聚合。
- 按模块划分；导出名 = 文件名 = 职责；模块末尾 `export { ... }`。
- 一个域多个文件 → 开目录（目录名即域）；单文件域平铺。
- 默认不建 barrel；仅对外需统一入口时才放 `index.ts`。

### 导入路径

- 同目录 `./x`；跨目录一律用别名（如 `@/...`），不写 `../../`。
- 层 / 进程之间的边界（谁能引用谁）靠 lint 兜底，不靠口头约定。

## 改动审查

- 优先合并进现有逻辑，别叠补丁；能删旧路径就删，避免双轨并存。
- 只改任务所需代码，不做无关重构。
- 保证可维护、易扩展：结构清晰、职责单一。
- 整段行为按场景替换 → 策略模式；按输入取值 → 对象映射表驱动。

## 代码质量

### 错误捕获：一律不许静默吃掉

`catch` / `.catch()` 必须**二选一**：throw 出去，或至少输出一次（`console.*` / toast）。**只写注释不算数**。

- 兜底降级（降级到默认值 / 空列表 / 空结果）也要先留痕、再降级。
- 能**不 catch 就别 catch**：优先换成不抛异常的 API（`execSync` → `spawnSync`），或改成状态判断，而不是包一层 try 再吞掉。
- 多个失败一起产生时用 `AggregateError` 汇总抛出，别只留第一条。
- 日志前缀 `[模块] 说明:`。
- 机器把关：用 lint 规则把「静默 catch」判成 error。经事件总线上报也算输出一次。
  - 良性清理 / 探针类失败用 `console.debug`（记下来但不喧哗），真异常用 `console.warn`；测试里刻意取异常断言可加一行带理由的 `eslint-disable-next-line`。

### 异步：非必要不用 `Promise.all`

- 并行任务之间**互相独立**（一个失败不该拖垮其余的）→ 用 `Promise.allSettled`，逐条处理 `fulfilled` / `rejected` 并各自报错。
- 只有**真 fail-fast** 才用 `Promise.all`：任一项失败后续就完全做不下去（例如两项都是必需的）。
- 「每项内部已自带 try/catch」的 `Promise.all` 属冗余：改 `allSettled`，把 per-item 的 try/catch 收到一处。

### 简化写法

- 可选链 / 空值合并优先：「取出来 + 判空 + 调用」应合并：
  `this.listeners.get(type)?.forEach(...)` 优于 `const bucket = …; if (!bucket) return; for (…)`。
- 冗长判空 `x !== null && x !== undefined` → 直接写假值判断 `x`（取反 `!x`）。也别写 `!= null`（`eqeqeq` 会拦）。
- 布尔上下文（`if` / 三元 test / `!` / `&&`）里**不要**写 `Boolean(x)`：`no-extra-boolean-cast`（在 `eslint:recommended` 内）会判 `Redundant Boolean call`，lint 直接红 —— 直接写 `x` 即可。
- 只有**非**布尔上下文（JSX 属性、普通返回值）需要真布尔时才 `Boolean(x)` / `!!x`。
- 分清「有没有值」和「值真不真」：`0` / `''` / `false` 是合法值的位置（定时器 id、`rafId.current`、数值 0、空字符串内容）**不许**换成假值判断，否则真出 bug。

## 架构

- 跨进程 / 跨层的契约是单一事实源：改一处要同批改**全部消费点**，缺一处编译不过，勿绕过。

## 命名

- 简洁，>20 字符应拆分；有命名空间时可精简，不必重复前缀；看不清时加注释。
- 常量 / 枚举键 / API：全大写蛇形（`POST_SIGNIN`）；接口 / 类型：PascalCase（`ChannelSpec`）。
- 同概念用词一致，不同概念不复用同名。
- 禁 `get` 前缀 → 用 `find` / `fetch`；解析用 `parse`。
- 布尔 `is` / `has` / `can`；非 `useState` 不用 `set`；集合用复数、不含 `list`。

## 结构与样式

- 结构简洁，无无用嵌套；每层容器有明确作用。
- 图标 / 图片做层次点缀，不堆砌、不抢主内容。

## UI 组件库

- 组件一律用项目统一的组件库；不手写 `<button>` / `<dialog>`，不在业务侧造一次性组件。
- 按压反馈用色阶，不用位移 / 缩放（`hover:bg-primary-hover` / `active:bg-primary-active`；禁 `active:translate-y-px` / `active:scale-*`）。
- 设计 token 唯一源（全局样式文件）；业务侧不得另定义同名变量。
- 用语义 token 工具类（`bg-primary`、`text-muted-foreground`）；不写硬编码色值 / 任意值。
- 新组件走项目的组件注册表（registry）流程引入。

## Git 提交

1. 先看 `status` / `diff` / `log`，再生成提交信息。
2. 按主题分批；一条提交一个意图。
3. 信息简洁、说明「为什么」；对齐近期风格（`fix(...)` / `chore()`）。
4. 未经要求：不 `push`、不改 config、不跳 hooks。
5. 按文件逐个 `git add`，不 `git add .`；commit 前 `git diff --cached --name-only` 复核。

> 本项目特有的约定（Tauri 窗口、已废弃变量、发版、corex 工具）见 [agent-conventions.project.md](./agent-conventions.project.md)。
