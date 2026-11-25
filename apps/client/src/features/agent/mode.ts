/**
 * 会话模式：执行 / 计划 / 问答 / 目标。
 *
 * 边界对齐 Qoder CN 的 Plan / Goal 定位：
 * - **计划**：只读调研，产出一份可审阅的方案，确认后才动手（路径事先可知）；
 * - **目标**：给可验证终态，模型自寻路径、自驱迭代并自判完成度（路径事先不可穷举）；
 * - **问答**：只读工具，给结论，不改文件；
 * - **执行**：默认，直接改代码跑命令。
 *
 * 模式与审批偏好正交（UI 上仍可独立选 ask/auto/readonly），但有两条例外：
 * - **问答 / 计划**的能力面是只读：可以读文件和搜索，写工具直接拒。
 *   发给 goose 的是 `approve`（每个工具先到我们这儿），不是已删除的 `chat`，也不是 `auto`。
 *   动手只走右栏「开始执行」，不靠用户消息里的「继续」猜。
 * 目标模式启停会强制/恢复自动审批并完整 sync goose。
 *
 * Goal 终态：`done`（GOAL_DONE）/ `exhausted`（预算用尽）/ `paused`（用户或插话）
 * 三者互不覆盖；见 `finishGoalRun`。
 */
import {
  notifyScope,
  readScopeThread,
  subscribeScope,
  writeScopeThread
} from '@/features/agent/thread-scope'
import { findPref, patchPref } from '@/features/persist'
import type { AgentMode } from '@/features/persist'

interface AgentModeMeta {
  value: AgentMode
  label: string
  hint: string
  /** lucide 图标名（composer 选择器 / 详情页徽标） */
  icon: string
  /** 追加到系统提示末尾的约束；执行模式为空串 */
  guidance: string
}

const PLAN_GUIDANCE = `【计划模式】本轮做只读调研：读文件、搜索、查 git 历史与状态。
**可以跑只读命令**（git status / git diff / git log / ls / cat / 搜索类）；**不修改文件、不跑会改状态的命令**（安装、构建、写删文件、迁移）—— 产出仅是一份可审阅的计划，动手是下一轮的事。
命令会在审批卡上等你放行：被拒就换一种不依赖它的方式取证，不要因为被拒就停笔。

用户需求里给了验收标准就原样落到「验证」章节；没给就自己定可判定的标准。

按这个骨架写一份完整的 Markdown 计划：

# <计划标题>
## 概述
一段话说清目标、选定做法、影响面 —— 它会被当成这份计划的摘要。
## 现状与问题
关键文件与当前行为（引用 \`路径:行号\`）、为什么不行。
## 方案
选定做法与取舍；有多方案对比或跨多处改动时用表格。
## 实施步骤
1. <改哪个文件、做什么、如何验证>
2. …
## 风险与待确认
## 验证
可判定的验收标准：跑什么命令、断言什么结果。

约束：
- **实施步骤 3–8 条**，每条要足够小 —— 能在一个较小的 diff 内看清影响范围；
- 其余章节是详细说明，写完整，不要省略、不要折叠成一句；
- **本轮必须把上面的骨架写完再停**。不要只输出标题或概述就结束；不要用计划/待办工具代替正文；
- 读文件被拒或写工具被拒都是预期（这一轮本来就不能改文件）：换只读工具继续调研，然后把计划写完，不要因此结束本轮；
- 结尾不要问「是否开始执行」。要改代码时，用户点右栏「开始执行」，不要把一句「继续」当成开工。`

const ASK_GUIDANCE = `【问答模式】可以读文件、搜索代码、查看 git 状态。不要写文件，不要执行会改状态的命令；写工具会被拒绝，拒绝后用只读结果把答案写完，不要因此结束本轮。
回答直接给结论与依据（引用 \`路径:行号\`）。确实要改代码时，请用户切到「执行」或在计划页点「开始执行」。`

