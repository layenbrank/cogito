# 计划模式：正文是唯一执行依据

> 2026-11 复盘。**结论先行**：计划里不要再有「清单」，执行时也只发正文。

## 问题

计划模式的执行链路原来是：

1. 模型在 plan 模式下用 Markdown 写出计划（正文里是分阶段方案、要改的文件、命令、验证表）；
2. `findPlanDraft()` 从正文里**抽出**一份「实施步骤」清单（每条被 `cleanInline` 压成一行）；
3. 点「开始执行」时，`aside.tsx` 把这份**清单**拼进用户消息发给模型。

结果：模型拿到的是一份干净的 TODO 列表，看不到每一步要改哪个文件、契约是什么、
怎么验证——于是只做了「象征性实现」，大量细节缺失。保存成的
`.cogito/plans/*.md` 里 frontmatter 也带着 `todos:` 清单，同样会被当成「任务全集」读取。

## 约定

| 规则 | 落点 |
| --- | --- |
| **计划正文是唯一执行依据**，执行消息里原样带全文（`===== 计划全文 =====` 包起来） | `features/agent/plan-execute.ts` 的 `buildPlanExecutePrompt`（单测 `plan-execute.test.ts`） |
| 清单**不再落盘**：`buildPlanMarkdown` 只写 `name` / `overview`，正文全量保留 | `features/agent/plan-file.ts`（单测 `plan-file.test.ts` 断言无 `todos:`） |
| 清单**只用于 UI 展示进度**（计划页签、`Plan` 元素），不进模型上下文 | `features/agent/plan-draft.ts` 的 `steps` 仅供 `aside-plan.tsx` / `aside-busy.tsx` 渲染 |
| 右栏「计划」页签以**正文**为主：抬头只给标题 / 概述 / 步数，正文全量 Markdown；「详情」只给标题 + 概述 + 前 3 步 + 「查看完整计划」 | `aside-plan.tsx`、`aside-busy.tsx` 的 `PlanDraftBlock` |
| 没有编号列表时，**计划类标题下的普通项目符号**也算步骤；没有计划类标题则只认编号 / 勾选框，避免任何带列表的回复都被当成计划 | `plan-draft.ts` 的 `BULLET_LINE` + `findStepList`（单测 `plan-draft.test.ts`） |
| 执行消息固定四条硬约束：阶段顺序、文件级落地、跑验证、待确认项按默认执行 | `plan-execute.ts` 的 `EXECUTE_RULES` |
| **计划模式硬只读**：写工具在权限回调直接拒绝；goose 有效档为 readonly（不改用户审批偏好） | `acp/session.ts` `requestThreadPermission`；`effective-approval.ts`；切模式时 `syncApprovalForThread` |
| **执行收尾写 status**：普通执行一轮结束 → `done` / 中止 → `interrupted`；经 Goal 推进则跟 Goal 终态 | `views/agent/chat/components/plan-run-finish.tsx` |

## 计划版本化：revision / executedRevision

「用户没看清就执行了上一份计划」的根因是档案只记 `revision`，不记**跑的是哪一版**。
四个字段分工（`features/agent/plan-store.ts`）：

| 字段                      | 含义                                                          | 写入点                                                             |
| ------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `revision`                | 正文版本号                                                    | `bumpRevision`（`plan-recorder` / `plan-file-sync` 发现 digest 变化） |
| `executedRevision`        | **上一次开始执行**用的是第几版；`bumpRevision` 不清它          | `setPlanStatus(..., 'running')`                                     |
| `stale`（派生）           | `revision > executedRevision` = 计划改过、上次跑的是旧版        | `isPlanStale(record)`                                               |
| `superseded`              | 旧计划被新版取代，只读                                         | `bumpRevision`：`done` / `interrupted` → `superseded` + `supersededBy` |

四条行为约定：

1. `bumpRevision` 时 `running → draft`，`done` / `interrupted → superseded`
   —— 不再「保持 done、只在徽标上标已过期」，否则右栏按钮还叫「开始执行」，点下去跑的是旧版；
2. 右栏 stale 时按钮文案变「按新计划执行（rN）」，抬头多一行「上次执行基于 rK」；
   `superseded` 且没有更新版本可执行时禁用执行（保存 / 复制 / 载入仍可用）；
3. 对话里的历史计划卡被新版本取代后打「已被 rN 取代」角标（`plan-data-ui.tsx`），
   避免用户以为对话里最后一张卡就是最新计划；
4. 目标推进每轮续跑前比对 `revision === executedRevision`，不等就 `stopGoalRun`（`paused`）
   并提示「不会拿旧版继续跑」—— 这条是「计划重复执行、白烧 token」的直接闸门。

执行消息固定带 `计划版本：revision N`（`buildPlanExecutePrompt`），事后能对上「这一轮跑的是第几版」；
`aside.tsx::startImplement` 现读 `readPlan(threadID)` 取 `body` 与 `revision`，不用当轮草稿。

判据放宽：`isPlanDocument` 允许「`## 方案` / `## 实施步骤` / `## 验证` 任一 + 正文 ≥ 200 字」也算改版，
避免「调整计划那一轮没被录进档案，右栏与执行入口继续拿旧版」。

回归：`pnpm --filter @cogito/client exec vitest run src/features/agent/plan-store.test.ts src/features/agent/plan-execute.test.ts`
（覆盖 `done → superseded` + `supersededBy`、`executedRevision` 不被 `bumpRevision` 清、`isPlanStale` 派生、prompt 带 revision）。

## Goal 终态（对照）

| 状态 | 含义 | 写入点 |
| --- | --- | --- |
| `done` | 模型输出 `GOAL_DONE` | `finishGoalRun(..., 'done')` |
| `exhausted` | 预算用尽 | `advanceGoalRun`（禁止再被 `stopGoalRun` 抹成 paused） |
| `paused` | 用户停止 / 插话 / 未打标记收敛 | `stopGoalRun` / `finishGoalRun(..., 'paused')` |

`expectedPrompt` 落库；paused / exhausted 可在输入区点「继续」重置轮次再推。

## 为什么要「阶段顺序」这一条

计划里的阶段通常有依赖（先补后端读路径，再改前端）。旧提示词只说「逐条推进」，
模型会并行挑容易的条目做，于是出现「后端命令注册了但前端出口没接」这类半成品。
现在明确写：**一个阶段没做完，不要开始下一个**，并要求全部阶段完成后按「验证」
一节逐条自查。

## 回归检查

- `pnpm --filter @cogito/client exec vitest run src/features/agent/plan-execute.test.ts src/features/agent/plan-file.test.ts src/features/agent/goal-run.test.ts src/features/agent/effective-approval.test.ts`
- 手工：plan 模式产出一份计划 → 点「开始执行」→ 输入框里应是**整份正文**（含表格与代码块），
  且没有额外拼出来的编号清单。
- 手工：计划模式下模型若申请写文件，应被拒绝；执行跑完后右栏 status 不再卡在「执行中」。
- 手工：Goal 打出 `GOAL_DONE` 显示「已完成」；用尽显示「已用尽」；暂停后可点「继续」。
