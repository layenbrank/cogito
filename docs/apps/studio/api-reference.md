# Studio API 参考

> 架构与不变式见 [ipc-contract.md](./ipc-contract.md)；本文只列**具体接口**。

源码真相：

- [`src/shared/ipc/channels.ts`](../../../apps/studio/src/shared/ipc/channels.ts) — 48 个频道常量
- [`src/shared/ipc/specs/`](../../../apps/studio/src/shared/ipc/specs/) — 每域的 zod schema（**类型由 `z.infer` 推导，不另手写**）
- [`src/shared/ipc/api.ts`](../../../apps/studio/src/shared/ipc/api.ts) — `Api`，渲染进程可见的唯一宿主面
- [`src/host/ipc/handlers/`](../../../apps/studio/src/host/ipc/handlers/) — 主进程 handler 实现
- [`src/shared/ipc/error.ts`](../../../apps/studio/src/shared/ipc/error.ts) — 错误码词汇表与跨桥 codec
- [`src/preload.ts`](../../../apps/studio/src/preload.ts) — 暴露与解信封

获取实例：

```ts
// 推荐：全局挂载（preload exposeInMainWorld('itc')）
itc.store.toRead({ key: 'locale' })

// 网页预览（dev:core）没有预load，需自行容错
const hasItc = typeof itc !== 'undefined'
```

## 约定

### 信封（Main → Preload）

```ts
type IpcEnvelope<T> =
  | { ok: true; data: T }
  | {
      ok: false
      error: {
        code: IpcErrorCode
        name: string
        message: string
        details?: unknown
        stack?: string
      }
    }
```

Preload 的 `invoke` 失败时抛 `IpcClientError`，**code 已编进 message 前缀**（`[CODE] 文本`）——
`contextBridge` 会丢弃自定义属性，渲染侧只能用 `src/utils/ipc.errors.ts` 的
`toIpcFailure` / `toIpcMessage` 还原。

### Channel 命名

`namespace:action`；CRUD 等与方法同名的 action 用 camelCase（如 `store:toRead`）。
带子实体的域用点分两级（如 `chat:provider.toRead`）。

---

## store

| 方法       | Channel          | 入参              | 返回                |
| ---------- | ---------------- | ----------------- | ------------------- |
| `toRead`   | `store:toRead`   | `{ key: string }` | `Promise<unknown>`  |
| `toWrite`  | `store:toWrite`  | `{ key, value }`  | `Promise<void>`     |
| `has`      | `store:has`      | `{ key }`         | `Promise<boolean>`  |
| `toRemove` | `store:toRemove` | `{ key }`         | `Promise<void>`     |
| `clear`    | `store:clear`    | 无                | `Promise<void>`     |
| `keys`     | `store:keys`     | 无                | `Promise<string[]>` |

---

## dialog

| 方法   | Channel       | 入参                              | 返回                        |
| ------ | ------------- | --------------------------------- | --------------------------- |
| `open` | `dialog:open` | 可选 `{ multiple?, filters? }`    | `Promise<string[] \| null>` |
| `save` | `dialog:save` | 可选 `{ defaultPath?, filters? }` | `Promise<string \| null>`   |

---

## user

| 方法       | Channel         | 入参      | 返回               |
| ---------- | --------------- | --------- | ------------------ |
| `toRead`   | `user:toRead`   | 无        | `Promise<ReadR[]>` |
| `toWrite`  | `user:toWrite`  | `WriteP`  | `Promise<ReadR>`   |
| `toUpdate` | `user:toUpdate` | `UpdateP` | `Promise<ReadR>`   |
| `toRemove` | `user:toRemove` | `RemoveP` | `Promise<void>`    |

`ReadR`：`{ id: string; createdAt; updatedAt; name; email }`（ISO 时间字符串）。
`toUpdate` / `toRemove` 对不存在的 id 抛 `USER_RECORD_NOT_FOUND`。

---

## sidecar

| 方法               | Channel                    | 入参                                      | 返回                               |
| ------------------ | -------------------------- | ----------------------------------------- | ---------------------------------- |
| `toRead`           | `sidecar:toRead`           | 无                                        | `Promise<FindStatusR>`             |
| `actions`          | `sidecar:actions`          | 无                                        | `Promise<ActionEntry[]>`           |
| `directives`       | `sidecar:directives`       | 无                                        | `Promise<DirectiveEntry[]>`        |
| `directive`        | `sidecar:directive`        | `{ name }`                                | `Promise<DirectiveDocument>`       |
| `saveDirective`    | `sidecar:saveDirective`    | `{ definition, original_name? }`          | `Promise<DirectiveDocument>`       |
| `deleteDirective`  | `sidecar:deleteDirective`  | `{ name }`                                | `Promise<{ name }>`                |
| `importDirectives` | `sidecar:importDirectives` | `{ path, folder?, overwrite?, dry_run? }` | `Promise<ImportResult>`            |
| `editDirective`    | `sidecar:editDirective`    | `{ name }`                                | `Promise<void>`（拉 `corex edit`） |
| `invoke`           | `sidecar:invoke`           | `{ action, params?, runId }`              | `Promise<unknown>`                 |
| `run`              | `sidecar:run`              | `{ name, input?, runId }`                 | `Promise<unknown>`                 |
| `onProgress`       | `sidecar:progress`（推送） | –                                         | 订阅，帧带 `runId`                 |