const AGENT_GUIDANCE = `【执行模式】直接完成用户的请求：可以读、可以改、可以跑命令。
需要先列步骤时，把步骤写进回复并**立刻开始做**。不要只输出一份计划就结束本轮，也不要因为调用了计划或待办工具就停下来等用户。`

/**
 * 对应 Qoder CN 的 Goal 驱动：只给**期望终态**，路径由模型在循环里自主逼近。
 * 与计划模式的分界：能事先把路径穷举清楚的任务走规划，穷举不清的（覆盖率、
 * 大规模重构、批量替换）走目标。
 *
 * 这里多了一条 Qoder 靠 `max turns` 实现的能力 —— **不打断**：用户可能不在电脑旁，
 * 中途停下来问问题等于把时间全浪费在等待上。需要拍板的地方自己决定并记账，
 * 收尾时统一交代。
 */
const GOAL_GUIDANCE = `【目标模式】围绕一个**可验证的终态**持续推进，可以写文件、跑命令。
适用于路径无法事先穷举的任务（提升覆盖率、大规模重构、性能调优、批量替换）；能提前规划清楚的任务应当用「计划」模式。

开工先把终态拆成 3–6 条**可判定**的验收标准（例：\`pnpm unit\` 全绿 / 覆盖率 ≥ 80% / 公开 API 不变），
写进回复并在后续轮次里保持不变 —— 它们是「做完了没有」的唯一依据。

之后进入循环：做一批 → 跑验证 → 对照标准逐条自评（达成 / 未达成 + 证据）→ 补齐未达成项 → 再验证。

**每轮结束都要汇报进度**（用户可能随时回来查看），固定两行：
- 本轮做了什么：改动的文件 / 跑过的命令，一句话一条；
- 验收标准达成 n/m：逐条 ✓ 或 ✗，附证据（命令与输出摘要）。

当轮有影响后续的自主决定时，补第三行「自主决定：<一句话>（明细见收尾清单）」，
让用户中途回来也能看到你替他拿了什么主意。

**约束由用户发送的内容判定**：他前面说过的「不要改 X」「保持 Y 不变」「只动 Z 目录」「不能破坏 W」
都是**硬约束**，任何一轮都不得违反；计划正文里的「风险与待确认」也按约束读。
开工前先把这些约束逐条复述一遍（没有就写「无」），再动手。

**本轮不要停下来等用户确认**（用户可能不在电脑旁）：
- 需要拍板的岔路自己选一个合理方案，并记进「自行决定」清单；
- 缺依赖、缺配置、测试策略这类也自己定，不要发问；
- 只有不可逆的破坏性操作（删除数据、强推远端、改生产配置）才允许中止本轮等待。

**收尾那一轮**（全部标准达成，或推进轮次用尽）在上面两行之外，再补这份总结：
## 改动
按文件列出改了什么（一句话一个文件）。
## 验收结果
逐条标准 ✓/✗ + 证据（跑过的命令与输出摘要）。
## 我自行决定的问题
用户不在场，这些是他回来后要复核的判断。每条按下面格式写全，**必须列出被否掉的候选方案**：
- 问题：当时卡在哪里
- 候选方案：A / B / C，每个一句话说清取舍
- 我的选择：选了哪个
- 理由：为什么选它、为什么排除其他的
- 影响面：波及哪些文件或行为；用户不认可时怎么改回来
没有就写「无」。
## 仍未完成 / 建议
未达成项与卡点原因；每条附后续选项（A / B / C），标明你推荐哪个及理由 ——
用户回来能直接拍板，不用重新调研一遍。

最后**单独一行**输出收尾标记（客户端据此判断是否继续推进）：
\`GOAL_DONE\` —— 全部标准达成；
\`GOAL_CONTINUE\` —— 还有未达成项，需要继续下一轮。`

