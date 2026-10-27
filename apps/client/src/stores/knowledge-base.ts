/**
 * 知识库域状态（bases / 文档摘要 / 检索命中 / staging 草稿）。
 *
 * 与编辑态 `stores/knowledge.ts` 分开：那个是「当前这篇文档的编辑会话」，
 * 这里只关心库与列表，互不干扰。
 */
import { create } from 'zustand'
import { toast } from 'sonner'

import {
  createBase,
  discardStaged,
  listBases,
  listDocs,
  listStaging,
  mergeStaging,
  publishDoc,
  rescanBase,
  updateBase,
  type BasePatch,
  type KnowledgeBase,
  type KnowledgeDocSummary,
  type StagedFile
} from '@/lib/knowledge-ipc'
import type { PublishMode } from '@/shared/ipc/specs/knowledge'
import { useKnowledgeStore } from '@/stores/knowledge'
import { reportCaught } from '@/utils/exception-report'
import { exportDocHtml } from '@/views/knowledge/lib/export.ts'
import {
  searchHybrid,
  type CloudState,
  type HybridHit
} from '@/views/knowledge/lib/hybrid-search.ts'
import { findFileName } from '@/views/knowledge/lib/path.ts'

interface KnowledgeBaseState {
  bases: KnowledgeBase[]
  activeBaseID: string | null
  docs: KnowledgeDocSummary[]
  hits: HybridHit[]
  /** 上一次检索里云端通道的状态：`off` = 没有文档建过云端索引 */
  cloudState: CloudState
  counts: { local: number; cloud: number }
  staging: StagedFile[]
  query: string
  isLoading: boolean
  isPublishing: boolean
  error: string | null
  refresh: () => Promise<void>
  selectBase: (baseID: string | null) => Promise<void>
  setQuery: (query: string) => void
  runSearch: () => Promise<void>
  clearSearch: () => void
  create: (name: string) => Promise<boolean>
  /** 改当前库的选项（自动更新 / 自动导出 / 生成带引用） */
  updateBase: (patch: BasePatch) => Promise<boolean>
  rescan: () => Promise<void>
  publish: (file: StagedFile, mode: PublishMode) => Promise<boolean>
  discard: (file: StagedFile) => Promise<void>
  /** 把同一次生成的多章拼成一篇（结果仍待发布） */
  merge: (paths: string[], title: string) => Promise<boolean>
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return String(error)
}

