/**
 * agentd 的 SSE 读取：按**空行**切帧，逐行解析 `event:` / `data:`。
 *
 * 独立成模块的理由：`apps/client` 与浏览器扩展各有一条订阅链路（发起一轮 / 恢复订阅），
 * 但**帧格式只有一份真源**。以前这段代码嵌在 client 那个上千行的会话控制器里，
 * 换宿主时只能整段抄走 —— 抄走就会漂移，而漂移的表现是「正文叠字」「事件莫名消失」，
 * 排查成本极高。
 *
 * 刻意**不做行缓冲复用**：SSE 的帧边界是空行，不是换行。
 *
 * ## 两件被真实代理打过的事（F-030）
 *
 * 1. **`data:` 可以有多行**：SSE 规范要求按 `\n` 拼起来再解析。旧实现只取第一条
 *    `data:`，一旦某个网关把 JSON 折行，帧就变成半截 JSON → 被当成坏帧丢掉。
 * 2. **帧边界可能是 `\r\n\r\n`**：经过改写换行的代理（或某些 HTTP 中间层）后，只认
 *    `\n\n` 会让整条流再也切不出帧，表现是「连上了但一个字都不来」。
 */

interface SSEFrame {
  event: string
  data: Record<string, unknown>
}

/** 帧边界：空行。`\r\n\r\n` 与 `\n\n` 都算（代理可能改写过换行） */
const FRAME_BOUNDARY = /\r?\n\r?\n/

/**
 * 解析一帧。
 *
 * 逐行读字段，而不是用 `/^event: (.+)$/m` 正则：
 * - 正则要求冒号后有空格，而协议只要求「字段名 + 冒号」，`event:run` 是合法的；
 * - 多行 `data:` 必须拼接，单条正则天然做不到。
 */
function parseFrame(raw: string): SSEFrame | null {
  let event = ''
  const data: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    // 空行在帧内不会出现（它已经是边界）；`:` 开头是注释/心跳，忽略
    if (!line || line.startsWith(':')) continue
    const sep = line.indexOf(':')
    const field = sep >= 0 ? line.slice(0, sep) : line
    // 规范：冒号后紧跟的一个空格是分隔符，不属于值
    const value = sep >= 0 ? line.slice(sep + 1).replace(/^ /, '') : ''
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  if (!event || data.length === 0) return null
  try {
    return { event, data: JSON.parse(data.join('\n')) as Record<string, unknown> }
  } catch (error) {
    // 坏帧丢掉，不要让整条流断掉；但要留痕（否则「事件莫名消失」无从查起）
    console.warn('[agent-runtime/sse] 丢弃一条坏的 SSE 帧:', error)
    return null
  }
}

/**
 * 读 SSE。`signal` 中止时直接结束迭代（**不抛错**）—— 调用方是在收尾，不该再收到异常。
 */
async function* toReadSSE(response: Response, signal: AbortSignal): AsyncGenerator<SSEFrame> {
  const body = response.body
  if (!body) return

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (!signal.aborted) {
      const chunk = await reader.read()
      if (chunk.done) return
      buffer += decoder.decode(chunk.value, { stream: true })

      let match = FRAME_BOUNDARY.exec(buffer)
      while (match) {
        const frame = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        const parsed = parseFrame(frame)
        if (parsed) yield parsed
        match = FRAME_BOUNDARY.exec(buffer)
      }
    }
  } finally {
    void reader.cancel().catch(function () {
      // 已经关了
    })
  }
}

export { parseFrame, toReadSSE }
export type { SSEFrame }