`FindStatusR`：`{ isReady, version, actions, hasCorex, dataDir, database, isBundled }`。

> pandoc 是否可用不在这一条里：它已归 `tool` 域（见下节）。

`DirectiveEntry`：`{ name, folder, source, updated_at_ms, bucket, summary, last_run? }`；
`DirectiveDocument`：`{ name, folder, source, created_at_ms, updated_at_ms, yaml, definition }`。
`definition.name` 是名字，`original_name` 与它不同即改名（daemon 原子完成）。

---

## tool

在线工具（pandoc / ffmpeg / opencode）的状态与安装。落点 `<userData>/sidecar/<tool>/<版本>/`；
完整版内置的那份作兜底，取用顺序是**已下载 → 随包内置**。

| 方法         | Channel                 | 入参      | 返回                                              |
| ------------ | ----------------------- | --------- | ------------------------------------------------- |
| `toRead`     | `tool:toRead`           | 无        | `Promise<ToolStatus[]>`                           |
| `install`    | `tool:install`          | `{ key }` | `Promise<void>`                                   |
| `toRemove`   | `tool:toRemove`         | `{ key }` | `Promise<void>`                                   |
| `onProgress` | `tool:progress`（推送） | –         | 订阅，帧带 `key` / `phase` / `received` / `total` |

`ToolStatus`：`{ key, label, summary, version, state, bytes, path }`；
`state`：`installed`（已下载）| `bundled`（随包内置）| `missing`（未装）| `unsupported`（当前平台无钉死版本）。

下载地址与哈希都写在 `apps/studio/sidecar/manifest.json`（宿主构建期内联，`tools/catalog.ts` 只做取值）：
每个工具的在线包按平台记在 `platforms` 下，形状（`schemaVersion` / `platforms` / 直链 + `sha256`）由契约包
[`@cogito/sidecar`](../../../packages/sidecar/README.md) 定义 —— CLI、宿主、forge 读的是同一份。
在线源是自建的 Cloudflare R2，**一个工具一个 bucket**，所以按「工具 × 平台」记整条直链，不拼公共前缀。
归档是**重打包**的（可执行文件平铺在包根），因此哈希与 `tools.lock.json` 里那份 release 归档不同 ——
那份是完整版落盘用的。下载后按 manifest 里的 sha256 校验。

---

## doc

| 方法      | Channel       | 入参       | 返回                |
| --------- | ------------- | ---------- | ------------------- |
| `convert` | `doc:convert` | `ConvertP` | `Promise<ConvertR>` |

`format`：`markdown` \| `html` \| `docx` \| `pdf` \| `plain`。pandoc 未安装时回 `DOC_PANDOC_MISSING`。

---

## screenshot

| 方法      | Channel              | 入参 | 返回                               |
| --------- | -------------------- | ---- | ---------------------------------- |
| `capture` | `screenshot:capture` | 无   | `Promise<{ path, width, height }>` |

路径由 Main 写入 `userData/screenshots`。Corex 返回 path string 或 `{ path }`。

---

## updater

| 方法          | Channel            | 入参 | 返回                   |
| ------------- | ------------------ | ---- | ---------------------- |
| `toRead`      | `updater:toRead`   | 无   | `Promise<FindStatusR>` |
| `check`       | `updater:check`    | 无   | `Promise<CheckR>`      |
| `download`    | `updater:download` | 无   | `Promise<void>`        |
| `install`     | `updater:install`  | 无   | `Promise<void>`        |
| `onEvent(cb)` | `updater:event`    | —    | 取消订阅函数           |

**`updater:event` 是推送通道，不是 invoke** —— 渲染侧以 `subscribe` 形态暴露。

---

## devtools

| 方法       | Channel             | 入参                   | 返回            |
| ---------- | ------------------- | ---------------------- | --------------- |
| `toUpdate` | `devtools:toUpdate` | `{ visible: boolean }` | `Promise<void>` |

仅开发态；生产调用抛 `DEVTOOLS_DISABLED`。

DevTools 开到**调用窗口自己**（handler 用 `event.sender` 定位）—— 多窗口下各开各的，
不再固定指向主窗口。

---

## overlay

| 方法       | Channel            | 入参                   | 返回                   |
| ---------- | ------------------ | ---------------------- | ---------------------- |
| `toRead`   | `overlay:toRead`   | 无                     | `Promise<{ visible }>` |
| `toUpdate` | `overlay:toUpdate` | `{ visible: boolean }` | `Promise<void>`        |

