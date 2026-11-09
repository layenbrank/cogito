# 任务（自动化任务域）：定义 / 触发 / 记录

> 2026-11 落地，后续补齐「状态可见 + 会话入栏 + 模式流水线」。
> **结论先行**：任务不是普通聊天会话。任务 = 一条可重复触发的自动化定义
> （指令 + 排期 + 执行方 + 工作目录 + 执行授权 + 模型/模式/轮次），每次触发产生一条执行记录，
> 并落库一条可回看的会话 `automation-<runId>`：有工作区的进对应工作区分组，没绑工作区的落「未分组」
> （侧栏不再单列「自动化」分组）。也可以把执行内容直接绑到一场已有对话（见「会话绑定」一节）。

入口：**右栏「任务」页签**（`views/agent/chat/components/aside-tasks.tsx`）—— 卡片列表 / 详情 / 全部记录 / 新建表单共用一块面板，
不跳页面、不再有 `/agent/tasks` 页面（老深链重定向到 `/agent/chat`）。纯逻辑与表单仍在 `views/agent/tasks/`
（`model.ts` / `task-form.tsx` / `task-runs.tsx` / `schedule-field.tsx`），面板只做组合与呈现。
后端用的是 automation 域（`automation` / `automation_run`）。

面板内四个视图（状态在 `PanelView` 里，返回不离开当前会话）：

| 视图 | 怎么进来 | 有什么 |
| --- | --- | --- |
| 列表 | 点右栏「任务」/ 从详情返回 | 按执行方分组的卡片：名称、状态徽标、人话排期、下次触发；卡上启停 / 立即执行 / 更多（编辑、查看记录、删除，删除走确认框） |
| 详情 | 点卡片 | 指令、计划（人话 + 原始 cron）、时区、下次 / 上次执行、执行授权、工作目录、关联知识库、执行方，下面接该任务的执行记录 |
| 全部记录 | 面板「更多」→ 全部执行记录 | 跨任务最近 50 条（`automation:runs` 不带 id，一趟 IPC） |
| 表单 | 「新建」/「编辑」 | 复用 `TaskForm`，窄栏单列；保存或取消回到列表（编辑时回到该任务详情） |

> 窄栏排版（内容区约 292px，最窄 232px）：卡片两行（名称 + 状态徽标 / 计划 + 下次触发）；
> 详情用「左标签 / 右值」的对齐行（`.meta`），八条字段竖排会吃掉一整屏、看记录还要先滚过去；
> 表单分「任务 / 时间 / 执行」三段，输入 / 下拉 / 时间统一 h-9，轻量选择用 26–28px 的分段控件。
> 表单底栏的校验红字**单独占一行**（塞在按钮左边，232px 下只剩半句话），且只有用户改过字段
> 才出现 —— 空白表单上一行红字太凶，保存按钮置灰已经说明了；
> 表单本身是 `@container`（`container: task-form / inline-size`），窄到 264px 以下自动收一档字号与
> 内边距，五格频率控件不会把「按分钟」顶到槽边。停用任务的卡片元信息只写计划（徽标已经写了「已停用」）。

## 任务 vs 会话

| 维度 | 任务（右栏「任务」面板） | 普通会话（工作区树） | 自动化会话（按工作区入树 / 未分组） |
| --- | --- | --- | --- |
| 存在形式 | 表里的一行（定义），关窗后仍在 | 会话档案 + 消息流 | 每次执行落库 `agent_session`，跑完保留 |
| 触发 | cron 排期 / 立即执行 | 用户发消息 | 由任务触发 |
| 上下文 | 定义可复用 | 长期累积 | 默认 id = `automation-<runId>` 与 run 回链；绑定「固定对话」时写进那场对话 |
| 产出 | `automation_run`（状态 / phase / 输出 / 错误） | 消息流 | 同左 + 可在主区回看流式过程 |
| 审批 | `readonly` / `auto`（无人值守，**没有 `ask`**） | `ask` / `auto` / `readonly` | 跟随任务授权；计划阶段强制只读 |
| 模式 | 单模式 agent/plan/goal，或「计划后执行」流水线 | composer 切换 | 按任务配置跑 |

`mod+n` / 侧栏「新建会话」/ 标题栏按钮都属于**会话**，命令 id 沿用历史名 `AGENT_NEW_TASK`
（`keyboard/definitions/ids.ts` 的注释写清了这一点），避免键位与测试断链。
任务面板的快捷键是另一条：`COMMAND.AGENT_OPEN_TASKS`（命令面板里搜「任务」「定时」「cron」都能命中），
同样走事件通道（`open-aside-tasks.ts`：`agent:open-aside-tasks` CustomEvent → `chat.tsx` 展开右栏、
`aside.tsx` 切到 tasks 页签）。**左栏不再有「任务」快捷入口**：侧栏只放会话，任务定义在右栏页签里配；
任务跑出来的会话按工作区落进树，不再单列一组。

