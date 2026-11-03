/**
 * 左栏 · 检索：FTS±向量 RRF + 图片命中区。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { ScrollArea } from '@cogito/design/components/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Spinner } from '@cogito/design/components/spinner'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { useEffect, useState } from 'react'

import { joinPath } from '@/views/knowledge/lib/path.ts'
import {
  findImageHitsFromMarkdown,
  type ImageHit
} from '@/views/knowledge/lib/search-hybrid.ts'
import { useDocsTab } from '@/views/knowledge/surface/use-docs-tab.ts'

function SearchTab() {
  const state = useDocsTab()
  const [imageHits, setImageHits] = useState<ImageHit[]>([])

  useEffect(
    function () {
      if (!state.query.trim() || !state.activeBase) {
        setImageHits([])
        return
      }
      let cancelled = false
      void (async function () {
        const pages: { relPath: string; content: string }[] = []
        for (const doc of state.docs.slice(0, 80)) {
          if (!/\.md$/i.test(doc.relPath)) continue
          try {
            const content = await readTextFile(joinPath(state.activeBase!.rootPath, doc.relPath))
            pages.push({ relPath: doc.relPath, content })
          } catch (error) {
            console.warn('[search] image scan skip', doc.relPath, error)
          }
        }
        if (cancelled) return
        setImageHits(findImageHitsFromMarkdown(pages, state.query).slice(0, 12))
      })()
      return function () {
        cancelled = true
      }
    },
    [state.query, state.activeBase, state.docs, state.hits.length]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <Select
        value={state.activeBaseID ?? undefined}
        onValueChange={function (value) {
          if (typeof value === 'string') void state.selectBase(value)
        }}>
        <SelectTrigger
          size="sm"
          className="min-w-0">
          <SelectValue placeholder="选择知识库" />
        </SelectTrigger>
        <SelectContent>
          {state.bases.map(function (base) {
            return (
              <SelectItem
                key={base.id}
                value={base.id}>
                {base.name}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>

      <form
        className="flex items-center gap-1"
        onSubmit={function (event) {
          event.preventDefault()
          void state.runSearch()
        }}>
        <Input
          value={state.query}
          placeholder="搜索标题与正文…"
          className="h-7 flex-1 text-xs"
          onChange={function (event) {
            state.writeQuery(event.target.value)
          }}
        />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          disabled={state.isLoading || !state.query.trim()}
          title="搜索">
          {state.isLoading ? (
            <Spinner className="size-3.5" />
          ) : (
            <Icon
              icon="lucide:search"
              className="size-3.5"
            />
          )}
        </Button>
        {state.query || state.hits.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            title="清空"
            onClick={function () {
              state.clearSearch()
              setImageHits([])
            }}>
            <Icon
              icon="lucide:x"
              className="size-3.5"
            />
          </Button>
        ) : null}
      </form>

      {state.error ? (
        <p className="px-1 text-xs text-destructive">{state.error}</p>
      ) : null}

      <ScrollArea className="min-h-0 flex-1">
        {imageHits.length > 0 ? (
          <div className="mb-2">
            <p className="text-muted-foreground mb-1 px-1 text-[11px] font-medium">
              图片命中 {imageHits.length}
            </p>
            <ul className="flex flex-col gap-0.5">
              {imageHits.map(function (hit) {
                return (
                  <li key={`${hit.docId}-${hit.src}`}>
                    <Button
                      variant="ghost"
                      type="button"
                      className="h-auto w-full rounded-md px-1.5 py-1 text-left hover:bg-muted"
                      onClick={function () {
                        void state.openDoc(hit.docId)
                      }}>
                      <span className="block truncate text-xs">{hit.alt}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {hit.docId} · {hit.src}
                      </span>
                    </Button>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}

        {state.hits.length === 0 && !state.isLoading ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            {state.query.trim() ? '无命中' : '输入关键词后回车搜索'}
          </p>
        ) : null}
        <ul className="flex flex-col gap-0.5">
          {state.hits.map(function (hit) {
            return (
              <li key={hit.docId}>
                <Button
                  variant="ghost"
                  type="button"
                  className="h-auto w-full rounded-md px-1.5 py-1 text-left hover:bg-muted"
                  onClick={function () {
                    void state.openDoc(hit.relPath)
                  }}>
                  <span className="block truncate text-xs">{hit.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {hit.snippet}
                  </span>
                </Button>
              </li>
            )
          })}
        </ul>
      </ScrollArea>
    </div>
  )
}

export { SearchTab }