浮层窗口由 window 插件创建/销毁，两个频道经 `OverlayWindowPort` 读写它
（窗口不可用时抛 `OVERLAY_UNAVAILABLE`）。

---

## window

窗口域只负责「把窗口开出来」；当前只有 Agent 子窗口一种。

| 方法           | Channel               | 入参 | 返回            |
| -------------- | --------------------- | ---- | --------------- |
| `agent.toOpen` | `window:agent.toOpen` | 无   | `Promise<void>` |

Agent 子窗口**按需创建**（首次调用时建，已开则聚焦/从最小化恢复），窗口生命周期收在
`AgentWindowPort`（`host/capabilities/window/registry.ts`）；它是主窗口的子窗口（`parent`），
随主窗口关闭。主窗口 overview 用本频道打开 Agent 窗口，**不再在主窗口内跳转路由**。

---

## workspace

Agent 的**沙箱边界**：工作区（可挂多个源文件夹，其一为 primary）由主进程落库；
渲染进程只能按 `workspaceID` + **相对路径**访问 —— 绝对路径与越界路径在主进程被拒。

| 方法               | Channel                      | 入参                                | 返回                             |
| ------------------ | ---------------------------- | ----------------------------------- | -------------------------------- |
| `toRead`           | `workspace:toRead`           | 无                                  | `Promise<WorkspaceReadR[]>`      |
| `toWrite`          | `workspace:toWrite`          | `{ title, icon?, color?, folders }` | `Promise<WorkspaceReadR>`        |
| `toUpdate`         | `workspace:toUpdate`         | `{ id, title?, icon?, color?, … }`  | `Promise<WorkspaceReadR>`        |
| `toRemove`         | `workspace:toRemove`         | `{ id }`                            | `Promise<void>`                  |
| `toArchive`        | `workspace:toArchive`        | `{ id }`                            | `Promise<WorkspaceReadR>`        |
| `folders.toWrite`  | `workspace:folders.toWrite`  | `{ workspaceID, path, isPrimary? }` | `Promise<FolderR>`               |
| `folders.toUpdate` | `workspace:folders.toUpdate` | `{ id, isPrimary?, sort? }`         | `Promise<FolderR>`               |
| `folders.toRemove` | `workspace:folders.toRemove` | `{ id }`                            | `Promise<void>`                  |
| `readDir`          | `workspace:readDir`          | `{ workspaceID, relative? }`        | `Promise<DirEntryR[]>`           |
| `search`           | `workspace:search`           | `{ workspaceID, query, limit? }`    | `Promise<SearchHitR[]>`          |
| `readFile`         | `workspace:readFile`         | `{ workspaceID, relative }`         | `Promise<FileContentR>`          |
| `git.probe`        | `workspace:git.probe`        | `{ workspaceID }`                   | `Promise<{ isRepo, branch }>`    |
| `git.branches`     | `workspace:git.branches`     | `{ workspaceID }`                   | `Promise<{ current, branches }>` |
| `git.checkout`     | `workspace:git.checkout`     | `{ workspaceID, branch }`           | `Promise<{ branch }>`            |
| `changes.toRead`   | `workspace:changes.toRead`   | `{ sessionID }`                     | `Promise<ChangesR>`              |
| `changes.toUndo`   | `workspace:changes.toUndo`   | `{ sessionID, changeID? }`          | `Promise<ChangesR>`              |

- 错误码：`WORKSPACE_NOT_FOUND` / `WORKSPACE_PATH_DUPLICATE` / `WORKSPACE_PATH_UNAVAILABLE` /
  `WORKSPACE_FOLDER_NOT_FOUND` / `WORKSPACE_FOLDER_REQUIRED` / `WORKSPACE_PATH_ESCAPE` /
  `WORKSPACE_ENTRY_NOT_FOUND` / `WORKSPACE_FILE_TOO_LARGE` / `WORKSPACE_GIT_FAILED` /
  `WORKSPACE_CHANGE_NOT_FOUND`
- 文件 API 与 git 一律以 **primary folder** 为沙箱根
- `changes` 记录的是 **opencode 的 `session.diff({ sessionID })`** —— 一次调用返回**全量**变更，
  通常一个文件一条累计 patch（快照 → 当前），不是主进程自己记的日记：
  只有 **git 工作区**才有记录（opencode 的快照落在 shadow repo 里），plain 目录拿到的是空列表；
  撤销 = 把 patch 逆向套用 + 删掉新增文件（**不调 `session.revert`**，那会连对话一起回退），
  见 [online-models.md](./online-models.md) §7.3
- 这份清单的**唯一界面上**是右栏「变更」段（逐文件 / 全部撤销），消息流里只留一条汇总条；
  运行中 1.2s 轮询、运行结束再补一次，见 [online-models.md](./online-models.md) §7.6
