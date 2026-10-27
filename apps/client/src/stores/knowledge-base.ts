/**
 * 知识库域状态（bases / 文档摘要 / 检索命中 / staging 草稿）。
 *
 * 与编辑态 `stores/knowledge.ts` 分开：那个是「当前这篇文档的编辑会话」，
 * 这里只关心库与列表，互不干扰。
 */
import { create } from 'zustand'

import {
  createBase,
  discardStaged,
  listBases,
  listDocs,
  listStaging,
  publishDoc,
  rescanBase,
  searchDocs,
  type KnowledgeBase,
  type KnowledgeDocSummary,
  type KnowledgeHit,
  type StagedFile
} from '@/lib/knowledge-ipc'
import type { PublishMode } from '@/shared/ipc/specs/knowledge'
import { reportCaught } from '@/utils/exception-report'

interface KnowledgeBaseState {
  bases: KnowledgeBase[]
  activeBaseID: string | null
  docs: KnowledgeDocSummary[]
  hits: KnowledgeHit[]
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
  rescan: () => Promise<void>
  publish: (file: StagedFile, mode: PublishMode) => Promise<boolean>
  discard: (file: StagedFile) => Promise<void>
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return String(error)
}

const useKnowledgeBaseStore = create<KnowledgeBaseState>()(function (setter, getter) {
  async function loadDocs(baseID: string | null): Promise<void> {
    const docs = await listDocs(baseID ?? undefined)
    setter({ docs })
  }

  async function loadStaging(baseID: string | null): Promise<void> {
    const staging = await listStaging(baseID ?? undefined)
    setter({ staging })
  }

  return {
    bases: [],
    activeBaseID: null,
    docs: [],
    hits: [],
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
        await Promise.all([loadDocs(activeBaseID), loadStaging(activeBaseID)])
        setter({ isLoading: false })
      } catch (error) {
        reportCaught('knowledgeBase.refresh', error, 'warning')
        setter({ isLoading: false, error: toMessage(error) })
      }
    },

    async selectBase(baseID) {
      setter({ activeBaseID: baseID, hits: [], query: '' })
      try {
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
        setter({ hits: [] })
        return
      }
      try {
        const hits = await searchDocs(query, getter().activeBaseID ?? undefined)
        setter({ hits, error: null })
      } catch (error) {
        reportCaught('knowledgeBase.runSearch', error, 'warning')
        setter({ error: toMessage(error) })
      }
    },

    clearSearch() {
      setter({ query: '', hits: [] })
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

    async publish(file, mode) {
      setter({ isPublishing: true, error: null })
      try {
        await publishDoc(file.baseId, file.path, mode)
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
    }
  }
})

export { useKnowledgeBaseStore }