const useKnowledgeBaseStore = create<KnowledgeBaseState>()(function (setter, getter) {
  /**
   * 侧栏的根 = 当前库目录。切库 / 首次拿到库列表都要同步，
   * 否则文件树还停在上一个库的目录上。值没变就不 bump，避免多余的目录重扫。
   */
  function syncWorkspaceRoot(baseID: string | null): void {
    const base = getter().bases.find(function (item) {
      return item.id === baseID
    })
    const next = base?.rootPath ?? null
    const workspace = useKnowledgeStore.getState()
    if (workspace.rootDir === next) return
    workspace.toSetRootDir(next)
    workspace.toBumpTree()
  }

  /**
   * 库开了「自动导出」时，发布成功顺手另存一份 HTML（失败不挽回发布）。
   * 导出物是副产物：不进文档表、不进侧栏，只方便分享与浏览。
   */
  async function exportIfEnabled(
    baseID: string,
    relPath: string,
    title: string
  ): Promise<void> {
    const base = getter().bases.find(function (item) {
      return item.id === baseID
    })
    if (!base?.autoExport) return
    const target = await exportDocHtml({ rootPath: base.rootPath, relPath, title })
    if (target) toast.success(`已导出 HTML：${findFileName(target)}`)
  }

  async function loadDocs(baseID: string | null): Promise<void> {
    const docs = await listDocs(baseID ?? undefined)
    setter({ docs })
  }

  async function loadStaging(baseID: string | null): Promise<void> {
    const staging = await listStaging(baseID ?? undefined)
    setter({ staging })
  }

  /**
   * 库开了「自动更新」时，打开面板就先回灌一次磁盘：
   * 用户在外面改文件不用再想起来点「重新扫描」。失败只告警，不影响列表。
   */
  async function syncFromDisk(baseID: string | null): Promise<void> {
    const base = getter().bases.find(function (item) {
      return item.id === baseID
    })
    if (!base?.autoUpdate) return
    try {
      await rescanBase(base.id)
    } catch (error) {
      reportCaught('knowledgeBase.syncFromDisk', error, 'warning')
    }
  }

  return {
    bases: [],
    activeBaseID: null,
    docs: [],
    hits: [],
    cloudState: 'off',
    counts: { local: 0, cloud: 0 },
    staging: [],
    query: '',
    isLoading: false,
    isPublishing: false,
    error: null,

    async refresh() {
      setter({ isLoading: true, error: null })
      try {
        const bases = await listBases()
        const activeBaseID =
          getter().activeBaseID && bases.some((base) => base.id === getter().activeBaseID)
            ? getter().activeBaseID
            : (bases[0]?.id ?? null)
        setter({ bases, activeBaseID })
        syncWorkspaceRoot(activeBaseID)
        await syncFromDisk(activeBaseID)
        await Promise.all([loadDocs(activeBaseID), loadStaging(activeBaseID)])
        setter({ isLoading: false })
      } catch (error) {
        reportCaught('knowledgeBase.refresh', error, 'warning')
        setter({ isLoading: false, error: toMessage(error) })
      }
    },

    async selectBase(baseID) {
      setter({ activeBaseID: baseID, hits: [], query: '' })
      syncWorkspaceRoot(baseID)
      try {
        await syncFromDisk(baseID)
        await Promise.all([loadDocs(baseID), loadStaging(baseID)])
      } catch (error) {
        reportCaught('knowledgeBase.selectBase', error, 'warning')
        setter({ error: toMessage(error) })
      }
    },

    setQuery(query) {
      setter({ query })
    },

    async runSearch() {
      const query = getter().query.trim()
      if (!query) {
        setter({ hits: [], cloudState: 'off', counts: { local: 0, cloud: 0 } })
        return
      }
      try {
        const result = await searchHybrid(query, { baseId: getter().activeBaseID ?? undefined })
        setter({
          hits: result.hits,
          cloudState: result.cloud,
          counts: result.counts,
          error: null
        })
      } catch (error) {
        reportCaught('knowledgeBase.runSearch', error, 'warning')
        setter({ error: toMessage(error) })
      }
    },

    clearSearch() {
      setter({ query: '', hits: [], cloudState: 'off', counts: { local: 0, cloud: 0 } })
    },

    async create(name) {
      try {
        const base = await createBase(name)
        setter({ bases: [...getter().bases, base], error: null })
        await getter().selectBase(base.id)
        return true
      } catch (error) {
        reportCaught('knowledgeBase.create', error, 'warning')
        setter({ error: toMessage(error) })
        return false
      }
    },

    async rescan() {
      const baseID = getter().activeBaseID
      if (!baseID) return
      setter({ isLoading: true, error: null })
      try {
        await rescanBase(baseID)
        await Promise.all([loadDocs(baseID), loadStaging(baseID)])
        setter({ isLoading: false })
      } catch (error) {
        reportCaught('knowledgeBase.rescan', error, 'warning')
        setter({ isLoading: false, error: toMessage(error) })
      }
    },

    async updateBase(patch) {
      const baseID = getter().activeBaseID
      if (!baseID) return false
      try {
        const updated = await updateBase(baseID, patch)
        setter({
          bases: getter().bases.map(function (item) {
            return item.id === updated.id ? updated : item
          }),
          error: null
        })
        return true
      } catch (error) {
        reportCaught('knowledgeBase.updateBase', error, 'warning')
        setter({ error: toMessage(error) })
        return false
      }
    },

    async publish(file, mode) {
      setter({ isPublishing: true, error: null })
      try {
        const published = await publishDoc(file.baseId, file.path, mode)
        await exportIfEnabled(file.baseId, published.relPath, published.title)
        const baseID = getter().activeBaseID
        await Promise.all([loadDocs(baseID), loadStaging(baseID)])
        setter({ isPublishing: false })
        return true
      } catch (error) {
        reportCaught('knowledgeBase.publish', error, 'warning')
        setter({ isPublishing: false, error: toMessage(error) })
        return false
      }
    },

    async discard(file) {
      try {
        await discardStaged(file.path)
        setter({
          staging: getter().staging.filter(function (item) {
            return item.path !== file.path
          })
        })
      } catch (error) {
        reportCaught('knowledgeBase.discard', error, 'warning')
        setter({ error: toMessage(error) })
      }
    },

    async merge(paths, title) {
      const baseID = getter().activeBaseID
      if (!baseID) return false
      setter({ isPublishing: true, error: null })
      try {
        await mergeStaging(baseID, paths, title)
        await getter().refresh()
        setter({ isPublishing: false })
        return true
      } catch (error) {
        reportCaught('knowledgeBase.merge', error, 'warning')
        setter({ isPublishing: false, error: toMessage(error) })
        return false
      }
    }
  }
})

export { useKnowledgeBaseStore }
