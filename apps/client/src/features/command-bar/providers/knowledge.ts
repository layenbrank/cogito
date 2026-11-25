/**
 * 知识库 provider：当前空间的全部文档 + 最近打开的路径（去重）。
 *
 * 只列 `recentPaths` 等于「用过的才搜得到」，而 Obsidian / 语雀的快速切换都是全库标题搜索，
 * 所以这里以空间文档为主、最近打开补在末尾。
 */
import { OMNIBAR_UI } from '@/features/command-bar/constants'
import { openComponentRoute } from '@/features/command-bar/open-route'
import type { Hit, SearchProvider } from '@/features/command-bar/types'
import { uniqueBy } from '@/features/command-bar/unique'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useSpacesStore } from '@/stores/spaces'
import { joinPath } from '@/views/knowledge/lib/path.ts'
import { openSpaceDoc } from '@/views/knowledge/lib/open-space-doc.ts'

interface DocCandidate {
  /** 去重与命中 id 都用绝对路径 */
  absolute: string
  title: string
  subtitle: string
  /** 空串表示只来自最近打开、没有空间相对路径 */
  relPath: string
}

function findFileName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

function collectSpaceDocs(): DocCandidate[] {
  const state = useSpacesStore.getState()
  const space = state.spaces.find(function (item) {
    return item.id === state.activeSpaceID
  })
  if (!space) return []
  return state.docs.map(function (doc) {
    return {
      absolute: joinPath(space.rootPath, doc.relPath),
      title: doc.title || findFileName(doc.relPath),
      subtitle: doc.relPath,
      relPath: doc.relPath
    }
  })
}

function collectRecentDocs(): DocCandidate[] {
  return (useKnowledgeStore.getState().recentPaths ?? []).map(function (path) {
    return {
      absolute: path,
      title: findFileName(path),
      subtitle: path,
      relPath: ''
    }
  })
}

/** 完全命中 > 前缀命中 > 包含命中；同档按标题字典序，排序稳定 */
function scoreOf(title: string, query: string): number {
  if (!query) return 1
  const lowered = title.toLowerCase()
  if (lowered === query) return 3
  if (lowered.startsWith(query)) return 2
  return 1
}

async function openDocByPath(path: string): Promise<void> {
  useKnowledgeStore.getState().toBeginOpen(path)
  await openComponentRoute('knowledge', {
    path: `/knowledge?path=${encodeURIComponent(path)}`
  })
}

function searchKnowledge(query: string): Hit[] {
  const normalized = query.trim().toLowerCase()
  const merged = uniqueBy([...collectSpaceDocs(), ...collectRecentDocs()], function (doc) {
    return doc.absolute.replace(/\\/g, '/').toLowerCase()
  })
  const matched = normalized
    ? merged.filter(function (doc) {
        return (
          doc.title.toLowerCase().includes(normalized) ||
          doc.subtitle.toLowerCase().includes(normalized)
        )
      })
    : merged

  return matched
    .slice()
    .sort(function (left, right) {
      const delta = scoreOf(right.title, normalized) - scoreOf(left.title, normalized)
      return delta !== 0 ? delta : left.title.localeCompare(right.title)
    })
    .slice(0, OMNIBAR_UI.LOCAL_LIMIT)
    .map(function (doc) {
      return {
        domain: 'knowledge' as const,
        id: doc.absolute,
        title: doc.title,
        subtitle: doc.subtitle,
        score: scoreOf(doc.title, normalized),
        icon: 'lucide:notebook-pen',
        async run() {
          if (doc.relPath && openSpaceDoc(doc.relPath)) return
          await openDocByPath(doc.absolute)
        }
      }
    })
}

const knowledgeProvider: SearchProvider = {
  domain: 'knowledge',
  search(query) {
    return searchKnowledge(query)
  }
}

export { knowledgeProvider }
