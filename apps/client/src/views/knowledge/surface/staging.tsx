/**
 * 待发布区：agent 写入的 staging 草稿在这里由用户确认发布。
 *
 * 一页一概念是默认语义：批量发布 = 每页各自成页（后端按 type 落 `wiki/<type>/`）。
 * 需要「一篇长文」时才勾选多页合并 —— 合并结果仍留在待发布区，发布仍要再确认。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Checkbox } from '@cogito/design/components/checkbox'
import { Input } from '@cogito/design/components/input'
import { ScrollArea } from '@cogito/design/components/scroll-area'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { cn } from 'cn'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useSpacesStore } from '@/stores/spaces'
import { GET_KNOWLEDGE_WIKI_CONTRACT } from '@/apis/knowledge'
import { formatSize, formatTime } from '@/views/knowledge/lib/format.ts'
import { parseMarkdown } from '@/views/knowledge/lib/parse-markdown.ts'
import {
  ToolEmpty,
  ToolPageHeader,
  ToolStatPill,
  ToolTag,
  ToolToolbar
} from '@/views/knowledge/surface/tool-surface.tsx'

const TYPE_FALLBACK = '未分类'

/**
 * 预览只读 HTML 去活：marked 会原样保留内联 HTML，模型产物里若夹了
 * `<script>` / `on*=` 不应在预览里执行。
 */
function toSafePreviewHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
}

