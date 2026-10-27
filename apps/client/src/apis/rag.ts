/**
 * 云端检索与索引任务（cogito `/api/v1/rag/*`）。
 *
 * 检索与本地 FTS 是两条独立通道：这里只负责**拿到云那一路**，融合在 `views/knowledge/lib/hybrid-search`。
 * 鉴权（JWT + `X-Tenant-ID`）与链路头由 `utils/http.ts` 统一注入，这里只写路径与形状。
 *
 * 模型不传：服务端按部署配置定（必须与建索引时一致），客户端传错只会得到一份空结果。
 */
import { HttpEnvelope } from '@/utils/http/errors.ts'
import { http } from '@/utils/http/http.ts'

/** 一块云命中。`score` 是余弦相似度（越大越相近），与本地 bm25 分数不同量纲，不能直接比较 */
interface RagHit {
  assetID: string
  ordinal: number
  score: number
  text: string
}

interface RagSearchParams {
  query: string
  /** 最多返回多少块；缺省由服务端定 */
  topK?: number
  /** 只在已建过索引的这些资产里找；`[]` 表示「没有可查的资产」 */
  assetIDs?: string[]
}

/** 索引任务台账行（`services/rag/schema.rs` 的 `IndexTaskR`） */
interface RagIndexTask {
  id: string
  assetID: string
  /** `RUNNING` / `SUCCEEDED` / `FAILED` */
  status: string
  /** 编排自报的进度原文（`chunked:48` / `embedded:32` / `indexed`） */
  progress: string | null
  /** 成功后的结果快照（`chunkSetID` / `chunkCount` / `dimensions` / `indexed` / `collection`） */
  result: Record<string, unknown> | null
  error: string | null
  createdAt: number
  updatedAt: number
}

/** 检索本租户已索引的内容。空数组是正常结果，不是错误。 */
function POST_RAG_SEARCH(params: RagSearchParams, signal?: AbortSignal): Promise<RagHit[]> {
  return http
    .post<RSF<{ hits: RagHit[] }>>(
      '/rag/search',
      { query: params.query, topK: params.topK, assetIDs: params.assetIDs },
      { env: 'cogito', signal }
    )
    .then(HttpEnvelope)
    .then(function (result) {
      return result.hits ?? []
    })
}

/** 给一份已上传完成的资产建索引：立刻返回台账行（通常还是 RUNNING）。 */
function POST_RAG_INDEX_TASK(assetID: string): Promise<RagIndexTask> {
  return http
    .post<RSF<RagIndexTask>>('/rag/index-tasks', { assetID }, { env: 'cogito' })
    .then(HttpEnvelope)
}

/** 查索引任务：进度与结果都从这里读。 */
function GET_RAG_INDEX_TASK(id: string): Promise<RagIndexTask> {
  return http
    .get<RSF<RagIndexTask>>(`/rag/index-tasks/${encodeURIComponent(id)}`, { env: 'cogito' })
    .then(HttpEnvelope)
}

export { GET_RAG_INDEX_TASK, POST_RAG_INDEX_TASK, POST_RAG_SEARCH }
export type { RagHit, RagIndexTask, RagSearchParams }
