/**
 * 检索主视图：FTS ± 向量 RRF + 图片命中。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { ScrollArea } from '@cogito/design/components/scroll-area'
import { Spinner } from '@cogito/design/components/spinner'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { useEffect, useState } from 'react'

import { joinPath } from '@/views/knowledge/lib/path.ts'
import {
  collectMarkdownImages,
  filterImageHits,
  type ImageHit,
  type MarkdownImage
} from '@/views/knowledge/lib/search-hybrid.ts'
import { SpaceCombobox } from '@/views/knowledge/surface/space-combobox.tsx'
import { useDocsTab } from '@/views/knowledge/surface/use-docs-tab.ts'
import {
  ToolEmpty,
  ToolListCard,
  ToolPageHeader,
  ToolStatPill
} from '@/views/knowledge/surface/tool-surface.tsx'

/**
 * 图片索引按「docs 数组版本」缓存：store 每次刷新都会换一个新数组，WeakMap 自动失效。
 * 以前是每敲一个键就把最多 80 篇 Markdown 串行读盘 + 全文正则；现在整库只在 docs
 * 变化时读一次，查询阶段纯内存匹配。
 */
const imageIndexCache = new WeakMap<object, Promise<MarkdownImage[]>>()

function readImageIndex(
  rootPath: string,
  docs: { relPath: string }[]
): Promise<MarkdownImage[]> {
  const cached = imageIndexCache.get(docs)
  if (cached) return cached
  const task = (async function () {
    const images: MarkdownImage[] = []
    for (const doc of docs) {
      if (!/\.md$/i.test(doc.relPath)) continue
      try {
        const content = await readTextFile(joinPath(rootPath, doc.relPath))
        images.push(...collectMarkdownImages(content, doc.relPath))
      } catch (error) {
        console.warn('[search] image scan skip', doc.relPath, error)
      }
    }
    return images
  })()
  imageIndexCache.set(docs, task)
  // 失败不进缓存：下次 docs / 空间变化时重试
  void task.catch(function () {
    imageIndexCache.delete(docs)
  })
  return task
}

/** 输入防抖窗口：与编辑器的派生窗口对齐 */
const QUERY_DELAY_MS = 300

function SearchTab() {
  const state = useDocsTab()
  const [imageHits, setImageHits] = useState<ImageHit[]>([])

  useEffect(
    function () {
      const query = state.query.trim()
      const space = state.activeSpace
      if (!query || !space) {
        setImageHits([])
        return
      }
      let cancelled = false
      const timer = window.setTimeout(function () {
        void readImageIndex(space.rootPath, state.docs)
          .then(function (images) {
            if (cancelled) return
            setImageHits(filterImageHits(images, query).slice(0, 12))
          })
          .catch(function (error: unknown) {
            console.warn('[search] image index failed', error)
          })
      }, QUERY_DELAY_MS)
      return function () {
        cancelled = true
        window.clearTimeout(timer)
      }
      // hits.length 不进依赖：以前回车搜索完成会再跑一遍整个读盘流程
    },
    [state.query, state.activeSpace, state.docs]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ToolPageHeader
        title="检索"
        description="全文检索标题与正文；可选向量与图片 alt 命中。"
        meta={
          state.hits.length > 0 || imageHits.length > 0 ? (
            <>
              <ToolStatPill
                label="文档"
                value={state.hits.length}
                tone="accent"
              />
              {imageHits.length > 0 ? (
                <ToolStatPill
                  label="图片"
                  value={imageHits.length}
                />
              ) : null}
            </>
          ) : undefined
        }
        actions={
          <SpaceCombobox
            spaces={state.spaces}
            value={state.activeSpaceID ?? null}
            className="w-44 shrink-0"
            onValueChange={function (spaceID) {
              void state.selectSpace(spaceID)
            }}
          />
        }
      />

      <form
        className="mb-4 flex items-center gap-2"
        onSubmit={function (event) {
          event.preventDefault()
          void state.runSearch()
        }}>
        <div className="relative min-w-0 flex-1">
          <Icon
            icon="lucide:search"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
          />
          <Input
            value={state.query}
            placeholder="搜索标题与正文，回车执行…"
            className="h-9 pl-8 text-sm"
            onChange={function (event) {
              state.writeQuery(event.target.value)
            }}
          />
        </div>
        <Button
          type="submit"
          size="sm"
          className="h-9 px-3"
          disabled={state.isLoading || !state.query.trim()}>
          {state.isLoading ? <Spinner className="size-3.5" /> : '搜索'}
        </Button>
        {state.query || state.hits.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-9"
            onClick={function () {
              state.clearSearch()
              setImageHits([])
            }}>
            清空
          </Button>
        ) : null}
      </form>

      {state.error ? (
        <p className="text-destructive mb-2 text-xs">{state.error}</p>
      ) : null}

      <ScrollArea className="min-h-0 flex-1">
        {imageHits.length > 0 ? (
          <section className="mb-4">
            <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
              图片命中
            </p>
            <ul className="flex flex-col gap-1.5">
              {imageHits.map(function (hit) {
                return (
                  <li key={`${hit.docId}-${hit.src}`}>
                    <ToolListCard
                      onClick={function () {
                        void state.openDoc(hit.docId)
                      }}>
                      <p className="truncate text-sm font-medium">{hit.alt || '（无 alt）'}</p>
                      <p className="text-muted-foreground mt-1 truncate text-xs">
                        {hit.docId} · {hit.src}
                      </p>
                    </ToolListCard>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}

        {state.hits.length === 0 && !state.isLoading ? (
          <ToolEmpty
            icon="lucide:search"
            title={state.query.trim() ? '无命中' : '开始检索'}
            description={
              state.query.trim()
                ? '换个关键词，或检查 Embedding / FTS 是否已索引。'
                : '输入关键词后回车；命中结果会在此列出。'
            }
          />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {state.hits.map(function (hit) {
              return (
                <li key={hit.docId}>
                  <ToolListCard
                    onClick={function () {
                      void state.openDoc(hit.relPath)
                    }}>
                    <p className="truncate text-sm font-medium">{hit.title}</p>
                    <p className="text-muted-foreground mt-1 line-clamp-2 text-sm leading-6">
                      {hit.snippet}
                    </p>
                  </ToolListCard>
                </li>
              )
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  )
}

export { SearchTab }
