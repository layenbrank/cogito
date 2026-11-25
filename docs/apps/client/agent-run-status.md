# 回合尾注：这一轮是怎么结束的

> **路径已变**：下文提到的 `features/agent/acp/session.ts` 已不存在；事件泵现在是
> `@cogito/agent-runtime/agentd/turn`（`runTurn` / `pumpTurn`），client 的
> `features/agent/port/session.ts` 只做适配与策略。未终态的结束已不再靠猜：状态机只会给出
> `stop`（`end_turn` / `cancelled`）或带 `code` 的 `TurnFailure`
> （`subscribe_failed` / `run_rejected` / `stream_closed` / `idle_timeout` / `run_failed`）。
> 已知问题与已修项见 [agent-audit.md](./agent-audit.md)。

正文末尾原先只有一种提示 —— 用户按停止时的「已停止生成」。正常跑完什么都不显示，
于是三种完全不同的结局在界面上长得一模一样：

1. 模型说完了（`complete`）
2. 用户自己停了（`incomplete / cancelled`）
3. 流断了 / 被截断 / 出错（`incomplete / length`、`content-filter`、`other`、`error`）

用户没法判断「对话是完成了，还是意外中断了」。现在四种结局各给一句话。

## 口径

由 `packages/design/src/assistant/run-status.ts` 的 `findRunNote(status, isLast, labels)`
统一决定，纯函数、可单测；`thread.aui.tsx` 的 `AssistantRunStatus` 只负责渲染。

| 消息状态                                           | 尾注                       | 图标             | 备注                                   |
| -------------------------------------------------- | -------------------------- | ---------------- | -------------------------------------- |
| `running`                                          | 无                         | —                | 「思考中…」脉冲点已经在跑，不重复      |
| `requires-action`                                  | 无                         | —                | 等审批 / 追问，卡片本身在说话          |
| `complete`                                         | **已完成**                 | `circle-check`   | **只在最后一条消息上标**               |
| `incomplete / cancelled`                           | 已停止生成                 | `square`         | 用户自己按的停止                       |
| `incomplete / length`                              | 输出被截断（达到长度上限） | `triangle-alert` | 正文是被切掉的，必须区别于「正常结束」 |
| `incomplete / content-filter / other / tool-calls` | 生成被中断                 | `circle-x`       | 不知道具体原因，但明确「不是正常结束」 |
| `incomplete / error`                               | 无                         | —                | 红色错误块已经写明原因，不重复两遍     |

**为什么「已完成」只标最后一条**：历史回合每条都挂一行「已完成」，长对话会被刷成日志；
而「中断 / 截断」是信息性事实，历史里也照标。用户发下一条消息后，上一轮的「已完成」
自然消失 —— 那时它已经不是一个需要确认的问题了。

## 文案

所有可见字符串走 `assistant/labels.tsx`（`useAssistantLabels`），中文覆盖在
`apps/client/src/views/agent/chat/labels.ts`：

- `completedRun` / `truncatedRun` / `interruptedRun` 为本次新增
- `stoppedRun` 沿用原有字段，语义不变

## 顺带修掉的一个「静默中断」

`features/agent/acp/session.ts` 的 update 泵以前没有 catch：`nextUpdate()` 一旦抛错
（连接断开、goose 进程崩了），这一轮不会再有 `stop` 事件，`queue.take()` 会一直等 ——
界面永远停在「思考中」，用户看到的是「对话突然没声了」，也看不到错误。

现在泵异常会补一条 `stopReason: 'error'` 终态并释放等待：模型层按错误收尾，
前端渲染成红色错误块，同时尾注不会再把它当「已完成」。

## 错误与中断：三种「没跑完」要分开

上面那张表只解决**显示**，真正的判据在 `apps/client/src/features/agent/acp/run-error.ts`。
一轮 prompt 结束得「不对劲」有三类，以前它们在代码里长得几乎一样，于是用户看到的是
一句英文内部消息弹在对话里：