- 遍历一律跳过 `node_modules` / `.git` / `dist` 等与隐藏项（`.env.example` 例外）；
  单文件读取上限 2MB，检索有界（深度 8 / 目录 2000 / 命中 200）
- 目录选择用 `dialog.open({ directory: true })`

---

## chat

会话 / 消息 / provider 仓储（Drizzle，主进程独占；渲染进程只拿元数据，apiKey 不落库）。

| 方法                | Channel                  | 入参              | 返回                       |
| ------------------- | ------------------------ | ----------------- | -------------------------- |
| `provider.toRead`   | `chat:provider.toRead`   | 无                | `Promise<ProviderReadR[]>` |
| `provider.toWrite`  | `chat:provider.toWrite`  | `ProviderWriteP`  | `Promise<ProviderReadR>`   |
| `provider.toUpdate` | `chat:provider.toUpdate` | `ProviderUpdateP` | `Promise<ProviderReadR>`   |
| `provider.toRemove` | `chat:provider.toRemove` | `{ id }`          | `Promise<void>`            |
| `session.toRead`    | `chat:session.toRead`    | 无                | `Promise<SessionReadR[]>`  |
| `session.toWrite`   | `chat:session.toWrite`   | `SessionWriteP`   | `Promise<SessionReadR>`    |
| `session.toUpdate`  | `chat:session.toUpdate`  | `SessionUpdateP`  | `Promise<SessionReadR>`    |
| `session.toRemove`  | `chat:session.toRemove`  | `{ id }`          | `Promise<void>`            |
| `message.toRead`    | `chat:message.toRead`    | `{ sessionID }`   | `Promise<MessageReadR[]>`  |
| `message.toAppend`  | `chat:message.toAppend`  | `MessageAppendP`  | `Promise<MessageReadR>`    |
| `message.toUpdate`  | `chat:message.toUpdate`  | `MessageUpdateP`  | `Promise<MessageReadR>`    |
| `message.toRemove`  | `chat:message.toRemove`  | `{ id }`          | `Promise<void>`            |
| `usage.toRead`      | `chat:usage.toRead`      | `{ sessionID }`   | `Promise<UsageReadR>`      |

`ProviderReadR`：`{ id, kind, name, baseUrl, models: ModelEntry[] | null, model, enabled, createdAt, updatedAt }`；
`models` 落库是 JSON 文本，IPC 上是数组，`ModelEntry = { id, name?, providerName?, capabilities?, limit? }`（能力/上限可缺，读时按契约兜底）；
时间均为 ISO 字符串。

`SessionReadR`：`{ id, title, pinned, providerID, createdAt, updatedAt }`；`session.toRead` 按 `pinned`、`updatedAt` 倒序（置顶优先、其次最近活动）。

`MessageReadR`：`{ id, sessionID, parentID, format, content, createdAt, updatedAt }`。
`format` + `content` 由渲染进程的 MessageFormatAdapter（`encode()`）产出，主进程不解析；`parentID` 表达编辑/重生成分支。
`content` 里除消息本体外还会带 `metadata.custom`——我们自己的扩展位（目前只有用量），assistant-ui 的运行时元数据（steps / timing）**不入库**。
`message.toAppend` 顺带推进所属会话的 `updatedAt`；删消息级联删后继分支，删会话级联删消息，删 provider 只把会话的 `providerID` 置空。

`UsageReadR`：`{ session, today }`，每项是 `{ runs, inputTokens, outputTokens, totalTokens }`。
它读的是**用量账本**（表 `chatUsage`，一次运行一条、只增不改，见 [online-models.md](./online-models.md) §7.5）：
`session` 是本会话累计（`sessionID` 省略 / 为 null 时给全零），`today` 是**全部会话**的今日合计
（含没有会话归属的，按本地零点切）—— 两者口径不同、不相等，这是有意的。
账本由引擎在终态汇聚点写（先记账再发终态，成功 / 取消 / 失败都算），`runID` 唯一约束让重复结算无害；
`sessionID` / `providerID` 刻意不加外键，会话被删也不带走历史用量。
消息里那份用量（`metadata.custom.usage`）是另一个口径，两者分开显示。右栏「用量」段把两个口径
分别标名给出（见 [online-models.md](./online-models.md) §7.6）。

目标记录不存在时抛 `CHAT_{PROVIDER,SESSION,MESSAGE}_NOT_FOUND`。

---

## assistant（agent 运行时）

生成**只有一条链路**：主进程把 provider/凭据交给内嵌的 `opencode serve`，由它跑 agent 循环
（工具、压缩、快照、子任务都在 opencode 里）。provider 是「本机 BYOK」还是「平台网关」
只影响凭据与端点，不影响这里的协议。生成过程走 **MessagePort 纯数据协议**，不是 invoke。

