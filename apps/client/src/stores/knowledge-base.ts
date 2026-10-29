/**
 * 知识库域状态（bases / 文档摘要 / 检索命中 / staging 草稿）。
 *
 * 与编辑态 `stores/knowledge.ts` 分开：那个是「当前这篇文档的编辑会话」，
 * 这里只关心库与列表，互不干扰。
 */
import { create } from 'zustand'
import { toast } from 'sonner'

import {
  insertBase,
  discardStaged,
  exportBundle as bundleExport,
  listBases,
  listCloudStates,
  listDocs,
  listStaging,
  mergeStaging,
  publishDoc,
  rescanBase,
  updateBase,
  type BasePatch,
  type CloudState,
  type KnowledgeBase,
  type KnowledgeDocSummary,
  type StagedFile
} from '@/lib/knowledge-ipc'
import type { PublishMode } from '@/shared/ipc/specs/knowledge'
import { useKnowledgeStore } from '@/stores/knowledge'
import { reportCaught } from '@/utils/exception-report'
import { syncDocsToCloud } from '@/views/knowledge/lib/cloud-sync.ts'
import { exportDocHtml } from '@/views/knowledge/lib/export.ts'
import {
  searchHybrid,
  type CloudChannel,
  type HybridHit
} from '@/views/knowledge/lib/hybrid-search.ts'
import { DICT_VALUE } from '@/shared/ipc/specs/dict'
import { findFileName, isSamePath, joinPath } from '@/views/knowledge/lib/path.ts'

const CLOUD = DICT_VALUE.KNOWLEDGE_CLOUD_STATUS

interface KnowledgeBaseState {
  bases: KnowledgeBase[]
  activeBaseID: string | null
  docs: KnowledgeDocSummary[]
  hits: HybridHit[]
  /** 上一次检索里云端通道的状态：`off` = 没有文档建过云端索引 */
  cloudState: CloudChannel
  counts: { local: number; cloud: number }
  /** 每篇文档的云端索引状态（只有写过状态的文档才有条目） */
  cloudStates: Record<string, CloudState>
  isSyncingCloud: boolean
  staging: StagedFile[]
  query: string
  isLoading: boolean
  isPublishing: boolean
  error: string | null
  refresh: () => Promise<void>
  selectBase: (baseID: string | null) => Promise<void>
  writeQuery: (query: string) => void
  runSearch: () => Promise<void>
  clearSearch: () => void
  insert: (name: string) => Promise<boolean>
  /** 改当前库的选项（自动更新 / 自动导出 / 生成带引用） */
  updateBase: (patch: BasePatch) => Promise<boolean>
  rescan: () => Promise<void>
  publish: (file: StagedFile, mode: PublishMode) => Promise<boolean>
  discard: (file: StagedFile) => Promise<void>
  /** 把同一次生成的多章拼成一篇（结果仍待发布） */
  merge: (paths: string[], title: string) => Promise<boolean>
  /** 把本库还没上云的文档逐篇传上去建索引 */
  syncCloud: () => Promise<void>
  /** 整包导出：把当前库的 Markdown 打成 zip，弹提示告知落盘路径 */
  exportBundle: () => Promise<void>
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return String(error)
}

