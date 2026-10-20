# 工程文档索引

本仓库**只有一个文档根**：`docs/`。所有工程文档、应用专题、运维手册与第三方参考都收在这里，按受众与类型分层。

> 原 `markdown/`（内部工程笔记）与 `apps/*/docs/`（应用文档）已全部并入本目录。新增文档请落到下表的对应层，不要在各 app / package 目录里另起 `docs/`。

## 分层约定

| 层          | 放什么                                                   | 不放什么                     |
| ----------- | -------------------------------------------------------- | ---------------------------- |
| `apps/`     | 单个应用的架构、模块、API、打包、安全、排查              | 跨应用通用内容               |
| `packages/` | 单个包的职责、对外契约、贡献流程                         | 业务应用逻辑                 |
| `guides/`   | 环境搭建、构建、测试、发版等**操作步骤**                 | 架构说明（放 `apps/packages`）|
| `ops/`      | CI/CD、镜像、商店上架与合规                              | 日常开发流程                 |
| `reference/`| 第三方库 API 笔记、长文资料索引                          | 本仓自己的设计             |
| `decisions/`| ADR：已做出的技术决策及其理由（**append-only，不改写**） | 待办的方案讨论               |

**链接约定**：引用代码时优先用「仓库根相对」的行内代码写法，如 `apps/studio/src/main.ts`；确需可点击的 Markdown 链接时，从文档所在层正确回溯（如 `docs/apps/studio/architecture.md` → `../../../apps/studio/src/main.ts`）。不要写 `../src/...` 这类依赖「文档恰好挨着代码」的路径——文档与代码分层后必然失效。

## 应用（apps/）

### Studio（Electron 桌面壳）

| 文档                                          | 说明                                     |
| --------------------------------------------- | ---------------------------------------- |
| [README.md](./apps/studio/README.md)          | 入口与索引                               |
| [architecture.md](./apps/studio/architecture.md) | 进程模型、分层、组合根                |
| [ipc-contract.md](./apps/studio/ipc-contract.md) | IPC 契约规范：平台约束、三处 satisfies 闭环、错误模型 |
| [modules.md](./apps/studio/modules.md)        | 模块划分                                 |
| [api-reference.md](./apps/studio/api-reference.md) | IPC 接口参考                        |
| [development.md](./apps/studio/development.md) | 开发与调试                               |
| [examples.md](./apps/studio/examples.md)      | 典型用法示例                             |
| [security.md](./apps/studio/security.md)      | 安全模型                                 |
| [packaging.md](./apps/studio/packaging.md)    | 打包与分发                               |
| [troubleshooting.md](./apps/studio/troubleshooting.md) | 常见问题                        |

### Client（Tauri 桌面应用）

| 文档                                                                          | 说明                                                    |
| ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| [zustand-dexie-rxjs.md](./apps/client/zustand-dexie-rxjs.md)                  | Zustand + Dexie + RxJS 数据层                           |
| [components-api.md](./apps/client/components-api.md)                          | 业务组件 API                                            |
| [components-semantic.md](./apps/client/components-semantic.md)                | 组件语义化 class                                        |
| [tauri-remote.md](./apps/client/tauri-remote.md)                              | 远程 URL：外跳 opener，不再用 Webview `remote.urls`     |
| [tauri-command-database/](./apps/client/tauri-command-database/README.md)     | Tauri command / database 分层；Schema Reminder 统一改动 |
| [updater-sidecar-file-lock.md](./apps/client/updater-sidecar-file-lock.md)    | Windows 更新时 corex-serve 文件锁：根因与双保险方案     |
| [capture-sharpness-and-selection.md](./apps/client/capture-sharpness-and-selection.md) | 截图清晰度与选区                                    |

### Extension（浏览器扩展）

