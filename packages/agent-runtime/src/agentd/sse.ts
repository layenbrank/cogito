/**
 * agentd 的 SSE 读取：按 `\n\n` 切帧，取 `event:` 与 `data:` 两行。
 *
 * 独立成模块的理由：`apps/client` 与浏览器扩展各有一条订阅链路（发起一轮 / 恢复订阅），
 * 但**帧格式只有一份真源**。以前这段代码嵌在 client 那个上千行的会话控制器里，
 * 换宿主时只能整段抄走 —— 抄走就会漂移，而漂移的表现是「正文叠字」「事件莫名消失」，
 * 排查成本极高。
 *
 * 刻意**不做行缓冲复用**：SSE 的帧边界是空行，不是换行。
 */

interface SseFrame {
  event: string
  data: Record<string, unknown>
}

/**
 * 读 SSE。`signal` 中止时直接结束迭代（**不抛错**）—— 调用方是在收尾，不该再收到异常。
 */
async function* readSse(response: Response, signal: AbortSignal): AsyncGenerator<SseFrame> {
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

      let index = buffer.indexOf('\n\n')
      while (index >= 0) {
        const frame = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)

        const eventMatch = /^event: (.+)$/m.exec(frame)
        const dataMatch = /^data: (.+)$/m.exec(frame)
        if (eventMatch && dataMatch) {
          try {
            yield {
              event: eventMatch[1].trim(),
              data: JSON.parse(dataMatch[1]) as Record<string, unknown>
            }
          } catch (error) {
            // 坏帧丢掉，不要让整条流断掉；但要留痕（否则「事件莫名消失」无从查起）
            console.warn('[agent-runtime/sse] 丢弃一条坏的 SSE 帧:', error)
          }
        }
        index = buffer.indexOf('\n\n')
      }
    }
  } finally {
    void reader.cancel().catch(function () {
      // 已经关了
    })
  }
}

export { readSse }
export type { SseFrame }
