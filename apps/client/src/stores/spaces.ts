/**
 * 空间与列表状态（spaces / 当前空间 / 文档摘要 / 检索命中 / staging 草稿）。
 *
 * 与编辑态 `stores/knowledge.ts` 分开：那个是「当前这篇文档的编辑会话」，
 * 这里只关心空间与列表，互不干扰。
 */
import { create } from 'zustand'
import { toast } from 'sonner'

import {
  POST_KNOWLEDGE_SPACE,
  DELETE_KNOWLEDGE_STAGING,
  POST_KNOWLEDGE_EXPORT as bundleExport,
  GET_KNOWLEDGE_SPACES,
  GET_KNOWLEDGE_DOCS,
  GET_KNOWLEDGE_STAGING,
  POST_KNOWLEDGE_MERGE,
  POST_KNOWLEDGE_MIGRATE_LAYOUT,
  POST_KNOWLEDGE_PUBLISH,
  POST_KNOWLEDGE_PUBLISH_MANY,
  POST_KNOWLEDGE_REBUILD_INDEX,
  POST_KNOWLEDGE_RESCAN,
  type KnowledgeSpace,
  type KnowledgeDocSummary,
  type KnowledgeHit,
  type MigrationReport,
  type StagedFile
} from '@/apis/knowledge'
import type { PublishMode } from '@/shared/ipc/specs/knowledge'
import { useKnowledgeStore } from '@/stores/knowledge'
import { reportCaught } from '@/utils/exception-report'
import { searchKnowledge } from '@/views/knowledge/lib/doc-search.ts'
import { exportDocHtml } from '@/views/knowledge/lib/export.ts'
import { findFileName, isSamePath } from '@/views/knowledge/lib/path.ts'
import { DEMO_WIKI_NAME, writeDemoWikiTree } from '@/views/knowledge/lib/demo-wiki.ts'
import { ensureWikiScaffold, writeWikiTemplate } from '@/views/knowledge/lib/wiki-scaffold.ts'
import { WIKI_TEMPLATE_GENERAL } from '@/views/knowledge/lib/wiki-templates.ts'

/**
 * 脚手架只需确认一次：`refresh()` 会在侧栏展开 / 切页签 / 发布后被反复触发，
 * 每次都做 9 次 `exists` IPC 没必要。失败不写入，下次仍会重试。
 */
const scaffoldedRoots = new Set<string>()
/** 同一空间的整库 rescan 冷却窗口 */
const RESCAN_COOLDOWN_MS = 15_000
const lastRescanAt = new Map<string, number>()
/** 刷新单飞：侧栏 / staging / 发布后可能同时触发，串行化避免重复拉列表与扫盘 */
let refreshTask: Promise<void> | null = null

interface SpacesState {
  spaces: KnowledgeSpace[]
  activeSpaceID: string | null
  docs: KnowledgeDocSummary[]
  hits: KnowledgeHit[]
  staging: StagedFile[]
  query: string
  isLoading: boolean
  isPublishing: boolean
  error: string | null
  refresh: () => Promise<void>
  selectSpace: (spaceID: string | null) => Promise<void>
  writeQuery: (query: string) => void
  runSearch: () => Promise<void>
  clearSearch: () => void
  addSpace: (name: string, templateId?: string) => Promise<boolean>
  /** 导入内置示例空间（含 purpose/schema 与示例页） */
  importExample: () => Promise<boolean>
  rescan: () => Promise<void>
  publish: (file: StagedFile, mode: PublishMode) => Promise<boolean>
  /** 批量发布：每页各自成页（唯一接受的多章落地方式） */
  publishMany: (files: StagedFile[], mode: PublishMode) => Promise<boolean>
  discard: (file: StagedFile) => Promise<void>
  /** 把同一次生成的多章拼成一篇（结果仍待发布） */
  merge: (paths: string[], title: string) => Promise<boolean>
  /** 存量归位：空间根 / 错目录页 → `wiki/<type>/`；`dryRun` 只取报告 */
  migrateLayout: (dryRun: boolean) => Promise<MigrationReport | null>
  /** 按空间内文档重建 wiki/index.md */
  rebuildIndex: () => Promise<void>
  /** 整包导出：把当前空间的 Markdown 打成 zip，弹提示告知落盘路径 */
  exportBundle: () => Promise<void>
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return String(error)
}