主进程侧的落地：`capabilities/assistant/index.ts`（Electron 接线：密钥库、IPC、端口）+ `capabilities/opencode/`
（`server` 进程生命周期 / `config` 配置生成 / `engine` 运行与事件 / `events` 事件翻译 / `changes` 变更卡 /
`session` 会话映射 / `permission` 审批语义 / `paths` 二进制与私有目录）。见
[online-models.md](./online-models.md) §7.3。

| 方法           | Channel                        | 入参                     | 返回                                        |
| -------------- | ------------------------------ | ------------------------ | ------------------------------------------- |
| `connect`      | `assistant:connect`            | 无                       | `Promise<void>`（建端口后由主进程推送）     |
| `onPort(cb)`   | `assistant:port`（主进程推送） | —                        | 取消订阅函数；`cb(port)` 拿到 `MessagePort` |
| `key.toWrite`  | `assistant:key.toWrite`        | `{ providerID, apiKey }` | `Promise<void>`                             |
| `key.has`      | `assistant:key.has`            | `{ providerID }`         | `Promise<boolean>`                          |
| `key.toRemove` | `assistant:key.toRemove`       | `{ providerID }`         | `Promise<void>`                             |

**端口协议**（`src/host/capabilities/assistant/protocol.ts`，均为可结构化克隆的纯数据）：

| 方向            | 消息                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| renderer → main | `{ kind: 'start', runID, providerID, model, messages: {role,content,images?,attachments?}[], host? }` |
| renderer → main | `{ kind: 'abort', runID }`                                                                            |
| renderer → main | `{ kind: 'tool-approval', runID, toolCallId, approved }`                                              |
| main → renderer | `{ kind: 'text' \| 'reasoning', runID, blockID, text }`                                               |
| main → renderer | `{ kind: 'tool-call', runID, toolCallId, toolName, input }`                                           |
| main → renderer | `{ kind: 'tool-approval-request', runID, toolCallId, toolName, input, prompt }`                       |
| main → renderer | `{ kind: 'tool-result', runID, toolCallId, toolName, output, isError }`                               |
| main → renderer | `{ kind: 'finish', runID, finishReason, usage }`                                                      |
| main → renderer | `{ kind: 'aborted' \| 'error', runID, message? }`                                                     |

约束：单条消息 ≤ 1MB（JSON 字符数）、单请求 ≤ 200 条消息、同一端口并发运行 ≤ 4；超限的 `start` 会被拒绝并**以 `error` 事件回执**（用户能看到原因），`abort` / `tool-approval` 是单向消息，被拒时静默丢弃；端口关闭或窗口销毁 → 该端口所有运行立即 abort。

**`host` 是宿主扩展位**（`{ supportsTools?: boolean, approval?: 'auto' | 'ask' | 'readonly', workspaceID?: string | null, sessionID?: string, platformToken?: string, tenantID?: string }`）：
渲染进程只报事实（这个模型支不支持工具、这次怎么审批、沙箱根是哪个、是哪个会话、
用哪份登录令牌、配额算到哪个租户），**档位怎么翻成 opencode 的权限规则由引擎决定**：
工具名的单一事实源是 `src/shared/agent-tools.ts`，档位 → 有序规则表在 `opencode/permission.ts`。
`workspaceID` / `sessionID` / `tenantID` 都必须是 uuid。
顶层**没有** `system`：系统提示词不在这一层（它归 opencode 的 agent，见
[online-models.md](./online-models.md) §7.3），消息数组里的 `role: 'system'` 会被接受但**不会进提示词**
（当前渲染层不产生这种消息；要给模型加指令，走 agent 配置）。
`platformToken` 只对 `kind === 'gateway'` 的 provider 有意义且 ≤4096 字符（见下节），主进程用它当 apiKey，不落钥匙串。
`tenantID` 同样只对网关有意义：它进 `provider.<id>.options.headers` 的 `X-Tenant-ID`，决定网关把本次用量记到哪个租户（见下节）。

**引用（@ 工作区文件）走 prompt 附件，不内联文件内容**：

- 渲染侧：composer 的 `@` 按钮（`views/agent/components/reference-picker.tsx`）基于 `workspace:readDir / search`
  选文件，落成 assistant-ui 的 **file 附件**（`aui.composer.addAttachment`）—— 所以引用在输入区可移除、随消息落库
- 适配器（`@cogito/chat/adapters/chat-model`）把用户消息里的 file/image part 收成消息上的 `attachments: string[]`
- 主进程清洗后（`opencode/session.ts`：只收工作区**相对**路径、拒绝对路径与 `..`、限长 1024、最多 32 条、去重）
  变成 opencode prompt 的 `files`（`file://` URI），由服务端自己去读
- 于是文件内容从不进 payload（拖进来一个大文件也不会顶爆 1MB 上限），也不用往提示词里塞一份名单：
  越界拦截由 opencode 的 `external_directory` 权限守卫负责

