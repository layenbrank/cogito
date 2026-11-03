/**
 * 多模态 caption：对 wiki/media 图片生成简述（ACP），写入旁路缓存。
 */
import { runInlinePrompt } from '@/features/agent/inline-prompt'
import { readMultimodalConfig } from '@/views/knowledge/lib/multimodal-config.ts'

const CACHE_KEY = 'knowledge.caption.cache'

type CaptionCache = Record<string, { text: string; at: number }>

function readCaptionCache(): CaptionCache {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as CaptionCache
  } catch (error) {
    console.warn('[caption] read cache failed', error)
    return {}
  }
}

function writeCaptionCache(cache: CaptionCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch (error) {
    console.warn('[caption] write cache failed', error)
  }
}

async function captionImagePath(relativePath: string, hint?: string): Promise<string> {
  const config = readMultimodalConfig()
  if (!config.enabled) throw new Error('多模态 caption 未启用')
  const cache = readCaptionCache()
  if (cache[relativePath]?.text) return cache[relativePath].text

  const text = await runInlinePrompt({
    text: `为知识库图片写一句中文说明（≤40字）。路径：${relativePath}\n提示：${hint || '无'}`,
    systemText: '只输出一句说明，不要引号，不要工具调用。'
  })
  cache[relativePath] = { text: text.trim(), at: Date.now() }
  writeCaptionCache(cache)
  return text.trim()
}

export { captionImagePath, readCaptionCache }
