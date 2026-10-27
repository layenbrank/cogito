/**
 * 一次性内联提示：给编辑器里的「续写 / 改写 / 总结」用。
 *
 * 不复用聊天会话 —— 每次起一个独立 ACP session，跑完就关。内联改写不需要历史，
 * 复用会把草稿混进用户的对话上下文；关闭走 `closeThreadSession`，否则会话表会一直长。
 *
 * 内联**不挂工具**（system 提示里明说）：一轮里若触发审批，这里没有审批 UI，
 * 只能等票据超时，用户看到的就是「卡住」。
 */
import { closeThreadSession, runThreadPrompt } from '@/features/agent/acp/session'
import { parseAcpStreamEvent } from '@/features/agent/acp/stream'
import { prepareTarget } from '@/features/agent/acp/target-guard'
import { createModelPort } from '@/features/agent/port/model'

/** 内联会话的 thread 前缀：这些 id 不会出现在会话列表里，仅用于区分日志 */
const INLINE_THREAD_PREFIX = 'inline-'

interface InlinePromptInput {
  /** 本轮用户消息（指令 + 待处理文本） */
  text: string
  /** 覆盖默认 system 提示（默认那份已包含「只输出正文、不要调用工具」） */
  systemText?: string
  signal?: AbortSignal
}

const INLINE_SYSTEM_PROMPT = `你是 Markdown 写作助手，正在协助用户编辑一篇笔记。
只输出可以直接放进正文的 Markdown：不要解释、不要加代码围栏、不要重复用户已写的内容。
不要调用任何工具，也不要向用户提问。`

/** 一条用于收集文本块的归组器：内联只关心正文，不需要区分段落 */
function createTextBlockID(): (messageId: string | null | undefined, kind: string) => string {
  return function (messageId, kind) {
    return `${kind}:${messageId ?? 'run'}`
  }
}

async function prepareProvider(providerID: string, modelID: string): Promise<void> {
  return prepareTarget(providerID, modelID, 'agent.inline')
}

/**
 * 跑一轮内联提示，返回拼好的正文。
 *
 * 抛错语义：没配模型 / 被配额拦住 / 模型没给内容 —— 调用方直接把 message 显示给用户。
 */
async function runInlinePrompt(input: InlinePromptInput): Promise<string> {
  const text = input.text.trim()
  if (!text) return ''

  const target = await createModelPort().findTarget()
  if (!target) throw new Error('还没有可用的模型，请先到设置里选择供应商与模型')
  await prepareProvider(target.providerID, target.model)

  const threadID = `${INLINE_THREAD_PREFIX}${crypto.randomUUID()}`
  const blockID = createTextBlockID()
  let content = ''
  try {
    for await (const item of runThreadPrompt(threadID, {
      text,
      systemText: input.systemText?.trim() || INLINE_SYSTEM_PROMPT,
      providerID: target.providerID,
      modelID: target.model,
      signal: input.signal
    })) {
      if (item.kind !== 'update') continue
      const event = parseAcpStreamEvent(item.update, { blockID })
      if (event?.kind === 'text') content += event.text
    }
  } finally {
    closeThreadSession(threadID)
  }

  const trimmed = content.trim()
  if (!trimmed) throw new Error('模型没有返回内容，可以再试一次')
  return trimmed
}

export { INLINE_SYSTEM_PROMPT, runInlinePrompt }
export type { InlinePromptInput }
