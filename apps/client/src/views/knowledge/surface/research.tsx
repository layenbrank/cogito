/**
 * Deep Research：主题 → 真搜索（web-search-config）→ 写入 raw/sources 并入队。
 */
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { ScrollArea } from '@cogito/design/components/scroll-area'
import { exists, mkdir, writeTextFile } from '@tauri-apps/plugin-fs'
import { useState } from 'react'
import { toast } from 'sonner'

import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { useIngestQueueStore } from '@/views/knowledge/lib/ingest-queue.ts'
import { joinPath } from '@/views/knowledge/lib/path.ts'
import { readAnyTxtConfig } from '@/views/knowledge/lib/anytxt-config.ts'
import { anyTxtSearch } from '@/views/knowledge/lib/anytxt-search.ts'
import { readWebSearchConfig } from '@/views/knowledge/lib/web-search-config.ts'
import { runWebSearch } from '@/views/knowledge/lib/web-search.ts'
import { useSurfaceStore } from '@/views/knowledge/surface/store.ts'

const RESEARCH_KEY = 'knowledge.research.drafts'

interface ResearchDraft {
  id: string
  topic: string
  queries: string[]
  createdAt: number
}

function readDrafts(): ResearchDraft[] {
  try {
    const raw = localStorage.getItem(RESEARCH_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ResearchDraft[]
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    console.warn('[research] read failed', error)
    return []
  }
}

function writeDrafts(drafts: ResearchDraft[]): void {
  try {
    localStorage.setItem(RESEARCH_KEY, JSON.stringify(drafts))
  } catch (error) {
    console.warn('[research] write failed', error)
  }
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || `q-${Date.now()}`
  )
}

function enqueueResearchTopic(topic: string): void {
  const queries = [
    topic,
    `${topic} overview`,
    `${topic} key concepts`
  ]
  const draft: ResearchDraft = {
    id: `research-${Date.now()}`,
    topic: topic.trim(),
    queries,
    createdAt: Date.now()
  }
  writeDrafts([draft, ...readDrafts()].slice(0, 20))
  useSurfaceStore.getState().toOpen('research')
}

function ResearchTab() {
  const enqueue = useIngestQueueStore(function (state) {
    return state.enqueue
  })
  const bases = useKnowledgeBaseStore(function (state) {
    return state.bases
  })
  const activeBaseID = useKnowledgeBaseStore(function (state) {
    return state.activeBaseID
  })
  const [topic, setTopic] = useState('')
  const [queryText, setQueryText] = useState('')
  const [drafts, setDrafts] = useState<ResearchDraft[]>(function () {
    return readDrafts()
  })
  const [busyId, setBusyId] = useState<string | null>(null)

  function saveDraft() {
    const queries = queryText
      .split('\n')
      .map(function (line) {
        return line.trim()
      })
      .filter(Boolean)
    if (!topic.trim() || queries.length === 0) return
    const draft: ResearchDraft = {
      id: `research-${Date.now()}`,
      topic: topic.trim(),
      queries,
      createdAt: Date.now()
    }
    const next = [draft, ...drafts].slice(0, 20)
    setDrafts(next)
    writeDrafts(next)
    setTopic('')
    setQueryText('')
  }

  async function enqueueDraft(draft: ResearchDraft) {
    const base = bases.find(function (item) {
      return item.id === activeBaseID
    })
    if (!base?.rootPath) {
      toast.error('无活动知识库')
      return
    }
    setBusyId(draft.id)
    const searchConfig = readWebSearchConfig()
    try {
      const dirRel = `raw/sources/research/${draft.id}`
      const dirAbs = joinPath(base.rootPath, dirRel)
      if (!(await exists(dirAbs))) {
        await mkdir(dirAbs, { recursive: true })
      }
      for (const query of draft.queries) {
        const sections: string[] = []
        if (searchConfig.provider !== 'none') {
          try {
            const hits = await runWebSearch(query)
            sections.push(
              '## Web\n\n' +
                hits
                  .map(function (hit) {
                    return `### [${hit.title}](${hit.url})\n\n${hit.snippet}\n`
                  })
                  .join('\n')
            )
          } catch (searchError) {
            console.error('[research] web search failed', query, searchError)
            sections.push(
              `## Web\n\n> 搜索失败：${searchError instanceof Error ? searchError.message : String(searchError)}\n`
            )
          }
        }
        const anytxt = readAnyTxtConfig()
        if (anytxt.enabled) {
          try {
            const hits = await anyTxtSearch(query)
            sections.push(
              '## AnyTXT\n\n' +
                hits
                  .map(function (hit) {
                    return `### [${hit.title}](${hit.url})\n\n${hit.snippet || hit.path}\n`
                  })
                  .join('\n')
            )
          } catch (anytxtError) {
            console.error('[research] anytxt failed', query, anytxtError)
            sections.push(
              `## AnyTXT\n\n> 失败：${anytxtError instanceof Error ? anytxtError.message : String(anytxtError)}\n`
            )
          }
        }
        const hitsBlock =
          sections.length > 0
            ? sections.join('\n')
            : '> 未配置网页搜索 / AnyTXT；仅写入查询占位。\n'
        const fileRel = `${dirRel}/${slugify(query)}.md`
        const body = `---
title: ${JSON.stringify(query)}
topic: ${JSON.stringify(draft.topic)}
type: research-query
---

# ${query}

> 主题：${draft.topic}

${hitsBlock}
`
        await writeTextFile(joinPath(base.rootPath, fileRel), body)
        if (searchConfig.autoIngest) {
          enqueue(fileRel)
        }
      }
      toast.success('已写入 research 源并入队')
    } catch (error) {
      console.error('[research] enqueue failed', error)
      toast.error(error instanceof Error ? error.message : '写入失败')
    } finally {
      setBusyId(null)
      setDrafts(readDrafts())
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Input
        className="h-7 text-xs"
        placeholder="研究主题"
        value={topic}
        onChange={function (event) {
          setTopic(event.target.value)
        }}
      />
      <textarea
        className="border-input bg-background min-h-24 rounded-md border px-2 py-1 text-xs"
        placeholder="搜索查询（每行一条）"
        value={queryText}
        onChange={function (event) {
          setQueryText(event.target.value)
        }}
      />
      <Button
        size="sm"
        onClick={saveDraft}>
        保存主题
      </Button>
      <ScrollArea className="min-h-0 flex-1">
        <ul className="flex flex-col gap-1">
          {drafts.map(function (draft) {
            return (
              <li
                key={draft.id}
                className="rounded-md border border-border px-2 py-1.5 text-xs">
                <p className="font-medium">{draft.topic}</p>
                <p className="text-muted-foreground">{draft.queries.length} 条查询</p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1 h-6 px-1.5 text-[11px]"
                  disabled={busyId === draft.id}
                  onClick={function () {
                    void enqueueDraft(draft)
                  }}>
                  {busyId === draft.id ? '搜索写入中…' : '搜索写入 raw 并 ingest'}
                </Button>
              </li>
            )
          })}
        </ul>
      </ScrollArea>
    </div>
  )
}

export { ResearchTab, enqueueResearchTopic }