**工具执行与审批**（BYOK 与平台网关共用；网关把上游请求里的 `tools` / `system` 原样透传，所以在线模型同样有工具）：

- 工具在 **opencode 进程内**执行，工作目录就是本次运行的工作区，
  越界访问由 opencode 的 `external_directory` 权限拦下并变成一次审批请求
- 工具名以 [`shared/agent-tools.ts`](../../../apps/studio/src/shared/agent-tools.ts) 的 `AGENT_TOOL_NAMES`
  为单一事实源（13 项：`read` / `glob` / `grep` / `webfetch` / `websearch` / `skill` / `edit` / `write` /
  `patch` / `shell` / `subagent` / `execute` / `question`；`question` 归 `unavailable`，
  serve 模式下反问没人能回答，所以三档都 deny）
- 工具间**同名不同类**的坑按表对齐：`write` / `patch` 与 `edit` 在 permission 上同属 `edit` action
- 工具可见性由 permission 决定，**没有「请求体开关」这回事**：effect 为 `deny` 的 action 不进模型工具列表。
  没在工具表里点名的（自定义 / MCP / 升级新增）落到兜底规则上，按 `mutating` 处理（`ask` 档逐次确认、
  `readonly` 档拒绝、`auto` 档放行），工具卡标题退化成英文原名
- 档位 → 规则表编译成 3 个自定义 primary agent（`studio-auto` / `studio-ask` / `studio-readonly`），
  每轮运行前 `switchAgent` 切一次；`supportsTools === false` 时走 `studio-chat`（一个工具都不给）
- 有副作用的工具执行前，opencode 发 `permission.asked` → 主进程翻成 `tool-approval-request` 给渲染层，
  等 `tool-approval` 回执后以 `once` / `reject` 回给 opencode；**超时（5 分钟）或 abort 一律按拒绝落地**，
  找不到归属运行（提问的会话已收尾）同样按拒绝落地，不让服务端干等
- **`.env` 在任何档位下都读不到**：规则表末尾补 `read *.env` / `read *.env.*` → `deny`、
  `read *.env.example` → `allow`（见
  [`opencode/permission.ts`](../../../apps/studio/src/host/capabilities/opencode/permission.ts)）
- 循环步数、上下文压缩、子任务深度都由 opencode 自己管，studio 不再设「最多 8 步」这类上限

**本机 apiKey 不进端口、也不出主进程**：`key.toWrite` 只写、`key.has` 只答是与否，没有读回接口；系统密钥库（`safeStorage`）不可用时**拒绝保存**（`ASSISTANT_KEYSTORE_UNAVAILABLE`），不退化成明文。
登录令牌是唯一例外：它随该次运行的 `host.platformToken` 从渲染进程进主进程（当 apiKey 用），不落钥匙串、不进数据库。

---

## 模型网关（`kind: 'gateway'` 的平台 provider）

网关**不是**一条独立通路：它是 provider 表里的一行（固定 id `platform-gateway`、展示名「组织模型」），
对话仍走上节的 assistant 端口，只是 `resolveConnection` 把凭据换成登录令牌、端点换成
`findGatewayBaseURL()`（`VITE_COGITO` 后补 `/gateway`）。

| 用途     | 请求                                                    | 说明                                                                                           |
| -------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 对话     | `POST ${VITE_COGITO}/gateway/chat/completions`（SSE） | body `{ model, stream: true, messages, tools?, ... }`；`tools` / `system` 由网关原样透传给上游 |
| 模型目录 | `GET ${VITE_COGITO}/gateway/models`                   | 信封 `data: ModelR[]`；只列 `enabled` 且当前角色允许的模型                                     |

`VITE_COGITO` 含版本前缀（如 `http://127.0.0.1:3000/api/v1`），网关根地址由 `findGatewayBaseURL()` 在其后补 `/gateway`。

管理面（全部要求 `role === "ADMIN"`，服务端非管理员回 `300006`）：

| 用途     | 请求                                                    | 说明                                                                          |
| -------- | ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 供应商   | `GET/POST /gateway/providers`、`PUT/DELETE /{id}`       | `apiKey` 只写不读，列表回 `hasApiKey`                                         |
| 平台模型 | `GET/POST /gateway/admin/models`、`PUT/DELETE /{id}`    | 不过滤 `enabled`；更新不支持改挂供应商；可写 `capabilities` / `contextWindow` |
| 用量     | `GET /gateway/usage?tenantID&modelID&from&to&page&size` | 信封 `data: Paginated<UsageR>`                                                |
| 审计     | `GET /gateway/audit?tenantID&page&size`                 | 信封 `data: Paginated<AuditR>`                                                |

`Paginated<T>` = `{ items, count, page, size, total, next, prev }`：`page` **从 1 起**，`count` 是总条数，`total` 是总页数。

