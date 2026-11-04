/**
 * Deep Research 右栏侧板：主题 → 真搜索 → 写入 raw/sources 并入队。
 * 对齐 llm_wiki ResearchPanel（非主区全宽）。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { ScrollArea } from '@cogito/design/components/scroll-area'
import { Textarea } from '@cogito/design/components/textarea'
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
  const queries = [topic, `${topic} overview`, `${topic} key concepts`]
  const draft: ResearchDraft = {
    id: `research-${Date.now()}`,
    topic: topic.trim(),
    queries,
    createdAt: Date.now()
  }
  writeDrafts([draft, ...readDrafts()].slice(0, 20))
  useSurfaceStore.getState().toSetResearchOpen(true)
}

function ResearchPanel(props: { embedded?: boolean } = {}) {
  const embedded = Boolean(props.embedded)
  const toSetResearchOpen = useSurfaceStore(function (state) {
    return state.toSetResearchOpen
  })
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
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      {embedded ? (
        <div className="text-muted-foreground border-border flex shrink-0 items-center justify-between gap-2 border-b px-2.5 py-1.5 text-[11px]">
          <span>主题 → 查询 → Web / AnyTXT</span>
          <span className="border-border bg-background/60 shrink-0 rounded-full border px-1.5 py-px text-[10px] tabular-nums">
            {drafts.length} 草稿
          </span>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-2.5 py-1.5">
          <Icon
            icon="lucide:microscope"
            className="text-muted-foreground size-4 shrink-0"
          />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">深度研究</span>
          <span className="text-muted-foreground text-[10px] tabular-nums">{drafts.length}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-1.5"
            title="关闭"
            onClick={function () {
              toSetResearchOpen(false)
            }}>
            <Icon
              icon="lucide:x"
              className="size-3.5"
            />
          </Button>
        </div>
      )}

      <div className="border-border flex shrink-0 flex-col gap-2 border-b px-2.5 py-2.5">
        <div className="flex flex-col gap-1.5">
          <label className="text-muted-foreground text-xs font-medium">研究主题</label>
          <Input
            className="h-8 text-xs"
            placeholder="例如：LanceDB 向量检索"
            value={topic}
            onChange={function (event) {
              setTopic(event.target.value)
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-muted-foreground text-xs font-medium">搜索查询（每行一条）</label>
          <Textarea
            className="min-h-16 text-xs"
            placeholder={'LanceDB overview\nLanceDB vs sqlite-vec'}
            value={queryText}
            onChange={function (event) {
              setQueryText(event.target.value)
            }}
          />
        </div>
        <Button
          size="sm"
          className="h-8 w-full text-xs font-medium"
          disabled={!topic.trim() || !queryText.trim()}
          onClick={saveDraft}>
          保存主题
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1.5 p-2 pb-4">
          {drafts.length === 0 ? (
            <p className="text-muted-foreground px-1 py-6 text-center text-[11px] leading-relaxed">
              填写主题与查询后保存；也可从图谱 Insights 一键转入。
            </p>
          ) : (
            drafts.map(function (draft) {
              return (
                <div
                  key={draft.id}
                  className="border-border/70 bg-card rounded-lg border px-2.5 py-2">
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{draft.topic}</p>
                      <p className="text-muted-foreground mt-0.5 text-[10px]">
                        {draft.queries.length} 条 ·{' '}
                        {new Date(draft.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-6 shrink-0 px-2 text-[10px]"
                      disabled={busyId === draft.id}
                      onClick={function () {
                        void enqueueDraft(draft)
                      }}>
                      {busyId === draft.id ? '…' : '检索'}
                    </Button>
                  </div>
                  <ul className="text-muted-foreground mt-1 space-y-0.5 text-[10px]">
                    {draft.queries.slice(0, 3).map(function (query) {
                      return (
                        <li
                          key={query}
                          className="truncate">
                          · {query}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

/** @deprecated 用 ResearchPanel；保留别名避免旧 import 断裂 */
const ResearchTab = ResearchPanel

export { ResearchPanel, ResearchTab, enqueueResearchTopic }