function StagingTab() {
  const staging = useSpacesStore(function (state) {
    return state.staging
  })
  const refresh = useSpacesStore(function (state) {
    return state.refresh
  })
  const publish = useSpacesStore(function (state) {
    return state.publish
  })
  const publishMany = useSpacesStore(function (state) {
    return state.publishMany
  })
  const discard = useSpacesStore(function (state) {
    return state.discard
  })
  const merge = useSpacesStore(function (state) {
    return state.merge
  })

  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [mergeTitle, setMergeTitle] = useState('')
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [previewHtml, setPreviewHtml] = useState('')
  const [isPreviewLoading, setPreviewLoading] = useState(false)
  const [typeLabels, setTypeLabels] = useState<Record<string, string>>({})

  useEffect(
    function () {
      void refresh()
    },
    [refresh]
  )

  // 类型标签以 Rust 契约为准（`knowledge:wikiContract`），前端不再维护一份
  useEffect(
    function () {
      void GET_KNOWLEDGE_WIKI_CONTRACT()
        .then(function (contract) {
          const labels: Record<string, string> = {}
          for (const item of contract.types) labels[item.name] = item.label
          setTypeLabels(labels)
        })
        .catch(function (error: unknown) {
          console.warn('[staging] 读取规范失败', error)
        })
    },
    []
  )

  // 草稿被发布/丢弃后，残留的勾选要跟着清掉
  useEffect(
    function () {
      setSelected(function (current) {
        const alive = new Set(
          staging.map(function (file) {
            return file.path
          })
        )
        const next: Record<string, boolean> = {}
        for (const path of Object.keys(current)) {
          if (current[path] && alive.has(path)) next[path] = true
        }
        // 引用不变就不触发重渲染（每次 staging 更新都返回新对象等于白渲染一轮）
        const currentKeys = Object.keys(current).filter(function (path) {
          return current[path]
        })
        const nextKeys = Object.keys(next)
        const isSame =
          currentKeys.length === nextKeys.length &&
          nextKeys.every(function (path) {
            return current[path]
          })
        return isSame ? current : next
      })
      setPreviewPath(function (current) {
        if (!current) return null
        return staging.some(function (file) {
          return file.path === current
        })
          ? current
          : null
      })
    },
    [staging]
  )

  const groups = useMemo(
    function () {
      const map = new Map<string, typeof staging>()
      for (const file of staging) {
        const bucket = map.get(file.session) ?? []
        bucket.push(file)
        map.set(file.session, bucket)
      }
      return Array.from(map.entries())
    },
    [staging]
  )

  const chosen = useMemo(
    function () {
      return staging.filter(function (file) {
        return selected[file.path]
      })
    },
    [staging, selected]
  )

  function toggle(path: string, checked: boolean) {
    setSelected(function (current) {
      const next = { ...current }
      if (checked) next[path] = true
      else delete next[path]
      return next
    })
  }

  function selectAll() {
    const next: Record<string, boolean> = {}
    for (const file of staging) next[file.path] = true
    setSelected(next)
  }

  function clearSelection() {
    setSelected({})
    setMergeTitle('')
  }

  async function togglePreview(path: string) {
    if (previewPath === path) {
      setPreviewPath(null)
      return
    }
    setPreviewPath(path)
    setPreviewLoading(true)
    try {
      const raw = await readTextFile(path)
      setPreviewHtml(toSafePreviewHtml(parseMarkdown(raw).html))
    } catch (error) {
      console.warn('[staging] 读取草稿失败', error)
      setPreviewHtml('')
      toast.error('读取草稿失败')
    } finally {
      setPreviewLoading(false)
    }
  }

  async function publishChosen() {
    if (chosen.length === 0) return
    await publishMany(chosen, 'replace')
    clearSelection()
  }

  async function mergeChosen() {
    const title = mergeTitle.trim()
    if (chosen.length < 2) {
      toast.warning('至少勾选 2 页才能合并')
      return
    }
    if (!title) {
      toast.warning('给合并后的页面起个标题')
      return
    }
    const ok = await merge(
      chosen.map(function (file) {
        return file.path
      }),
      title
    )
    if (ok) clearSelection()
  }

  async function discardChosen() {
    for (const file of chosen) {
      await discard(file)
    }
    clearSelection()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ToolPageHeader
        title="待发布"
        description="agent 写入的 wiki 页先落在待发布区；发布后按 type 归位到 wiki/<type>/，并维护 index / log / overview。"
        meta={
          <>
            <ToolStatPill
              label="草稿"
              value={staging.length}
            />
            {chosen.length > 0 ? (
              <ToolStatPill
                label="已选"
                value={chosen.length}
                tone="accent"
              />
            ) : null}
          </>
        }
        actions={
          <>
            <Button
              variant="ghost"
              type="button"
              disabled={staging.length === 0}
              onClick={selectAll}>
              全选
            </Button>
            <Button
              variant="ghost"
              type="button"
              disabled={chosen.length === 0}
              onClick={clearSelection}>
              取消选择
            </Button>
            <Button
              variant="outline"
              type="button"
              disabled={chosen.length === 0}
              onClick={function () {
                void discardChosen()
              }}>
              丢弃选中
            </Button>
            <Button
              type="button"
              disabled={chosen.length === 0}
              onClick={function () {
                void publishChosen()
              }}>
              发布选中{chosen.length > 0 ? `（${chosen.length}）` : ''}
            </Button>
          </>
        }
      />

      {chosen.length >= 2 ? (
        <ToolToolbar className="items-center">
          <span className="text-muted-foreground text-xs">合并为一篇：</span>
          <Input
            value={mergeTitle}
            placeholder="合并后的标题"
            className="h-8 max-w-64"
            onChange={function (event) {
              setMergeTitle(event.target.value)
            }}
          />
          <Button
            variant="outline"
            type="button"
            onClick={function () {
              void mergeChosen()
            }}>
            合并
          </Button>
          <span className="text-muted-foreground text-xs">
            合并结果仍留在待发布区，需再确认发布
          </span>
        </ToolToolbar>
      ) : null}

      {staging.length === 0 ? (
        <ToolEmpty
          icon="lucide:inbox"
          title="没有待发布草稿"
          description="让 agent 写页，或从编辑器里保存后主动发布；草稿会显示在这里等你确认。"
        />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-4 pb-6">
            {groups.map(function ([session, files]) {
              return (
                <section
                  key={session}
                  className="flex flex-col gap-1.5">
                  <div className="text-muted-foreground flex items-center gap-1.5 px-1 text-xs">
                    <Icon
                      icon="lucide:user-round"
                      className="size-3.5 opacity-70"
                    />
                    <span className="font-medium">{session}</span>
                    <span className="opacity-70">· {files.length}</span>
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {files.map(function (file) {
                      const title = file.title || file.name
                      const typeLabel =
                        typeLabels[file.pageType ?? ''] ?? file.pageType ?? TYPE_FALLBACK
                      const isOpen = previewPath === file.path
                      return (
                        <li
                          key={file.path}
                          className={cn(
                            'border-border/70 bg-card rounded-lg border transition-colors',
                            selected[file.path] && 'border-primary/40 bg-primary/[0.03]'
                          )}>
                          <div className="flex items-center gap-2.5 px-3 py-2.5">
                            <Checkbox
                              aria-label="选择草稿"
                              checked={Boolean(selected[file.path])}
                              onCheckedChange={function (checked) {
                                toggle(file.path, Boolean(checked))
                              }}
                            />
                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left outline-none"
                              onClick={function () {
                                void togglePreview(file.path)
                              }}>
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate text-sm font-medium">{title}</span>
                                <ToolTag>{typeLabel}</ToolTag>
                              </span>
                              <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                                {file.relPath ?? file.path} · {formatSize(file.size)} ·{' '}
                                {formatTime(file.modifiedAt)}
                              </span>
                            </button>
                            <Button
                              size="sm"
                              variant="outline"
                              type="button"
                              onClick={function () {
                                void publish(file, 'replace')
                              }}>
                              发布
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              type="button"
                              aria-label="丢弃草稿"
                              onClick={function () {
                                void discard(file)
                              }}>
                              <Icon
                                icon="lucide:trash-2"
                                className="size-4"
                              />
                            </Button>
                          </div>
                          {isOpen ? (
                            <div className="border-border/60 border-t px-3 py-3">
                              {isPreviewLoading ? (
                                <p className="text-muted-foreground text-xs">读取中…</p>
                              ) : (
                                <div
                                  className={cn(
                                    'text-foreground text-sm leading-7',
                                    '[&_h1]:mt-3 [&_h1]:text-lg [&_h1]:font-semibold',
                                    '[&_h2]:mt-4 [&_h2]:text-space [&_h2]:font-semibold',
                                    '[&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold',
                                    '[&_li]:ml-5 [&_li]:list-disc',
                                    '[&_pre]:bg-muted [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:text-xs',
                                    '[&_code]:text-xs'
                                  )}
                                  // 草稿是用户自己的 Markdown，预览按只读 HTML 渲染
                                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                                />
                              )}
                            </div>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

export { StagingTab }