/**
 * 模式总表：**键顺序即展示顺序**（执行 → 计划 → 问答 → 目标）。
 * 新增模式只改这里 —— 派生列表与查找会自动跟上，不会出现“表里加了、菜单里忘了”。
 */
const MODE_META: Record<AgentMode, AgentModeMeta> = {
  agent: {
    value: 'agent',
    label: '执行',
    hint: '默认：直接改代码、跑命令',
    icon: 'lucide:zap',
    guidance: AGENT_GUIDANCE
  },
  plan: {
    value: 'plan',
    label: '计划',
    hint: '先出可审阅的方案，确认后再动手',
    icon: 'lucide:list-todo',
    guidance: PLAN_GUIDANCE
  },
  ask: {
    value: 'ask',
    label: '问答',
    hint: '只读回答：可读文件，不改代码、不跑会改状态的命令',
    icon: 'lucide:message-circle-question',
    guidance: ASK_GUIDANCE
  },
  goal: {
    value: 'goal',
    label: '目标',
    hint: '给可验证的终态（如覆盖率 80%），循环逼近直到达成',
    icon: 'lucide:target',
    guidance: GOAL_GUIDANCE
  }
}

/** 展示顺序由 `MODE_META` 的键顺序决定，不另外维护一份数组 */
const AGENT_MODES: readonly AgentModeMeta[] = Object.values(MODE_META)

/**
 * 外部值（旧偏好 / 手改过的配置文件）→ 合法模式。
 *
 * 用 `MODE_META` 本身当映射表：新增模式只动那张表，这里不用再补分支。
 * 先用 `Object.hasOwn` 收窄类型，避免 `value as AgentMode` 这种断言 —— 断言会把
 * 「运行时不存在的键」变成 `undefined` 却不报错。
 */
function isAgentMode(value: string | undefined): value is AgentMode {
  return Object.hasOwn(MODE_META, value ?? '')
}

function findAgentMode(value: string | undefined): AgentModeMeta {
  return isAgentMode(value) ? MODE_META[value] : MODE_META.agent
}

/**
 * 当前活跃会话。模式是**会话级**的：切会话时由 runtime 同步过来，
 * 读写都作用在它上面；没有会话（新对话）时回落到默认值。
 *
 * 这份「活跃会话」信号与审批档共用（见 `thread-scope.ts`）—— 两者都必须
 * 跟着会话切换刷新 UI。
 */
function setAgentModeThread(threadID: string | null) {
  writeScopeThread(threadID)
}

/** 供 `useSyncExternalStore` 订阅：模式切换 / 切会话后 composer 与详情页同时刷新 */
function subscribeAgentMode(listener: () => void): () => void {
  return subscribeScope(listener)
}

function readAgentMode(): AgentMode {
  const pref = findPref('agent')
  const threadID = readScopeThread()
  if (threadID) {
    // 会话级：有记录用记录，没记录用**新会话默认值**（即重置，不沿用上次）
    return pref.modeByThread[threadID] ?? pref.agentMode
  }
  return pref.agentMode
}

/** 按指定会话读模式（计划硬只读 / goose 有效审批档用） */
function readAgentModeFor(threadID: string): AgentMode {
  const pref = findPref('agent')
  const id = threadID.trim()
  if (!id) return pref.agentMode
  return pref.modeByThread[id] ?? pref.agentMode
}

/**
 * 当前 UI 主线程；目标后台续跑据此判断「这一轮归 UI 还是归后台」 */
function readAgentModeThread(): string | null {
  return readScopeThread()
}

/**
 * 写入队列：连点两次时，**后点的必须后落盘**。
 *
 * 以前两次 `patchPref` 并发：谁先回来谁算数 —— 界面显示第二次的档位，库里留的
 * 却是第一次的，重启后又变回去。串行化后，每次写入在轮到自己时才读偏好，
 * 能看见前一次的结果。
 */
let modeWriteQueue: Promise<void> = Promise.resolve()

