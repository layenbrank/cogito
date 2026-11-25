/**
 * 检索混合排序：FTS hits + 向量 + 简单 RRF；附带图片命中。
 */
import type { KnowledgeHit } from '@/apis/knowledge'
import { searchVectors } from '@/views/knowledge/lib/vector-store.ts'

interface ImageHit {
  docId: string
  alt: string
  src: string
  score: number
}

function reciprocalRankFusion(
  lists: { id: string; score: number }[][],
  k = 60
): Map<string, number> {
  const scores = new Map<string, number>()
  for (const list of lists) {
    list.forEach(function (item, index) {
      const prev = scores.get(item.id) ?? 0
      scores.set(item.id, prev + 1 / (k + index + 1) + item.score * 0.01)
    })
  }
  return scores
}

async function mergeHybridHits(input: {
  ftsHits: KnowledgeHit[]
  query: string
}): Promise<KnowledgeHit[]> {
  const vectorHits = await searchVectors(input.query, 12)
  const fused = reciprocalRankFusion([
    input.ftsHits.map(function (hit) {
      return { id: hit.docId || hit.relPath, score: hit.score ?? 0 }
    }),
    vectorHits.map(function (hit) {
      return { id: hit.docId, score: hit.score }
    })
  ])

  const byId = new Map<string, KnowledgeHit>()
  for (const hit of input.ftsHits) {
    byId.set(hit.docId || hit.relPath, hit)
  }
  for (const hit of vectorHits) {
    if (!byId.has(hit.docId)) {
      byId.set(hit.docId, {
        docId: hit.docId,
        relPath: hit.docId,
        title: hit.docId,
        snippet: hit.snippet,
        score: hit.score
      } as KnowledgeHit)
    }
  }

  return [...byId.values()].sort(function (a, b) {
    const left = fused.get(a.docId || a.relPath) ?? 0
    const right = fused.get(b.docId || b.relPath) ?? 0
    return right - left
  })
}

interface MarkdownImage {
  relPath: string
  alt: string
  src: string
}

/**
 * 抽出一页里的全部 Markdown 图片。
 *
 * 拆出来是因为检索页需要「按 docs 版本缓存一次、每次查询只做匹配」：以前每个按键
 * 都把整库 Markdown 重新读盘 + 重新跑正则，文档多的时候一次输入就是几十次 IPC。
 */
function collectMarkdownImages(content: string, relPath: string): MarkdownImage[] {
  const images: MarkdownImage[] = []
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(content))) {
    images.push({ relPath, alt: match[1] || '', src: match[2] || '' })
  }
  return images
}

/** 在已抽好的图片清单上做子串匹配（纯内存，按键级调用也安全） */
function filterImageHits(images: MarkdownImage[], query: string): ImageHit[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const hits: ImageHit[] = []
  for (const image of images) {
    const hay = `${image.alt} ${image.src}`.toLowerCase()
    if (!hay.includes(needle)) continue
    hits.push({
      docId: image.relPath,
      alt: image.alt || image.src,
      src: image.src,
      score: hay.startsWith(needle) ? 1 : 0.5
    })
  }
  return hits.sort(function (a, b) {
    return b.score - a.score
  })
}

/** 一次性版本（保留给「手头只有正文」的调用方；检索页请走 collect + filter） */
function findImageHitsFromMarkdown(
  pages: { relPath: string; content: string }[],
  query: string
): ImageHit[] {
  const images: MarkdownImage[] = []
  for (const page of pages) {
    images.push(...collectMarkdownImages(page.content, page.relPath))
  }
  return filterImageHits(images, query)
}

export {
  collectMarkdownImages,
  filterImageHits,
  findImageHitsFromMarkdown,
  mergeHybridHits,
  reciprocalRankFusion
}
export type { ImageHit, MarkdownImage }