## 三源同列：行为差异必须写在界面上

`automation.owner` 是字典 value（`DICT_KEY.AUTOMATION_OWNER`），三个来源共用一套列表，
但执行语义完全不同 —— 列表里每个分组都带一句 hint（`tasks/model.ts` 的 `OWNER_HINT`）。

| owner | 值 | 谁执行 | 客户端能做什么 |
| --- | --- | --- | --- |
| 本机 | `021` | `src-tauri/src/automation/worker.rs` 的 ticker（12s 一轮）→ 前端 runner | 全量：建/改/启停/立即执行/看记录 |
| goose | `022` | goose 侧排期（`automation/goose.rs` 镜像） | 建/改/启停；**没有本地记录**，立即执行只给一句 toast |
| 服务端 | `023` | 服务端 `JobR`（`apis/schedule.ts` + `features/automation/cloud.ts`） | 启停/删除；**不能手动触发**（服务端没有 run-now 路由），执行授权也在服务端 |

未登录或断网时：本机列表照常，服务端区域给「未登录」或错误原文（`stores/automation.ts` 的
`cloudStatus = 'off' | 'error'`），不白屏、不阻塞本机列表。

## 执行链路（本机）

```
worker tick(12s) → Service::toClaimDue（一次只认领 1 条，前端本来就是串行队列）
  → emit `automation:due`（DuePayload：含 mode / goalBudget / planThenGoal / planFilePath / 模型 /
                              sessionMode / sessionId）
  → features/automation/runner.ts::runDue
      → resolveSessionTarget      // 每次新建 / 固定对话 / 执行前选择（超时按新建）
      → requireWorkspace          // fail-closed：目录解析不到就判失败，绝不退回家目录（仅新建会话）
      → touchAutomationRun        // startedAt 补成真正开跑的时间（排队不算耗时）；长跑有心跳
      → ensureAutomationSession   // 仅新建会话：落库 agent_session(id=automation-<runId>)，通知侧栏 reload
      → patchAutomationRun(sessionId, phase)
      → 有 planFilePath：readPlanFile + buildPlanExecutePrompt（与右栏「按计划执行」同源），跳过 planThenGoal
      → 否则：单模式 / 流水线（plan → goal）：写 mode + approval，消息落 history，goal 复用 goal-run
      → ensureBackgroundTurn + follow（与普通聊天同源）：goose provider 用 `kind`（会话归属仍存本地 id）
      → 发 `stream` → UI `threads.reload` + switch，history.resume 接流式；目标多轮每轮都发
      → finishAutomationRun({ runId, output })      // 失败写 error
      → notifyAutomationRun(name, ok, error)        // 成功与失败都报
      → finally: clearApprovalModeFor + 释放 ACP 租约（会话与消息保留）
```

- **会话可见**：自动化会话按 `agent_session.workspaceID` 进工作区树（执行中置顶），没绑工作区的落「未分组」；
  绑定「固定对话」时不再新建会话，内容直接写进那场对话。任务记录可「打开会话」。
- **实时状态**：runner 生命周期事件 → `stores/automation.running/phases`；有任务在跑时 2.5s 轻量轮询列表与记录。
- **工作目录 fail-closed**：runner 开跑前校验 `toReadWorkspaceFolders()`；`auto` 档尤其不能落到家目录。
- **30 分钟没有回写** → `Service::toReapStale` 标失败；长跑每 5 分钟 heartbeat touch，降低误收尸。
- **启动首个 tick 延迟 5 秒**（`STARTUP_DELAY_SECS`）：前端要等 React 挂载才 `listen('automation:due')`。
- 同一次排期只跑一次：`(automationId, scheduledFor)` 唯一；错过的整点只补最后一次。
- 立即执行走**同一条** `runDue`，`triggerKind=manual`；非阻塞 + running 徽标 + phase 文案。

## 模型 / 模式 / 流水线（仅 owner=client）

| 字段 | 含义 | 默认 |
| --- | --- | --- |
| `providerId` + `modelId` | 固定供应商与模型；都空 = 跟随当前激活 | null |
| `mode` | 单模式：`agent` / `plan` / `goal` | `agent` |
| `goalBudget` | 目标轮次（3 / 6 / 12） | 6 |
| `planThenGoal` | 先 plan 出计划，再自动切 goal 按轮次执行（忽略单模式的执行语义） | false |
| `planFilePath` | 绑定工作区已有计划（相对路径，如 `.cogito/plans/foo.md`）；触发时按该文件执行 | null |