| 文档                                                                                       | 说明                  |
| ------------------------------------------------------------------------------------------ | --------------------- |
| [ai-streaming-iframe.md](./apps/extension/ai-streaming-iframe.md)                           | AI 流式 + iframe 渲染 |
| [examples/ai-streaming-iframe-demo.md](./apps/extension/examples/ai-streaming-iframe-demo.md) | 父页 API 调用示例   |

## 包（packages/）

各包的职责与对外契约见其 README（如 [`packages/design/README.md`](../packages/design/README.md)）。
跨包的架构说明按需在 `packages/<name>/` 下新建专题文档。

## 指南（guides/）

| 文档                                                       | 说明                              |
| ---------------------------------------------------------- | --------------------------------- |
| [vite.md](./guides/vite.md)                                | Vite 配置约定                     |
| [zustand.md](./guides/zustand.md)                          | Zustand 基础用法                  |
| [agent-conventions.md](./guides/agent-conventions.md)      | Agent 会话高频约定备忘            |

## 运维（ops/）

| 文档                                                                    | 说明                                            |
| ----------------------------------------------------------------------- | ----------------------------------------------- |
| [ci-cd.md](./ops/ci-cd.md)                                              | CI/CD：Secrets 概念、两类签名、工作流与发版操作 |
| [testing.md](./ops/testing.md)                                          | Vitest / Jest 约定与示例入口                    |
| [pnpm-and-native-mirrors.md](./ops/pnpm-and-native-mirrors.md)          | pnpm 配置与 Electron 镜像                       |

### Microsoft Store（ops/store/）

| 文档                                                                       | 说明                                              |
| -------------------------------------------------------------------------- | ------------------------------------------------- |
| [store-submission-guide.zh-CN.md](./ops/store/store-submission-guide.zh-CN.md) | 上架填写总手册（属性 / 包 / 一览 / 版权与许可等） |
| [store-package-handoff.md](./ops/store/store-package-handoff.md)           | 包 URL、R2 / Worker 托管与包页字段                |
| [privacy-policy.zh-CN.md](./ops/store/privacy-policy.zh-CN.md)             | 隐私声明（属性页）                                |
| [license-terms.zh-CN.md](./ops/store/license-terms.zh-CN.md)               | 许可条款（一览页）                                |
| [认证说明.md](./ops/store/认证说明.md)                                     | 认证测试人员说明                                  |

## 第三方参考（reference/）

| 文档                                             | 说明                                                |
| ------------------------------------------------ | --------------------------------------------------- |
| [icons.md](./reference/icons.md)                 | Iconify React/Vue 与 unplugin-icons；本仓库离线约定 |
| [dnd-kit-grid.md](./reference/dnd-kit-grid.md)   | @dnd-kit 网格拖拽笔记（client / studio）            |
| [sortablejs.md](./reference/sortablejs.md)       | Sortable.js API 笔记（client / extension）          |
| [konva.md](./reference/konva.md)                 | Konva 长文笔记（截图标注）                          |

## 决策记录（decisions/）

| 文档                                                                | 说明                                          |
| ------------------------------------------------------------------- | --------------------------------------------- |
| [prisma-to-drizzle.md](./decisions/prisma-to-drizzle.md)            | Studio 本地库从 Prisma 迁到 Drizzle 的选型依据 |
| [renderer-vite-root-cause.md](./decisions/renderer-vite-root-cause.md) | Studio renderer 构建根因分析               |
| [durable-execution-engine.md](./decisions/durable-execution-engine.md)  | cogito 可靠执行引擎：duroxide 而非 pg_durable   |
| [approval-channel.md](./decisions/approval-channel.md)                  | cogito agent 写操作的人工审批通道：闸门在编排、决定走邮箱 |
| [no-langchain.md](./decisions/no-langchain.md)                          | ai-worker agent 运行时：自持薄层，不引入 LangChain / LangGraph |

## 调试入口

不另维护长篇 DEBUG 指南。日常调试请使用：

- 仓库 `.vscode/` 启动与任务配置
- 各应用 README：`apps/client`、`apps/studio`、`apps/extension` 等