const useSpacesStore = create<SpacesState>()(function (setter, getter) {
  /**
   * 侧栏根与库目录对齐。
   * - 切空间（force）：采用该空间目录并落盘
   * - 普通 refresh：若用户已有工作区根（打开的文件夹 / 已恢复的偏好），不要用空的
   *   default 库目录把侧栏覆盖掉
   */
  function syncWorkspaceRoot(
    spaceID: string | null,
    options: { force?: boolean } = {}
  ): void {
    const space = getter().spaces.find(function (item) {
      return item.id === spaceID
    })
    const next = space?.rootPath ?? null
    const workspace = useKnowledgeStore.getState()
    if (!options.force && (workspace.rootDir || workspace.workspaceRoot)) return
    if (isSamePath(workspace.rootDir, next)) return
    workspace.toSetRootDir(next, { persist: Boolean(options.force) })
    workspace.toBumpTree()
  }

  /**
   * 空间开了「自动导出」时，发布成功顺手另存一份 HTML（失败不挽回发布）。
   * 导出物是副产物：不进文档表、不进侧栏，只方便分享与浏览。
   */
  async function exportIfEnabled(
    spaceID: string,
    relPath: string,
    title: string
  ): Promise<void> {
    const space = getter().spaces.find(function (item) {
      return item.id === spaceID
    })
    if (!space?.autoExport) return
    const target = await exportDocHtml({ rootPath: space.rootPath, relPath, title })
    if (target) toast.success(`已导出 HTML：${findFileName(target)}`)
  }

  /**
   * 并行拉「文档 + 草稿」，只 emit 一次。
   * 分两次 setter 会让每个订阅方连着重渲染（docs → staging），列表越大越明显。
   */
  async function fetchDocsAndStaging(spaceID: string | null): Promise<void> {
    const [docs, staging] = await Promise.all([
      GET_KNOWLEDGE_DOCS(spaceID ?? undefined),
      GET_KNOWLEDGE_STAGING(spaceID ?? undefined)
    ])
    setter({ docs, staging })
  }

  /**
   * 空间开了「自动更新」时，打开面板就先回灌一次磁盘：
   * 用户在外面改文件不用再想起来点「重新扫描」。失败只告警，不影响列表。
   *
   * 带冷却：`refresh()` 会被侧栏展开、切页签、发布后反复触发，而后端 rescan 是整库扫盘，
   * 连点几次就是几次全盘扫描。
   */
  async function syncFromDisk(spaceID: string | null): Promise<void> {
    const space = getter().spaces.find(function (item) {
      return item.id === spaceID
    })
    if (!space?.autoUpdate) return
    const last = lastRescanAt.get(space.id) ?? 0
    if (Date.now() - last < RESCAN_COOLDOWN_MS) return
    lastRescanAt.set(space.id, Date.now())
    try {
      await POST_KNOWLEDGE_RESCAN(space.id)
    } catch (error) {
      reportCaught('spaces.syncFromDisk', error, 'warning')
    }
  }

  return {
    spaces: [],
    activeSpaceID: null,
    docs: [],
    hits: [],
    staging: [],
    query: '',
    isLoading: false,
    isPublishing: false,
    error: null,

    async refresh() {
      if (refreshTask) return refreshTask
      refreshTask = (async function () {
        setter({ isLoading: true, error: null })
        try {
          const spaces = await GET_KNOWLEDGE_SPACES()
          const activeSpaceID =
            getter().activeSpaceID && spaces.some((space) => space.id === getter().activeSpaceID)
              ? getter().activeSpaceID
              : (spaces[0]?.id ?? null)
          setter({ spaces, activeSpaceID })
          syncWorkspaceRoot(activeSpaceID)
          const active = spaces.find(function (space) {
            return space.id === activeSpaceID
          })
          if (active?.rootPath && !scaffoldedRoots.has(active.rootPath)) {
            try {
              await ensureWikiScaffold(active.rootPath, WIKI_TEMPLATE_GENERAL)
              scaffoldedRoots.add(active.rootPath)
            } catch (error) {
              reportCaught('spaces.wikiScaffold', error, 'warning')
            }
          }
          await syncFromDisk(activeSpaceID)
          await fetchDocsAndStaging(activeSpaceID)
          setter({ isLoading: false })
        } catch (error) {
          reportCaught('spaces.refresh', error, 'warning')
          setter({ isLoading: false, error: toErrorMessage(error) })
        }
      })().finally(function () {
        refreshTask = null
      })
      return refreshTask
    },

    async selectSpace(spaceID) {
      setter({ activeSpaceID: spaceID, hits: [], query: '' })
      syncWorkspaceRoot(spaceID, { force: true })
      try {
        await syncFromDisk(spaceID)
        await fetchDocsAndStaging(spaceID)
      } catch (error) {
        reportCaught('spaces.selectSpace', error, 'warning')
        setter({ error: toErrorMessage(error) })
      }
    },

    writeQuery(query) {
      setter({ query })
    },

    async runSearch() {
      const query = getter().query.trim()
      if (!query) {
        setter({ hits: [] })
        return
      }
      try {
        const hits = await searchKnowledge(query, {
          spaceId: getter().activeSpaceID ?? undefined
        })
        setter({ hits, error: null })
      } catch (error) {
        reportCaught('spaces.runSearch', error, 'warning')
        setter({ error: toErrorMessage(error) })
      }
    },

    clearSearch() {
      setter({ query: '', hits: [] })
    },

    async addSpace(name, templateId = WIKI_TEMPLATE_GENERAL) {
      try {
        const space = await POST_KNOWLEDGE_SPACE(name)
        await writeWikiTemplate(space.rootPath, templateId)
        scaffoldedRoots.add(space.rootPath)
        setter({ spaces: [...getter().spaces, space], error: null })
        await getter().selectSpace(space.id)
        return true
      } catch (error) {
        reportCaught('spaces.addSpace', error, 'warning')
        setter({ error: toErrorMessage(error) })
        return false
      }
    },

    async importExample() {
      try {
        const space = await POST_KNOWLEDGE_SPACE(DEMO_WIKI_NAME)
        await writeDemoWikiTree(space.rootPath)
        // 补齐 .agent / raw/parsed 等目录；已有 purpose/schema 不覆盖
        await ensureWikiScaffold(space.rootPath, WIKI_TEMPLATE_GENERAL)
        scaffoldedRoots.add(space.rootPath)
        setter({ spaces: [...getter().spaces, space], error: null })
        await getter().selectSpace(space.id)
        await POST_KNOWLEDGE_RESCAN(space.id)
        const settled = await Promise.allSettled([
          GET_KNOWLEDGE_DOCS(space.id),
          GET_KNOWLEDGE_STAGING(space.id)
        ])
        for (const result of settled) {
          if (result.status === 'rejected') {
            reportCaught('spaces.importExample.refresh', result.reason, 'warning')
          }
        }
        toast.success(`已导入「${space.name}」`)
        return true
      } catch (error) {
        reportCaught('spaces.importExample', error, 'warning')
        setter({ error: toErrorMessage(error) })
        toast.error(toErrorMessage(error))
        return false
      }
    },

    async rescan() {
      const spaceID = getter().activeSpaceID
      if (!spaceID) return
      setter({ isLoading: true, error: null })
      try {
        lastRescanAt.set(spaceID, Date.now())
        await POST_KNOWLEDGE_RESCAN(spaceID)
        await fetchDocsAndStaging(spaceID)
        setter({ isLoading: false })
      } catch (error) {
        reportCaught('spaces.rescan', error, 'warning')
        setter({ isLoading: false, error: toErrorMessage(error) })
      }
    },

    async publish(file, mode) {
      setter({ isPublishing: true, error: null })
      try {
        const published = await POST_KNOWLEDGE_PUBLISH(file.spaceId, file.path, mode)
        await exportIfEnabled(file.spaceId, published.relPath, published.title)
        const spaceID = getter().activeSpaceID
        await fetchDocsAndStaging(spaceID)
        setter({ isPublishing: false })
        toast.success(`已发布：${published.title}`)
        return true
      } catch (error) {
        reportCaught('spaces.publish', error, 'warning')
        setter({ isPublishing: false, error: toErrorMessage(error) })
        toast.error(toErrorMessage(error))
        // 部分发布（或已落盘但落库失败）时刷新，别让界面停在旧列表
        const spaceID = getter().activeSpaceID
        await fetchDocsAndStaging(spaceID)
        return false
      }
    },

    async publishMany(files, mode) {
      if (files.length === 0) return false
      const spaceID = files[0]?.spaceId
      if (!spaceID) return false
      setter({ isPublishing: true, error: null })
      try {
        const published = await POST_KNOWLEDGE_PUBLISH_MANY(
          spaceID,
          files.map(function (file) {
            return file.path
          }),
          mode
        )
        for (const doc of published) {
          await exportIfEnabled(doc.spaceId, doc.relPath, doc.title)
        }
        const activeSpaceID = getter().activeSpaceID
        await fetchDocsAndStaging(activeSpaceID)
        setter({ isPublishing: false })
        toast.success(`已发布 ${published.length} 页`)
        return true
      } catch (error) {
        reportCaught('spaces.publishMany', error, 'warning')
        setter({ isPublishing: false, error: toErrorMessage(error) })
        toast.error(toErrorMessage(error))
        const activeSpaceID = getter().activeSpaceID
        await fetchDocsAndStaging(activeSpaceID)
        return false
      }
    },

    async discard(file) {
      try {
        await DELETE_KNOWLEDGE_STAGING(file.path)
        setter({
          staging: getter().staging.filter(function (item) {
            return item.path !== file.path
          })
        })
      } catch (error) {
        reportCaught('spaces.discard', error, 'warning')
        setter({ error: toErrorMessage(error) })
      }
    },

    async merge(paths, title) {
      const spaceID = getter().activeSpaceID
      if (!spaceID) return false
      setter({ isPublishing: true, error: null })
      try {
        await POST_KNOWLEDGE_MERGE(spaceID, paths, title)
        await getter().refresh()
        setter({ isPublishing: false })
        return true
      } catch (error) {
        reportCaught('spaces.merge', error, 'warning')
        setter({ isPublishing: false, error: toErrorMessage(error) })
        return false
      }
    },

    async exportBundle() {
      const spaceID = getter().activeSpaceID
      if (!spaceID) return
      try {
        const path = await bundleExport(spaceID)
        toast.success('已导出：' + path)
      } catch (error) {
        reportCaught('spaces.exportBundle', error)
        toast.error(toErrorMessage(error))
      }
    },

    async migrateLayout(dryRun) {
      const spaceID = getter().activeSpaceID
      if (!spaceID) return null
      try {
        const report = await POST_KNOWLEDGE_MIGRATE_LAYOUT(spaceID, dryRun)
        if (!dryRun) {
          await fetchDocsAndStaging(spaceID)
          toast.success(
            report.moves.length > 0
              ? `已归位 ${report.moves.length} 页`
              : '没有需要归位的页面'
          )
        }
        return report
      } catch (error) {
        reportCaught('spaces.migrateLayout', error, 'warning')
        setter({ error: toErrorMessage(error) })
        toast.error(toErrorMessage(error))
        return null
      }
    },

    async rebuildIndex() {
      const spaceID = getter().activeSpaceID
      if (!spaceID) return
      try {
        const count = await POST_KNOWLEDGE_REBUILD_INDEX(spaceID)
        setter({ docs: await GET_KNOWLEDGE_DOCS(spaceID) })
        toast.success(`已重建索引（${count} 页）`)
      } catch (error) {
        reportCaught('spaces.rebuildIndex', error, 'warning')
        toast.error(toErrorMessage(error))
      }
    }
  }
})

export { useSpacesStore }
