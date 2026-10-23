# @cogito/chat

共享 chat 层：**领域类型 + 端口接口 + assistant-ui 适配器**。被 `apps/studio`（Electron）与 `apps/extension`（MV3）共用。

## 结构

```text
packages/chat/
└── src/
    ├── ports.ts                  # 领域类型 + 三个端口（历史 / 模型 / 目标）
    └── adapters/
        ├── thread-history.ts     # ChatHistoryPort → assistant-ui ThreadHistoryAdapter（含 withFormat）
        ├── thread-list.ts        # ChatHistoryPort → assistant-ui RemoteThreadListAdapter
        └── chat-model.ts         # ChatModelPort → assistant-ui ChatModelAdapter（增量聚合为快照）
```

## 约束

- **环境无关**：不得依赖 Node、Electron、`chrome.*`。存储/传输差异一律通过 `ports.ts` 的端口由各 app 注入。
- **包内一律相对路径导入**（同 `packages/design`，且 tsconfig 不声明 `paths`）：app 的 `resolve.tsconfigPaths` 会用 app 自己的 tsconfig 解析所有 importer 的 `@/*`。
- **消息存储契约不可改名**：行形状为 `{ id, parent_id, format, content }`（`content` 是 `format` 对应适配器 encode 出的不透明字符串）。
  studio 侧对应 `drizzle/schema/chat.ts` 的 `chatMessage`。
- 本包只放"与后端无关"的胶水；具体存储实现对某个 app 才成立的东西（表结构、Key、传输）留在 app 内。

## 端口（`ports.ts`）

| 端口              | 谁实现           | studio 实现                        | extension 实现 |
| ----------------- | ---------------- | ---------------------------------- | -------------- |
| `ChatHistoryPort` | 会话与消息读写   | 主进程 IPC（Drizzle）              | 暂未接入       |
| `ChatModelPort`   | 一次生成的事件流 | 主进程 MessagePort（agent 运行时） | 暂未接入       |

`ChatStreamEvent` 是两个环境共用的流事件形状（`text` / `reasoning` / `tool-call` / `tool-result` /
`tool-approval-request` / `tool-approval-failed` / `finish` / `aborted` / `error`）。

## 适配器要点

- `createThreadHistoryAdapter(port, identity)`：
  - 内置格式 `ith/thread-message-like`（`content` 为其 JSON 载荷），studio 的 `useLocalRuntime` 用它；
  - `withFormat(adapter)` 给别的 runtime（AI SDK 格式）复用同一存储，**不要**把两种格式写进同一条会话；
  - `identity` **每次调用都重新取**当前线程：runtime 会在切线程后再读，不要在构造时捕获 id。
    它有两个方法，混用会丢消息：
    - `read(): string | null` —— 只读快照，`load()` 用它。读历史**不建会话**，没有会话就是空历史；
    - `ensure(): Promise<string>` —— 写路径用它。会话 id 要落库后才存在（新建线程在
      `initialize()` 之前只有 `__LOCALID_x`），且 promotion / reconcile 期间快照可能是旧值；
      拿空值去写会撞 `chatMessage.sessionID` 外键，而 assistant-ui 会**静默吞掉**写入 rejection。
- `createThreadListAdapter(port)`：`list/rename/initialize/delete/fetch` 已实现；`generateTitle` 用本地启发式（首条用户文本）并落库；**归档暂不支持**（`archive`/`unarchive` 抛可展示错误）。
  - `updateCustom` 只认 `custom.workspaceID`（归属落库），键缺席时什么都不做 —— 列表项的
    `custom` 是 app 侧分组（如 studio 左栏按工作区归拢会话）唯一的数据源，而 `initialize()`
    的返回契约只有 `remoteId`/`externalId`，所以**新建会话后要由 app 调一次 `updateCustom`
    把归属补上**，否则它只能等 `list()` 重载才归位。
- `createChatModelAdapter(port, { findHost })`：把 `ChatStreamEvent` 增量聚合成 assistant-ui 需要的快照；文本、推理与工具调用（含审批回执 `requires-action`）都已实现。
  - **part 的次序 = 事件到达的次序**（界面按 part 顺序渲染）：一轮里的「思考 → 工具 → 正文」
    必须保留先后，按类型归堆会让工具调用跑到回答下方，看上去像"先给了结论才去读文件"。`findHost` 可以是异步的 —— 会话 id 同样要 `ensure()` 后才权威。