### 绑定计划（提前做计划 → 配置时选 → 到期执行）

1. 会话里用计划模式产出，保存到工作区 `.cogito/plans`（右栏「保存」不变）；
2. 本机任务表单在指定工作目录后，用 `listPlanFiles` 列出可选计划并绑定；
3. 到期 / 立即执行：`readPlanFile` → `buildBoundPlanPrompt`（内部 `buildPlanExecutePrompt`）→ 按 `mode` 跑 agent 或 goal。

规则（前后端一致：`Service::toSave` / `findDraftProblem` / Zod）：

- 有 `planFilePath` 时**必须**有 `workspaceId`；
- 有绑定时强制 `planThenGoal = false`（与现场「计划后执行」互斥），UI 隐藏该开关；
- 有绑定时禁止 `mode=plan`（目的是落地，不是再规划）；可选执行 / 目标；
- `prompt`：有绑定时可为空（执行依据是计划正文）；非空则前置为「附加说明」；
- 计划文件读失败（删了 / 路径错）→ run finish 失败，不静默跳过。

计划阶段强制只读审批；目标 / 执行阶段沿用任务的 `approval`。

## 会话绑定：每次新建 / 固定对话 / 执行前选择（2026-11-09）

| 列 | 语义 | 取值 |
| --- | --- | --- |
| `sessionMode` | 跑出来的内容写进哪个会话 | `new`（默认）/ `fixed` / `ask` |
| `sessionId` | `fixed` 时绑定到的 `agent_session.id` | 字符串 / NULL |

- `new`：每次执行落一条 `automation-<runId>` 会话，按任务的 `workspaceId` 进对应工作区分组；
  没绑工作区的落「未分组」。标题就是任务名，执行中置顶。
- `fixed`：复用选中的对话 —— 不建记录会话、不改标题，内容接着那场对话的上下文写。
  工作目录以**这个对话自己的工作区**为准，任务的「工作区 / 目录」只对新建会话生效（表单里写着）。
  绑定对话被删 → 本次执行失败并提示「任务绑定的对话已不存在，请到任务表单重新选择」，不静默改新建。
- `ask`：到点先弹「把这次执行写进哪个对话？」（`features/automation/session-picker.ts` 存状态，
  `views/agent/chat/components/automation-session-picker.tsx` 渲染；候选最多 30 条、按最近活动倒序、
  排除 `automation-*`）。关掉弹窗或 120s 无人应答都按**新建对话**处理 —— 定时任务不该因为没人点就
  一直悬着，也不能默认往用户正在聊的对话里塞内容。
- 只有 `owner=client` 能绑定会话：goose / 云端在客户端之外执行，客户端选的会话传不过去。表单对这两类
  锁住该字段并提示，`Service::toSave` / `findDraftProblem` / Zod 三处同样拒绝。
- 保存时只有 `fixed` 才存 `sessionId`：切回「每次新建」后旧 id 立刻清掉，避免下次改 owner 被误用。

## 时间定义：可视化排期，不让人手写 crontab

任务表单的时间定义是可操作的面板（`views/agent/tasks/schedule-field.tsx`），纯逻辑在
`features/automation/schedule-config.ts`：

| 面板 | 生成 | 说明 |
| --- | --- | --- |
| 每天 | `分 时 * * *` | 时/分双列选择器 |
| 每周 | `分 时 * * 1,3` / `分 时 * * 1-5` | 周一…周日多选，至少一天；「工作日 / 周末」一点即得，五天压成 `1-5`；cron 里 0 = 周日 |
| 每月 | `分 时 D * *` / `分 时 L * *` | 1–31，或「最后一天」（`L`）：1 月 31、2 月 28/29、4 月 30……天数由日历决定；选 29–31 号时提示小月会跳过 |
| 每小时 | `分 * * * *` | 只选「第几分」 |
| 按分钟 | `*/N * * * *` | 常用档 1/5/10/15/20/30 |
| 自定义 | 原样 | 给高级用户留的口子，5–7 段 |

- 打开已有任务时反向解析：认得的形状还原成面板（含 `1-5` 这种区间写法的周字段、`L` 这种最后一天），
  认不出来的（如 `0 9 * * MON`、`0 9 L 3 *`、带秒表达式）落到「自定义」原样显示，**不擅自改写**用户的老任务；
