/**
 * 会话模式：执行 / 计划 / 问答 / 目标。
 *
 * 边界对齐 Qoder CN 的 Plan / Goal 定位：
 * - **计划**：只读调研，产出一份可审阅的方案，确认后才动手（路径事先可知）；
 * - **目标**：给可验证终态，模型自寻路径、自驱迭代并自判完成度（路径事先不可穷举）；
 * - **问答**：只读，给结论不动手；
 * - **执行**：默认，直接改代码跑命令。
 *
 * 模式只改变「这一轮该怎么干」——通过系统提示追加约束，**不动审批档**：
 * 审批是用户显式的安全档位，两者正交（计划模式下仍受审批保护）。
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

const PLAN_GUIDANCE = `【计划模式】本轮只做只读调研：读文件、搜索、查看 git 历史与状态；**不修改文件、不执行命令** —— 产出仅是一份可审阅的计划，动手是下一轮的事。

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
- 结尾不要问「是否开始执行」，确认后客户端会提供「开始执行」按钮。`

const ASK_GUIDANCE = `【问答模式】以回答问题为目标：读文件、搜索代码、查看 git 历史与状态这类**只读**操作正常使用；不要写文件，不要执行会改变状态的命令。
回答直接给结论与依据（引用 \`路径:行号\`），不要顺手重构；确实要改代码或跑命令才能验证时，说明原因并请用户切到「执行」模式。`

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
    guidance: ''
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
    hint: '只读回答：可读文件，不改代码、不跑命令',
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

/** 当前 UI 主线程；目标后台续跑据此判断「这一轮归 UI 还是归后台」 */
function readAgentModeThread(): string | null {
  return readScopeThread()
}

function writeAgentMode(mode: AgentMode) {
  const pref = findPref('agent')
  const threadID = readScopeThread()
  if (!threadID) {
    // 还没有会话（首条消息发出前）：只改「下一个新会话」的默认值
    void patchPref('agent', { agentMode: mode })
    notifyScope()
    return
  }
  void patchPref('agent', {
    modeByThread: { ...pref.modeByThread, [threadID]: mode }
  })
  notifyScope()
}

/** 把当前模式约束拼到系统提示末尾；执行模式原样返回 */
function appendModeGuidance(prompt: string): string {
  const guidance = findAgentMode(readAgentMode()).guidance
  return guidance ? `${prompt}\n\n${guidance}` : prompt
}

export {
  AGENT_MODES,
  appendModeGuidance,
  findAgentMode,
  readAgentMode,
  readAgentModeThread,
  setAgentModeThread,
  subscribeAgentMode,
  writeAgentMode
}
export type { AgentModeMeta }