| 情形              | 谁触发                                                     | 现在的收尾                                                                        |
| ----------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 用户按停止 / 撤销 | `AbortSignal`、`run.prompt.cancelled`                      | `stopReason: 'cancelled'` → 「已停止生成」，**不报错**                            |
| 会话/连接被重置   | goose 侧车退出（`goose:not-ready`）、换连接、会话 cwd 变了 | 中文一句「与 goose 的连接已断开（侧车退出或重启），本轮已中止；重新发送即可继续」 |
| 真正的调用失败    | 网关 401、上游模型异常、参数无效……                         | `parseAuthRequired()` 给出的人话，原样透传                                        |

### 取消不是失败（一个真实的误判）

ACP SDK 的 `ActiveSession.prompt()` 在请求被拒时会把**排队中的 `nextUpdate()` 一起 reject**
（`AsyncQueue.reject`），所以取消时「泵」和「prompt」两条路收到的是同一个 abort 错误。
泵那条路以前直接把它记成失败，用户在**主动停止**时就可能看到红色错误块。
现在两处都先问 `isRunCancelled(run, signal)`，取消只发 `cancelled` 终态。

### 重置不要冒充报错

`ActiveSession.dispose()` 会让排队中的 `nextUpdate()` 以 `Active session disposed` 失败。
会话被重置（`clearThreadSessions` / `ensureThreadSession` 换连接）**必然**踩到这一步，
而重置不是用户或模型做错了什么，只有「重发一次」这一个动作。所以：

- `ThreadRun.reset` 在 dispose 之前置位（`clearThreadSessions` / `ensureThreadSession`；
  `closeThreadSession` 本来就有 `run` 保护，不会踩到）；
- `humanizeRunError(error, reset)` 见到 `reset` 或匹配到 `Active session disposed` /
  `Connection closed` / `Failed to fetch` / `ECONNREFUSED` 这类消息，就换成上面那句中文，
  **原始错误留在 `cause`**，异常上报照样拿得到根因。

判据都是纯函数，单测在 `apps/client/src/features/agent/acp/run-error.test.ts`。

## 会话的「已读 / 未读」

左栏每个会话行有两种状态：**已读**（什么都不显示）与**未读**（标题前一个 `bg-primary` 小圆点）。
判据只有一条：**这一轮跑完了，而用户当时没在看这个会话**。

### 落库而不是放内存

`agent_session` 加了 `unread INTEGER NOT NULL DEFAULT 0`（`0` = 已读，`1` = 未读）。
放内存（像 `run-state.ts` 那样）一重启就没了，而「昨天有个会话跑完我还没看」正是要跨重启
保留的信息。历史会话补列时一律回填 `0`，升级完不会满屏未读点。

### 什么时候点亮、什么时候熄灭

唯一写入口是 `features/agent/session-unread.ts` 的 `markSessionUnread(id, unread)`，
它先比对内存里的值，没变就不打 IPC。两条规则都在 `use-sidebar-branches.ts`：

| 时机                                  | 动作     | 为什么这么判                                                                    |
| ------------------------------------- | -------- | ------------------------------------------------------------------------------- |
| 某会话从「在跑」变成「没在跑」        | 记为未读 | 用 running 集合**上一帧 vs 这一帧的差分**，且跳过「当前正在看的那个」与首帧水合 |
| 当前会话（`mainThreadId` → remoteId） | 记为已读 | 切过去、被自动化自动切过去、会话就在眼前跑完，都覆盖                            |

**为什么不用 `run-state` 的 `finished` 集合**：它只增不减，分不清「刚刚跑完」和「早就跑完、
用户看过又标成已读」，会把已读反复写回未读（左栏圆点擦不掉）。

**为什么首帧要跳过**：启动时 `hydrateRunningFromPersistence()` 会把 localStorage 里的在跑标记
灌回内存，那不是「刚刚跑完」，不该点未读。

### 未读不推进 `updatedAt`

`agent_session::Service::update_one` 里只有内容字段（title / pinned / providerID / workspaceID）
才刷 `updatedAt`；`unread` 只是阅读状态，刷了就会「每点开一次会话，左栏树重排一次」。

### 不新增迁移版本