- 界面形态按「普通人的排期界面」排：频率是一条等宽分段控件（每天 / 每周 / 每月 / 每小时 / 按分钟），
  下面是同一列的表单控件（时间 / 日期 / 星期），底部摘要行给「每周一 09:00」+ 缩小的表达式 +「自定义」入口；
  **进自定义后分段控件仍常驻**，点任一格就回到可视化（否则只剩一段看不懂的表达式，退不回来）；
- 星期是 7 个等宽方块一行排开（不是两行 pill），「工作日 / 周末」作为标签行右侧的快捷动作；
  每月把「日期 / 时间」并成一行，避免两个控件各占一整行；
- 切换频率保留已选时间（每天 09:00 → 每周一 09:00），不会重置回 0 点；
- 面板下方始终回显一句人话 + 表达式（`describeSchedule`），并做基本合法性校验
  （段数 5–7、字符集）；不合法时 `findDraftProblem` 直接拦住保存；
- 仍**不在本地算下次触发时间**：准确时间以保存后 Rust 回填的 `nextRunAt` 为准。

### 「每月最后一天」用 `L`，本机引擎自己算

crontab 里 `L` = 当月最后一天，但 `cron` crate（0.17）**不认**这个字符：直接丢给它会在保存时报
「表达式不合法」。所以本机引擎在 `service.rs::next_last_day` 里先拦下来自己算 —— 往后找最多 24 个月，
按日历取当月天数（28/29/30/31）再拼上时/分；夏令时把某个小时整段跳过时往后挪一小时，而不是整月不跑。

- 只接受 5 段表达式（`分 时 L 月 周`）：带秒的写法没有可视化入口，报错比猜安全；
- 不允许同时限定星期（`0 9 L * 1`）：是「最后一天且周一」还是「最后一个周一」没有共识，直接拒绝；
- 月份字段可用 `*` 或 `3,6` 这类枚举，区间 / 步进留给「自定义」；
- 语义在别处不会被绕过：`toSave` / `toSetEnabled` / `toClaimDue` 都走同一个 `toNext`。

> goose / 服务端任务的排期由对方解析，客户端只做字符集校验；对方不认 `L` 时原因会落在
> `lastError` 里（保存失败会直接弹 toast），不会静默变成别的时刻。

### 下拉显示 label，不显示 value

Base UI 的 `Select.Value` 默认渲染裸 `value`；`value` 是 id / 枚举键时必须在 `Select.Root`
上给 `items`（`@cogito/design/components/select.tsx` 的注释里也写了这条），否则触发器会露出
`client`、UUID、`zh-CN` 这类内部值。任务表单（执行方 / 工作目录 / 知识库 / 时区）与仓库里
其它下拉都按这条改过；新增下拉时照抄 `items={OPTIONS}` + `SelectItem` 共用同一份数组。

## 执行配置：工作目录 + 执行授权

两列直接落在 `automation` 表（`crates/database/src/entity/automation.rs`）：

| 列 | 语义 | 取值 |
| --- | --- | --- |
| `workspaceId` | 在哪个工作区跑（`agent_workspace.id`）；空 = 家目录 | 字符串 / NULL |
| `workspacePath` | 工作区下**具体哪个目录**（文件夹绝对路径）；空 = 跟随工作区默认目录 | 字符串 / NULL |
| `approval` | 无人值守时的授权档 | `readonly`（默认）/ `auto` |

规则（前后端两处同一条，`Service::toSave` 与 `tasks/model.ts::findDraftProblem`）：

1. 任务里**没有 `ask`**：没人能回答审批弹窗，`Service::toSave` 直接拒绝未知档位；
2. `auto` **必须**带 `workspaceId` —— 自动批准等于无人值守的写权限，必须先圈定目录；
3. 只读档下需要审批的工具调用一律拒绝，输出尾巴写明「本轮有 N 次工具调用因无人审批被拒绝」；
   自动档同样计数「本轮自动批准了 N 次」，便于事后核对模型改了什么。

这两列**只对 `owner=client`（本机）生效**：goose 任务的排期与执行在 goose 侧（`automation/goose.rs` 只写
`title/description/instructions`），服务端任务在服务端 `JobR`。表单对这两种来源把工作目录与执行授权
一起锁住并写明「由谁决定」，避免配了以为生效；换成 goose/云端时这两项会重置为「家目录 + 只读」。
反过来，goose 任务被改成别的执行方时 `command.rs::sync` 会 best-effort 删掉 goose 侧那条排期
（按 `remoteId` 判断），否则两边都跑。

