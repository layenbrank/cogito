/**
 * 「按计划执行」的提示词构造：**只发计划正文全文**。
 *
 * 为什么不再发清单：`findPlanDraft().steps` 是从正文里抽出来的摘要（一条只剩一行），
 * 模型拿到一份「干净的 TODO 列表」就会按条目做象征性实现 —— 计划里写明的文件、
 * 契约、命令、验证全部被跳过。清单只适合给人看进度，不适合当执行依据。
 *
 * 两条硬约束（2026-11 计划模式复盘）：
 * 1. 阶段顺序：一个阶段没做完不要开始下一个；
 * 2. 计划里点名的文件与验证步骤必须真落地，不留占位。
 */

interface PlanExecuteInput {
  /** 计划正文全文（`findPlanDraft().body`）；为空时退回 `overview` */
  body: string
  /** 执行方式：普通执行 / 目标推进（自动续跑） */
  target: 'agent' | 'goal'
  /** 目标推进的轮次上限 */
  budget?: number
  /** 一句话总结，正文缺失时作为退化输入 */
  overview?: string
}

const BODY_START = '===== 计划全文 ====='
const BODY_END = '===== 计划全文结束 ====='

const EXECUTE_RULES = [
  '执行要求：',
  '1. 严格按计划的阶段顺序推进：一个阶段没做完，不要开始下一个；',
  '2. 计划里点名的每个文件、命令、接口和契约都要真正落地，不要留占位、不要只做示例；',
  '3. 计划里写了「验证」的，全部阶段完成后逐条跑一遍并汇报结果；',
  '4. 「待确认」项按计划里的默认选择执行，不要停下来反问。'
]

function buildPlanExecutePrompt(input: PlanExecuteInput): string {
  const lines: string[] = ['按下面的计划开始执行。']

  if (input.target === 'goal') {
    lines.push(`以目标模式推进，最多 ${input.budget ?? 0} 轮，中途不要停下来问用户。`)
    lines.push('约束以我前面消息里说的为准（不要/保持/只能/不能 这类），开工前先复述一遍。')
  }

  lines.push(...EXECUTE_RULES)

  const body = input.body.trim() || input.overview?.trim() || ''
  if (body) {
    lines.push('', BODY_START, body, BODY_END)
  }

  return lines.join('\n')
}

export { buildPlanExecutePrompt, BODY_END, BODY_START, EXECUTE_RULES }
export type { PlanExecuteInput }
