# 会话终端与 agent 终端

一条命令在本应用里有三处呈现，各有分工，别互相替代：

| 位置                             | 形态                                                       | 实现                                                                   |
| -------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| 会话里的工具卡                   | **默认折叠**成一行 `$ 命令` + 状态 + 耗时，点开才是完整终端 | `apps/client/src/views/agent/chat/components/tool-card-terminal-body.tsx` |
| 右栏「详情 · 正在执行」          | 运行中的命令一行一条，点一行跳到终端 tab                    | `features/agent/running-commands.ts` + `aside-busy.tsx`                  |
| 右栏「终端」页签（xterm + PTY）  | 真正的 shell；agent 的命令也在这里跑                        | `features/terminal/*` + `src-tauri/src/utils/terminal.rs`                |

## 折叠口径

- **默认折叠，运行中也不自动弹开**：折叠态只回答「在跑什么」，几十条命令不会把会话撑成几十块终端。
- 手动展开后 pin 住，本轮结束不自动收起（与 `process-group.tsx` 的 pinned 语义一致）。
- 折叠态不渲染 `TerminalContent`，只渲染摘要行；摘要行的复制按钮用 `TerminalCopyButton` 的 `text` 直传（折叠态没有 `Terminal` 上下文）。
- 展开态用 `Terminal` 的 `showHeader={false}`：摘要行已经是标题条，不再叠一层。

## 「详情 · 正在执行」的数据来源

- 会话消息里的 tool-call part **没有** `status`（那是渲染器 props 才有的字段），只能按结果推断：
  没有 `result`、或 `isPreliminary`（流式中间态）＝正在跑；等审批（`approval.approved === undefined`）、等人工回答（`interrupt`）都不算执行中。
- 耗时以「第一次观察到它在跑」起算 —— part 不带开始时间戳，用消息创建时间会被同一条消息里的多个工具调用互相污染。
- 点击行为：有同命令的 agent tab 就选中它；否则（goose 自带 shell 跑的命令不在嵌入式终端里）停在当前文件夹的终端。

## agent 用右栏终端执行命令

工具目录在 `src-tauri/crates/core/src/tools/terminal.rs`，执行在 `src/bridge/app_tools.rs`：

| 工具                | effect | 作用                                                       |
| ------------------- | ------ | ---------------------------------------------------------- |
| `app_terminal_run`  | write  | 在用户看得见的终端里跑一条命令，读回这段输出                |
| `app_terminal_read` | read   | 读会话最近输出（`isRunning: true` 之后续读）                |
| `app_terminal_list` | read   | 列出会话（id / cwd / pid）                                  |

链路：

1. `cogito-mcp` 的 `tools/list` / `tools/call` → app 内 loopback 桥 → `app_tools::call` → `utils::terminal::terminal_run`。
2. 会话 id 按 cwd 派生：`agent:<canonical cwd>`；没有就建，有就复用（同一目录反复跑命令共用一个 tab）。
3. 先广播 `terminal://agent-run`（前端 `revealAgentTab`：开 / 选 tab 并掀开面板），**再**写 `command\r`。
4. 等「安静期」（`quietMs`，默认 700ms）或超时（`timeoutMs`，默认 120s），从记录的游标读回输出，去 ANSI、按字符截尾。
5. 返回 `{ id, command, output, isRunning, elapsedMs }`；`isRunning: true` 表示还没静下来，需要 `app_terminal_read` 续读。

工具的 MCP 描述里写死了「串行调用」：同一目录的 agent 会话只有一个 shell，并发跑会互相干扰。

## 会话与视图解耦（Rust 侧）

- 每个会话带 256 KiB 回滚缓冲 + **绝对字节游标**（跨裁剪单调递增），agent 靠游标取「这次命令之后」的输出。
- `terminal:create`：视图首挂（同 id 重入先拆旧会话，避免孤儿写端）。
- `terminal:attach`：agent 先建、视图后挂 —— 回放缓冲与登记订阅者**在同一把锁里**完成，否则旧字节回放与新字节推送会交错，xterm 收到的顺序就乱了。
- agent 会话不随视图卸载回收（关掉面板不该杀掉正被命令占用的 shell）；进程回收仍走 `terminal:kill` 与应用退出。

## 已知限制

- 结束判定是「安静期」而不是注入标记：`npm run dev` / watch 这类持续输出会等到超时，返回 `isRunning: true` + 部分输出。换成 shell integration 更准，但要为 pwsh / bash 各写一套约定，暂不做。
- 命令必须是**单行**（内嵌换行会被 shell 当成多条命令，判定就失准）——`terminal_run` 直接报错，让模型用 `&&` / `;` 串联。
- ConPTY 上 PSReadLine 会重绘当前行，去 ANSI 后仍可能看到重复的前缀文本。
- 终端不是沙箱：命令以用户身份执行；`app_terminal_run` 归类为写工具，走审批（`features/agent/approval.ts` 的 `run` 动词命中）。

## 回归检查

- `pnpm --filter @cogito/client type-check` / `lint` / `unit`
- `cargo check` + `cargo test -p cogito-command`（`terminalText` 的 ANSI / 截尾单测在这里）
- 手测 A：会话里跑一条命令 → 卡片保持折叠，摘要显示「命令 + 转圈 + 耗时」；点开能看到带 ANSI 着色的输出。
- 手测 B：agent 调 `app_terminal_run` → 右栏自动切到终端并新建 `agent · <目录>` tab；「详情 · 正在执行」出现同一行，点它回到该 tab。