老库补列（单文件 0001 基线不改既有库，`CREATE TABLE IF NOT EXISTS` 对新库才生效）：

```sql
-- migrations/automation_schema.rs::column_patches()，由 migration::ensure_automation() 按 pragma_table_info 判缺后执行
ALTER TABLE automation ADD COLUMN "workspaceId" TEXT NULL;
ALTER TABLE automation ADD COLUMN "workspacePath" TEXT NULL;
ALTER TABLE automation ADD COLUMN "sessionMode" TEXT NOT NULL DEFAULT 'new';
ALTER TABLE automation ADD COLUMN "sessionId" TEXT NULL;
ALTER TABLE automation ADD COLUMN approval TEXT NOT NULL DEFAULT 'readonly';
ALTER TABLE automation ADD COLUMN "providerId" TEXT NULL;
ALTER TABLE automation ADD COLUMN "modelId" TEXT NULL;
ALTER TABLE automation ADD COLUMN mode TEXT NOT NULL DEFAULT 'agent';
ALTER TABLE automation ADD COLUMN "goalBudget" INTEGER NOT NULL DEFAULT 6;
ALTER TABLE automation ADD COLUMN "planThenGoal" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE automation ADD COLUMN "planFilePath" TEXT NULL;
ALTER TABLE automation_run ADD COLUMN "sessionId" TEXT NULL;
ALTER TABLE automation_run ADD COLUMN phase TEXT NULL;
```

`approval` 的默认值必须是 `readonly`：升级前的老任务就是「无人值守 + 只读」，
补列不能顺手放开写权限（`automation_schema.rs` 的单测盯着这一条）。
回归路径：`automation_columns_are_patched_on_old_db`（DROP 列 → `ensure_automation` → 断言补回且幂等）。

## 执行记录

`automation_run`：`scheduledFor` / `triggerKind`（`schedule` `manual` `catchup`）/ `status` /
`startedAt` / `finishedAt` / `output` / `error`。

- 任务详情内按时间倒序 + 状态筛选（全部 / 成功 / 失败 / 执行中）由纯函数
  `tasks/model.ts::filterRuns` 做，组件只渲染；
- 面板级「全部记录」跨任务聚合：`automation:runs` 的 `automationId` 可省略
  （`Service::toListRuns(None)` 返回最近 N 条），避免 N 次 IPC；
- 删除任务走 `Service::toRemove` 的级联，记录跟着消失。

## 与另外两套「长任务」的边界

| 名字 | 位置 | 是什么 | 为什么不并入 |
| --- | --- | --- | --- |
| 任务（右栏面板） | `views/agent/chat/components/aside-tasks.tsx` | 定时/手动触发的自动化定义 | — |
| Goal 推进 | `features/agent/goal-run.ts` | **会话内**按目标自动续跑，直到 `GOAL_DONE` | 依附某个会话的上下文，产物是消息流 |
| 服务端委派 | `apis/agent-task.ts` + `delegate-surface.tsx` | 把一次长任务交给服务端跑并渲染进度 | 是「这一轮怎么跑完」的执行策略，不是可复用定义 |

一句话：**任务**关心「什么时候跑、跑什么、跑成什么样」，Goal / 委派关心「这一次怎么跑完」。

## 回归检查

- `pnpm --filter @cogito/client type-check`
- `pnpm --filter @cogito/client lint`
- `pnpm --filter @cogito/client exec vitest run src/views/agent/tasks/model.test.ts src/views/agent/tasks/schedule-field.test.tsx src/views/agent/chat/components/aside-tasks.test.tsx src/features/automation/run-plan.test.ts src/features/automation/describe-schedule.test.ts src/features/automation/schedule-config.test.ts`
- 排期语义回归：`cargo test -p cogito-core automation`（含 `last_day_of_month_follows_the_calendar` 与
  `last_day_rejects_shapes_it_cannot_honour`）
- `cd apps/client/src-tauri && cargo test -p cogito-database -p cogito-core`
- 手工最小闭环：右栏「任务」页签 → 新建 `*/1 * * * *` 本机任务（工作目录 = 仓库、授权 = 自动批准、指令写 `report.txt`）
  → ≤12s 触发 → 记录「准点 + 成功」→ 文件真的生成 → 有系统通知 → 输出里**没有**「N 次被拒绝」。
- 面板交互：新建后回到列表并出现新卡片 → 点卡片进详情 → 详情内「编辑 / 查看记录 / 删除」可用 →
  刷新后卡片仍在；老深链 `/agent/tasks` 落到 `/agent/chat`（不 404）。