按仓库既有约定（`automation_schema.rs` / `agent_plan_schema.rs` 同一路数）：
`migrations_0001.rs` 一个字不动，新列的定义放在 `migrations/agent_session_schema.rs`，
由 `migration.rs::ensure_agent_session()` 在每次启动时按 `pragma_table_info` 判缺列再
`ALTER TABLE ... ADD COLUMN`。老库保留全部数据，新库走同一条兜底（先建表再补列）。

手工等价物：`src-tauri/crates/database/sql/2026-11-09-agent-session-unread.sql`
（体检 → 加列 → 验证，可对任意备份库直接执行）。两边都跑也不会坏，只是后者会报
`duplicate column name`。守卫在 `migration.rs` 的两条测试：
`agent_session_unread_is_patched_on_old_db`（删列后能补回、幂等、默认值是 `0`）与
`entity_columns_match_ddl`（entity 与 DDL 双向对齐）。

## 失败的哪一层：模型、工具、授权、连接

「这一轮失败了」只有一个笼统的错误块时，用户没法判断是模型网关挂了、工具本身报错，
还是授权闸门拦下了这次调用 —— 三种情况的修法完全不同。现在 agentd、日志、界面共用一套词表：

| 归因         | 典型消息                                  | 下一步                       |
| ------------ | ----------------------------------------- | ---------------------------- |
| `cancelled`  | `Abort`、用户按停止                       | 不是失败，不报错             |
| `connection` | `Active session disposed`、`goose 未就绪` | 重发一次                     |
| `permission` | `never_allow`、`授权策略`                 | 改策略 / 重新点允许          |
| `provider`   | `Upstream 429`、`context length`、`401`   | 看 provider 配置 / 配额      |
| `tool`       | `tool execution failed: ENOENT`、`EINVAL` | 展开工具卡，按同样参数重跑   |
| `unknown`    | 认不出来的                                | 贴诊断信息 + 查 `run.failed` |

三个落点读同一份判据，不会各说各话：

- agentd `src/error-kind.ts`：`classifyRunFailure()` 产出 `run.failed` 日志行与
  `runs.failed` 计数，并把 `errorKind` 塞进 `status`（`phase: 'settled'`）事件；
- 客户端 `features/agent/acp/run-error.ts`：`annotateRunFailure()` 把归因拼到消息前面
  （`模型 / 网关：Upstream 429 ...`），由 `features/agent/port/session.ts` 在 `settled`
  分支调用；
- 工具卡：`views/agent/chat/components/tool-card-body.tsx` 的 `ToolFailureNote` 用
  `features/agent/failure-source.ts` 判断「这张卡是工具自己坏了，还是授权/连接」，「复制
  诊断」给出工具名、调用 id、参数与原始输出的 JSON。

判据顺序有讲究，别随手调：**连接 → 文件系统错误码 → 授权 → 模型 → 工具**。连接先判是因为
那时工具根本没跑；`EACCES` 这类错误码必须先于「permission」，否则文件系统报错会被误报成
授权拒绝；`provider` 先于 `tool`，因为网关的错误常常自带「tool calling failed」字样。

### 日志

- 位置：`%LOCALAPPDATA%\com.cogito.client\logs\cogito.log`（dev 实例是
  `com.cogito.client.dev`），单文件 5 MB 轮转、保留 30 天；
- agentd 的 stdout / stderr 逐行转进同一份日志（target `agentd`）：`AGENTD_EVENT {...}` 是
  结构化事件（`tool.completed` / `tool.failed` / `run.failed` / `run.settled` /
  `goose.restart`），单行超过 4096 字符会被截断；
- 计数：`apps/agentd/src/observability.ts` 的 `METRIC_NAMES` 里有 `tools.completed` /
  `tools.failed` / `runs.failed` / `runs.cancelled`，失败率看前两个比值；
- `sqlx::query` / `sea_orm` 默认压到 Warn：每句 SQL 都按 Info 落盘时一个文件几秒就刷满，
  一整轮对话的记录被挤进轮转文件 —— 排查偶发失败要的是长历史，逐句看 SQL 用 `--verbose`。
