/**
 * 跨页面的「待发送上下文」交接。
 *
 * 右键菜单在 **service worker** 里触发，而输入框在**新打开的对话页**里。
 * 两者不共享内存，所以只能落一次存储再取走：写 → 开标签页 → 页面挂载时 take（取完即删）。
 *
 * 不直接用 URL 传：选区可能几千字，URL 长度会被截断；而且地址栏里带着正文也不好。
 */

import { STORAGE_KEYS, findValue, removeValue, writeValue } from '@/features/platform/storage.ts'

/** 交接内容的存活上限：这只是「刚点完右键」的一次性传递，放久了只会让人困惑 */
const PENDING_TTL_MS = 10 * 60_000

interface PendingContext {
  /** 已经拼好的提示词（页面正文 + 来源），页面侧直接塞进输入框 */
  prompt: string
  title: string
  url: string
  createdAt: number
}

function composeSelectionPrompt(selection: string, title: string, url: string): string {
  return [
    '请基于下面这段网页内容帮我分析：',
    '',
    selection.trim(),
    '',
    `来源：${title || '未命名页面'} — ${url}`
  ].join('\n')
}

async function writePendingContext(input: { selection: string; title: string; url: string }): Promise<void> {
  const context: PendingContext = {
    prompt: composeSelectionPrompt(input.selection, input.title, input.url),
    title: input.title,
    url: input.url,
    createdAt: Date.now()
  }
  await writeValue(STORAGE_KEYS.pending, context)
}

/**
 * 取走待发送内容（取完即删）。
 *
 * 超过 10 分钟的丢弃：这是「刚点完右键」的一次性交接，久留的内容再塞进输入框
 * 只会让用户困惑「这段字哪来的」。
 */
async function takePendingContext(): Promise<PendingContext | null> {
  const value = await findValue<PendingContext>(STORAGE_KEYS.pending)
  if (!value) return null
  await removeValue(STORAGE_KEYS.pending)
  if (Date.now() - value.createdAt > PENDING_TTL_MS) return null
  return value
}

export { composeSelectionPrompt, takePendingContext, writePendingContext }
export type { PendingContext }