- 平台行接入：[`features/chat/platform.ts`](../../../apps/studio/src/features/chat/platform.ts) —— 把目录写成 provider 行，发送前 `ensurePlatformProvider()` 同步一次；网关客户端（目录 + 管理面）：[`apps/studio/src/apis/gateway.ts`](../../../apps/studio/src/apis/gateway.ts)；模型选择器：`apps/studio/src/features/chat/model-picker.tsx`。
- 管理面入口在设置页「平台」分组（`views/agent/settings/sections/platform-*.tsx`），只有 `isAdmin()` 为真才渲染；`isAdmin()` 解登录令牌 payload 的 `role`，必须精确等于 `ADMIN`（[`utils/auth.ts`](../../../apps/studio/src/utils/auth.ts)）。
- 模型名落 `chat.model`（`ModelR.name`，网关按名字路由到上游）；目录首项 `auto` 是**服务端补全**的保留名，客户端原样透传，后台也建不了同名模型（`200003`）。
- **失败一律是 HTTP 200 + 信封**（`{ code, success: false, msg }`）：`300001` 未登录（令牌缺失/过期/`sub` 非 UUID）、`200003` 参数无效、`400001` 模型不存在、`400006` 配额已用尽、`600005` 上游不可用（供应商地址不通）。
  请求现在由 opencode 发出，所以 `msg` 的挖掘分两层：`host/capabilities/opencode/events.ts` 的
  `describeOpencodeError` 从错误报文里截出 JSON 信封取 `msg`（opencode 会把整段信封塞进错误消息），
  `assistant/protocol.ts`（`src/host/capabilities/`）的 `findErrorMessage` 再补一句可操作的提示
  （如配额触顶时指向「设置 → 额度」）。
- 网关无状态（不存服务端会话）：`reconnectToStream()` 返回 `null`。
- **配额归属靠请求头 `X-Tenant-ID`**：不带这个头时网关按用户身份兜底，**订阅档位永不生效**。studio 只在「已解析出个人租户」时写这个头，注入点有两处：
  - 渲染层 HTTP 客户端：[`utils/http.ts`](../../../apps/studio/src/utils/http.ts) 对 `/gateway/*`（`isCogitoUrl` 命中自家 API）统一补该头，值同步读自 [`utils/tenant.ts`](../../../apps/studio/src/utils/tenant.ts) 的值缓存；
  - agent 运行链路：由 [`assistant/model.ts`](../../../apps/studio/src/host/capabilities/assistant/model.ts) 的 `resolveConnection` 写进 opencode 的 provider headers。
    缓存 5 分钟 + 登录令牌指纹（[`features/quota/tenant.ts`](../../../apps/studio/src/features/quota/tenant.ts)），本机 BYOK provider 与第三方域名都不写。

配额 / 订阅 / 支付（业务 API，与网关分开）：客户端在 [`apis/gateway.ts`](../../../apps/studio/src/apis/gateway.ts)（自助配额、档位目录）、
[`apis/quota.ts`](../../../apps/studio/src/apis/quota.ts)（租户、订阅）与 [`apis/payment.ts`](../../../apps/studio/src/apis/payment.ts)（档位目录、订单），
界面在设置页「个人 → 额度」与左栏底栏额度入口。

| 用途        | 请求                                                  | 说明                                                                                                                                                                                                       |
| ----------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 我的配额    | `GET /gateway/quota/me?model=`                        | 登录即可读（无需管理员、只读不计费）；`{ scope, scopeID, tenantID?, tenantType?, source, plan?, limit, used, remaining, exhausted, resetsAt }`；`model` 缺省或 `auto` = 身份级                             |
| 档位目录    | `GET /gateway/plans`                                  | `{ plans: [{ plan, dailyTokenQuota }], freeDailyTokenQuota }`；订阅界面据此渲染，不再手填档位名                                                                                                            |
| 我的租户    | `GET /tenants`                                        | 注册时自动建个人租户；只有 `type === 'PERSONAL'` 能命中档位                                                                                                                                                |
| 生效配额    | `GET /tenants/{id}/quota`                             | `{ source: 'PLAN' \| 'FREE' \| 'GLOBAL', plan, dailyTokenQuota }`；服务端保留，客户端已无调用者（被 `/gateway/quota/me` 取代）                                                                             |
| 订阅列表    | `GET /tenants/{id}/subscriptions`                     | 含已失效的历史记录                                                                                                                                                                                         |
| 开通 / 续订 | `POST /tenants/{id}/subscriptions`                    | body `{ plan, expiresAt? }`（毫秒，缺省 = 永久）；创建即生效并作废旧订阅；团队租户不可订阅；**只对未定价档位开放**，`pay.plans[plan].amount > 0` 的服务端返回 `500408` —— 已定价档位必须走支付             |
| 取消        | `DELETE /tenants/{id}/subscriptions/{subscriptionID}` | 立即取消，配额回落免费档                                                                                                                                                                                   |
| 可售档位    | `GET /tenants/{id}/pay/catalog`                       | `{ currency, orderTtlSecs, plans: [{ plan, label, amount, durationDays, dailyTokenQuota, purchasable, reason? }], channels: [{ code, label, enabled, reason? }], currentPlan? }`；价格与时长**只在服务端** |
| 下单        | `POST /tenants/{id}/orders`                           | body 只有 `{ plan, channel }`（`WECHAT` / `ALIPAY`）→ `{ orderNo, amount, currency, status, codeUrl, orderExpiresAt, … }`；金额由服务端定价并快照，客户端提交不了价格                                      |
| 订单历史    | `GET /tenants/{id}/orders`                            | 服务端返回最近 20 笔（顺带惰性关单，状态不会滞留）                                                                                                                                                         |
| 订单详情    | `GET /tenants/{id}/orders/{orderNo}`                  | 单笔订单                                                                                                                                                                                                   |
| 主动查单    | `POST /tenants/{id}/orders/{orderNo}/sync`            | 回调丢失的兜底 / 收银台「刷新支付状态」；同样由服务端向上游查单核销                                                                                                                                        |
| 关闭订单    | `POST /tenants/{id}/orders/{orderNo}/close`           | 用户取消支付；已支付订单服务端返回 `200003`（退款走渠道后台）                                                                                                                                              |
| 用量明细    | `GET /gateway/usage?tenantID&from&page&size`          | **ADMIN-only**，只在管理面「平台用量」使用；「今日已用」改由 `/gateway/quota/me` 的 `used` 提供                                                                                                            |

