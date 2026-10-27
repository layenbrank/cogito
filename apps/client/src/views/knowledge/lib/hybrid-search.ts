/**
 * 混合检索：本地 FTS5 与云端向量两路召回，按 RRF 融合。
 *
 * 为什么在客户端融合：两路的分数**不同量纲**（bm25 与余弦相似度），直接加权求和是编数字；
 * RRF 只看名次，不需要把两把尺子对齐。而两路结果只有渲染进程同时拿得到（本地走 IPC、
 * 云端走带 JWT 的 HTTP），所以融合放在这里，服务端不做。
 *
 * 降级：云那一路的任何失败（没登录、租户不对、compute 未接通、网络抖）都只让结果变成
 * 「本地 + 标注」——本地检索永远可用，不该被云端拖住。
 */
import { POST_RAG_SEARCH, type RagHit } from '@/apis/rag'
import { listCloudDocs, searchDocs, type KnowledgeHit } from '@/lib/knowledge-ipc'
import { reportCaught } from '@/utils/exception-report'

/** RRF 的平滑常数：取文献里的 60，名次靠前的那几名不会被单路垄断 */
const RRF_K = 60
/** 每路先各取这么多条，再融合截断 */
const CANDIDATE_LIMIT = 20

type CloudState = 'ok' | 'unavailable' | 'off'

interface HybridHit extends KnowledgeHit {
  /** 融合分（只用于排序，不可跨查询比较） */
  fused: number
  /** 这一条被哪几路召回 */
  channels: ('local' | 'cloud')[]
}

interface HybridResult {
  hits: HybridHit[]
  /** `off` = 没有文档建过云端索引（不必提示） */
  cloud: CloudState
  /** 本地/云端各自命中的条数 */
  counts: { local: number; cloud: number }
}

interface HybridOptions {
  baseId?: string
  topK?: number
  signal?: AbortSignal
}

/** 名次 → RRF 权重：第 1 名 1/(k+1)，越靠后越小 */
function rankWeight(rank: number): number {
  return 1 / (RRF_K + rank)
}

/** 一篇文档可能被云端命中多块：只留分数最高的那块作为它的云侧代表 */
function bestCloudChunk(hits: RagHit[]): Map<string, RagHit> {
  const best = new Map<string, RagHit>()
  for (const hit of hits) {
    const current = best.get(hit.assetID)
    if (!current || hit.score > current.score) best.set(hit.assetID, hit)
  }
  return best
}

/**
 * 融合两路结果。
 *
 * 纯函数：输入是「本地命中」与「assetID → 文档坐标」的对照 + 云端命中，输出排序后的列表。
 * 分开写是为了能单独测 RRF（不需要 IPC 也不碰网络）。
 */
function fuseHits(params: {
  local: KnowledgeHit[]
  cloud: RagHit[]
  findDocId: (assetId: string) => string | null
  topK: number
}): HybridHit[] {
  const merged = new Map<string, HybridHit>()

  params.local.forEach(function (hit, index) {
    merged.set(hit.docId, {
      ...hit,
      fused: rankWeight(index + 1),
      channels: ['local']
    })
  })

  const best = bestCloudChunk(params.cloud)
  const cloudRanked = [...best.values()].sort(function (left, right) {
    return right.score - left.score
  })
  cloudRanked.forEach(function (hit, index) {
    const docId = params.findDocId(hit.assetID)
    // 对不上文档的云端命中直接丢：它可能来自已删除的资产，展示出来只会让人困惑
    if (!docId) return
    const weight = rankWeight(index + 1)
    const existing = merged.get(docId)
    if (existing) {
      existing.fused += weight
      existing.channels.push('cloud')
      return
    }
    merged.set(docId, {
      docId,
      baseId: '',
      title: '',
      relPath: '',
      snippet: hit.text,
      score: hit.score,
      mode: 'cloud',
      fused: weight,
      channels: ['cloud']
    })
  })

  return [...merged.values()]
    .sort(function (left, right) {
      return right.fused - left.fused
    })
    .slice(0, params.topK)
}

/**
 * 跑一次混合检索。
 *
 * 没有文档建过云端索引时**不发请求**：匿名/未开通的机器上那一路注定是空集，
 * 白发一次只会多一条失败日志。
 */
async function searchHybrid(query: string, options: HybridOptions = {}): Promise<HybridResult> {
  const topK = options.topK ?? 8
  const local = await searchDocs(query, options.baseId, CANDIDATE_LIMIT)

  let cloudDocs
  try {
    cloudDocs = await listCloudDocs(options.baseId)
  } catch (error) {
    reportCaught('knowledge.hybrid.listCloudDocs', error, 'warning')
    return { hits: toHybrid(local, topK), cloud: 'unavailable', counts: { local: local.length, cloud: 0 } }
  }
  if (cloudDocs.length === 0) {
    return { hits: toHybrid(local, topK), cloud: 'off', counts: { local: local.length, cloud: 0 } }
  }

  const docIdByAsset = new Map(
    cloudDocs.map(function (doc) {
      return [doc.assetId, doc.docId] as const
    })
  )

  let cloud: RagHit[] = []
  let state: CloudState = 'ok'
  try {
    cloud = await POST_RAG_SEARCH(
      { query, topK: CANDIDATE_LIMIT, assetIDs: cloudDocs.map((doc) => doc.assetId) },
      options.signal
    )
  } catch (error) {
    // 云那一路失败不影响本地：结果照常返回，只是标注一下
    reportCaught('knowledge.hybrid.cloudSearch', error, 'warning')
    state = 'unavailable'
  }

  return {
    hits: fuseHits({
      local,
      cloud,
      findDocId: function (assetId) {
        return docIdByAsset.get(assetId) ?? null
      },
      topK
    }),
    cloud: state,
    counts: { local: local.length, cloud: cloud.length }
  }
}

/** 只有本地那一路时的形状（仍带上排序分，界面不用区分两种来源） */
function toHybrid(local: KnowledgeHit[], topK: number): HybridHit[] {
  return local.slice(0, topK).map(function (hit, index) {
    return { ...hit, fused: rankWeight(index + 1), channels: ['local'] as const }
  })
}

export { fuseHits, rankWeight, RRF_K, searchHybrid }
export type { CloudState, HybridHit, HybridOptions, HybridResult }