function enqueueModeWrite(task: () => Promise<void>): Promise<void> {
  const next = modeWriteQueue.then(task, task)
  // 前一次失败不该堵住后面的写入
  modeWriteQueue = next.catch(function () {
    return undefined
  })
  return next
}

/** 把「有效审批档」推给 goose（计划模式只读 / 离开计划回到用户偏好），不落偏好 */
async function pushEffectiveApproval(threadID: string): Promise<void> {
  try {
    const mod = await import('@/features/agent/acp/sync-thread-approval')
    await mod.syncApprovalForThread(threadID)
  } catch (error) {
    console.warn('[agent/mode] 同步有效审批档到 goose 失败:', error)
  }
}

async function writeAgentModeNow(threadID: string | null, mode: AgentMode): Promise<void> {
  const pref = findPref('agent')
  if (!threadID) {
    // 还没有会话（首条消息发出前）：只改「下一个新会话」的默认值
    await patchPref('agent', { agentMode: mode })
    notifyScope()
    return
  }
  await patchPref('agent', {
    modeByThread: { ...pref.modeByThread, [threadID]: mode }
  })
  notifyScope()
}

/**
 * 写完之后再推 goose。**不 await**：那条链路要 ACP 连接，卡住不该连带把
 * 「切模式」本身卡住（切完模式界面立刻要变，推给 goose 是下一轮的事）。
 */
function afterModeWrite(threadID: string | null, written: Promise<void>): Promise<void> {
  return written.then(function () {
    if (threadID) void pushEffectiveApproval(threadID)
  })
}

async function writeAgentMode(mode: AgentMode): Promise<void> {
  const threadID = readScopeThread()
  const written = enqueueModeWrite(function () {
    return writeAgentModeNow(threadID, mode)
  })
  return afterModeWrite(threadID, written)
}

/**
 * 按会话写模式（目标收尾 / 崩溃自愈要还原「启动前那一档」，不能改别的会话）。
 *
 * 与 `writeAgentMode` 的区别只在定位方式：那个写**当前活跃会话**，这个按 id 写。
 */
async function writeAgentModeFor(threadID: string, mode: AgentMode): Promise<void> {
  const id = threadID.trim()
  const written = enqueueModeWrite(function () {
    return writeAgentModeNow(id || null, mode)
  })
  return afterModeWrite(id || null, written)
}

/**
 * 写模式并等 goose 档位同步完。
 *
 * 普通切换不走这里：推 goose 要 ACP，卡住不该拖住菜单。
 * 「计划 → 执行」必须等它：否则这一轮的 run 仍按只读档发出去，模型一碰写工具就被拒，计划执行直接停。
 */
async function commitThreadMode(threadID: string, mode: AgentMode): Promise<void> {
  const id = threadID.trim()
  await writeAgentModeFor(id, mode)
  if (id) await pushEffectiveApproval(id)
}

/** 消息上的模式快照键（落 `metadata.custom`，随消息 JSON 一起进 `agent_message.content`） */
const MODE_SNAPSHOT_KEY = 'modeSnapshot'

/**
 * 一条用户消息「发送那一刻」的模式快照。
 *
 * 为什么要按消息存：模式本来是**会话级偏好**，`appendModeGuidance` 读的是「现在」
 * 的模式。用户在目标轮次被意外停止后切回执行、再点重新生成，发出去的提示就变成
 * 执行模式 —— 现象就是「重新生成后模式自己变了」。快照跟着消息走，重新生成自然
 * 复现当初那一次。
 *
 * `approval` / `goalBudget` 是**保留位**：链路已经能带（一列兼容四种快照），等审批档
 * 与预算各自有稳定读取口径时再填，不在这一轮跨模块拿状态。
 */