const useKnowledgeBaseStore = create<KnowledgeBaseState>()(function (setter, getter) {
  /**
   * 侧栏根与库目录对齐。
   * - 切库（force）：采用该库目录并落盘
   * - 普通 refresh：若用户已有工作区根（打开的文件夹 / 已恢复的偏好），不要用空的
   *   default 库目录把侧栏覆盖掉
   */
  function syncWorkspaceRoot(
    baseID: string | null,
    options: { force?: boolean } = {}
  ): void {
    const base = getter().bases.find(function (item) {
      return item.id === baseID
    })
    const next = base?.rootPath ?? null
    const workspace = useKnowledgeStore.getState()
    if (!options.force && (workspace.rootDir || workspace.workspaceRoot)) return
    if (isSamePath(workspace.rootDir, next)) return
    workspace.toSetRootDir(next, { persist: Boolean(options.force) })
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

  async function fetchDocs(baseID: string | null): Promise<void> {
    const docs = await listDocs(baseID ?? undefined)
    setter({ docs })
  }

  async function fetchStaging(baseID: string | null): Promise<void> {
    const staging = await listStaging(baseID ?? undefined)
    setter({ staging })
  }

  async function fetchCloudStates(baseID: string | null): Promise<void> {
    const states = await listCloudStates(baseID ?? undefined)
    setter({
      cloudStates: Object.fromEntries(
        states.map(function (state) {
          return [state.docId, state]
        })
      )
    })
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
    cloudStates: {},
    isSyncingCloud: false,
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
        await Promise.all([
          fetchDocs(activeBaseID),
          fetchStaging(activeBaseID),
          fetchCloudStates(activeBaseID)
        ])
        setter({ isLoading: false })
      } catch (error) {
        reportCaught('knowledgeBase.refresh', error, 'warning')
        setter({ isLoading: false, error: toMessage(error) })
      }
    },

    async selectBase(baseID) {
      setter({ activeBaseID: baseID, hits: [], query: '' })
      syncWorkspaceRoot(baseID, { force: true })
      try {
        await syncFromDisk(baseID)
        await Promise.all([
          fetchDocs(baseID),
          fetchStaging(baseID),
          fetchCloudStates(baseID)
        ])
      } catch (error) {
        reportCaught('knowledgeBase.selectBase', error, 'warning')
        setter({ error: toMessage(error) })
      }
    },

    writeQuery(query) {
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

    async insert(name) {
      try {
        const base = await insertBase(name)
        setter({ bases: [...getter().bases, base], error: null })
        await getter().selectBase(base.id)
        return true
      } catch (error) {
        reportCaught('knowledgeBase.insert', error, 'warning')
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
        await Promise.all([fetchDocs(baseID), fetchStaging(baseID)])
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
        await Promise.all([fetchDocs(baseID), fetchStaging(baseID)])
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
    },

    /**
     * 同步到云端：只挑「还没成功过」的文档，逐篇上传 + 建索引。
     *
     * 串行是必须的：服务端同一资产只允许一个索引任务在跑，并发只会互相 409。
     * 每篇的状态立刻写回 `cloudStates`，面板上的角标因此是实时的。
     */
    async syncCloud() {
      const baseID = getter().activeBaseID
      const base = getter().bases.find(function (item) {
        return item.id === baseID
      })
      if (!base) return

      const pending = getter().docs.filter(function (doc) {
        return getter().cloudStates[doc.id]?.status !== CLOUD.SUCCEEDED
      })
      if (pending.length === 0) {
        toast.message('这个库的文档都已同步到云端')
        return
      }

      setter({ isSyncingCloud: true, error: null })
      const targets = pending.map(function (doc) {
        return {
          docId: doc.id,
          path: joinPath(base.rootPath, doc.relPath),
          name: `${doc.title}.md`
        }
      })

      try {
        const results = await syncDocsToCloud(targets, function (done, total, last) {
          const current = getter().cloudStates
          setter({
            cloudStates: {
              ...current,
              [last.docId]: {
                docId: last.docId,
                status: last.status,
                assetId: current[last.docId]?.assetId ?? null,
                indexedAt: last.status === CLOUD.SUCCEEDED ? Date.now() : null,
                error: last.error ?? null
              }
            }
          })
          toast.loading(`正在同步到云端 ${done}/${total}`, { id: 'knowledge-cloud-sync' })
        })

        const failed = results.filter(function (item) {
          return item.status === CLOUD.FAILED
        })
        toast.dismiss('knowledge-cloud-sync')
        if (failed.length === 0) {
          toast.success(`已同步 ${results.length} 篇到云端`)
        } else {
          toast.error(`${failed.length} 篇同步失败：${failed[0]?.error ?? '原因未知'}`)
        }
        await getter().refresh()
      } catch (error) {
        reportCaught('knowledgeBase.syncCloud', error, 'warning')
        toast.dismiss('knowledge-cloud-sync')
        setter({ error: toMessage(error) })
      } finally {
        setter({ isSyncingCloud: false })
      }
    },

    async exportBundle() {
      const baseID = getter().activeBaseID
      if (!baseID) return
      try {
        const path = await bundleExport(baseID)
        toast.success('已导出：' + path)
      } catch (error) {
        reportCaught('knowledgeBase.exportBundle', error)
        toast.error(toMessage(error))
      }
    }
  }
})

export { useKnowledgeBaseStore }