- 限额优先级：模型级 `dailyTokenQuota > 0` 覆盖租户档位；`source` / `plan` 由服务端直出。
- 支付安全边界：订阅只由服务端**验签 + 金额核对之后**开通（`SubscriptionService::grant`），
  客户端没有「点了就生效」的接口；`codeUrl` 只用于本地渲染二维码，不要透出或缓存到别处。
  渠道凭据未配置时目录 `enabled=false`，界面置灰并显示原因。
- 发送前门禁（[`features/quota/gate.ts`](../../../apps/studio/src/features/quota/gate.ts)）：只拦平台网关，
  单次 `GET /gateway/quota/me`（有目标模型带 `?model=`），**信服务端的 `exhausted`**；
  结论缓存 60s（key = `租户:模型`，失败也缓存；订阅/取消后 `clearQuotaCheck()` 作废），
  **算不准就放行** —— 没有租户身份、接口不通一律交给服务端；拦下时端口首条事件是 `error`。

---

## 错误码

`IPC_ERROR_CODES`（`src/shared/ipc/error.ts`）是有限联合，分类如下。

### 传输层

| code                   | 含义                                          |
| ---------------------- | --------------------------------------------- |
| `IPC_UNTRUSTED_SENDER` | sender 未登记或 URL 不合规                    |
| `IPC_INVALID_PAYLOAD`  | zod 校验失败（`details` 为拍平的 issue 列表） |
| `IPC_HANDLER_ERROR`    | 未预期异常（保留原始 `name`）                 |
| `IPC_UNKNOWN`          | 无法从 message 前缀还原 code                  |

### 业务失败

| code                             | 域         |
| -------------------------------- | ---------- |
| `CHAT_PROVIDER_NOT_FOUND`        | chat       |
| `CHAT_SESSION_NOT_FOUND`         | chat       |
| `CHAT_MESSAGE_NOT_FOUND`         | chat       |
| `CHAT_MESSAGE_APPEND_FAILED`     | chat       |
| `USER_RECORD_NOT_FOUND`          | user       |
| `OVERLAY_UNAVAILABLE`            | overlay    |
| `DEVTOOLS_DISABLED`              | devtools   |
| `UPDATER_NOT_CONFIGURED`         | updater    |
| `UPDATER_NO_UPDATE_DOWNLOADED`   | updater    |
| `UPDATER_CHECK_FAILED`           | updater    |
| `ASSISTANT_FRAME_UNAVAILABLE`    | assistant  |
| `ASSISTANT_KEYSTORE_UNAVAILABLE` | assistant  |
| `DOC_PANDOC_MISSING`             | doc        |
| `DOC_INPUT_NOT_FOUND`            | doc        |
| `DOC_CONVERT_FAILED`             | doc        |
| `DOC_TIMEOUT`                    | doc        |
| `TOOL_UNSUPPORTED`               | tool       |
| `TOOL_DOWNLOAD_FAILED`           | tool       |
| `TOOL_CHECKSUM_MISMATCH`         | tool       |
| `TOOL_EXTRACT_FAILED`            | tool       |
| `SCREENSHOT_ACTION_UNAVAILABLE`  | screenshot |
| `SCREENSHOT_NO_FILE`             | screenshot |
| `SCREENSHOT_BAD_PAYLOAD`         | screenshot |
| `SIDECAR_NOT_READY`              | sidecar    |