// 用 type 而非 interface：快照要能原样塞进 assistant-ui 的 `metadata.custom`
// （`ReadonlyJSONObject` 只对 type alias 提供隐式索引签名，interface 会被判成不可赋值）
type ModeSnapshot = {
  mode: AgentMode
  approval?: string
  goalBudget?: number
  /** 落盘时间，排查「这条消息是什么时候发的」 */
  at?: number
}

function isModeSnapshot(value: unknown): value is ModeSnapshot {
  if (!value || typeof value !== 'object') return false
  const mode = (value as { mode?: unknown }).mode
  return typeof mode === 'string' && isAgentMode(mode)
}

/** 从消息元数据里取快照；形状不对 / 老数据 → null */
function readModeSnapshot(
  metadata: Readonly<Record<string, unknown>> | undefined
): ModeSnapshot | null {
  const raw = metadata?.[MODE_SNAPSHOT_KEY]
  return isModeSnapshot(raw) ? raw : null
}

/** 当前模式 → 快照（发送时写进用户消息） */
function buildModeSnapshot(): ModeSnapshot {
  return { mode: readAgentMode(), at: Date.now() }
}

/** 这条消息该用哪个模式：**快照优先**，老数据（无快照）回落会话偏好 */
function resolveModeFor(metadata: Readonly<Record<string, unknown>> | undefined): AgentMode {
  return readModeSnapshot(metadata)?.mode ?? readAgentMode()
}

/**
 * 一轮消息里「最后一条带快照的用户消息」的快照。
 *
 * 重新生成用的是同一份历史，所以拿到的是那条消息当初的模式，而不是现在的模式。
 */
function findModeSnapshot(
  messages: readonly { role: string; metadata?: Readonly<Record<string, unknown>> }[]
): ModeSnapshot | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    const snapshot = readModeSnapshot(message.metadata)
    if (snapshot) return snapshot
  }
  return null
}

/**
 * 给消息的 `metadata.custom` 打上**当前**模式快照（保留其它扩展位：用量、后台回合来源）。
 *
 * 已有快照就原样返回 —— 历史重放、重新生成都不该改写「当初那一次」。
 */
function stampModeSnapshot(
  custom: Readonly<Record<string, unknown>> | undefined
): Record<string, unknown> {
  if (readModeSnapshot(custom)) return { ...(custom ?? {}) }
  return { ...(custom ?? {}), [MODE_SNAPSHOT_KEY]: buildModeSnapshot() }
}

/**
 * 本轮该用哪个模式：**消息快照优先**，取不到才回落当前会话偏好。
 *
 * 发送与重新生成都走这里；差别只在消息里有没有快照 —— 老数据没有，仍然按会话偏好跑。
 */
function resolveRunMode(
  messages: readonly { role: string; metadata?: Readonly<Record<string, unknown>> }[]
): AgentMode {
  return findModeSnapshot(messages)?.mode ?? readAgentMode()
}

/**
 * 把模式约束拼到系统提示末尾。四种模式都有约束（执行模式要求不要只出计划就停）。
 *
 * `mode` 显式传入时以它为准（发送 / 重新生成都从消息快照算出来再传进来），
 * 不传才读当前会话偏好 —— 这条默认值是给「没有历史消息」的场景用的。
 */
function appendModeGuidance(prompt: string, mode: AgentMode = readAgentMode()): string {
  const guidance = findAgentMode(mode).guidance
  return guidance ? `${prompt}\n\n${guidance}` : prompt
}

export {
  AGENT_MODES,
  MODE_SNAPSHOT_KEY,
  appendModeGuidance,
  buildModeSnapshot,
  commitThreadMode,
  findAgentMode,
  findModeSnapshot,
  readAgentMode,
  readAgentModeFor,
  readAgentModeThread,
  readModeSnapshot,
  resolveModeFor,
  resolveRunMode,
  setAgentModeThread,
  stampModeSnapshot,
  subscribeAgentMode,
  writeAgentMode,
  writeAgentModeFor
}
export type { AgentModeMeta, ModeSnapshot }
