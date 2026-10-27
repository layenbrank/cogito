/**
 * 知识库面板：库切换 / 文档列表 / 检索 / 待发布草稿。
 *
 * 定位：**唯一**能看到并确认 staging 草稿的地方。agent 只能写 staging，
 * 用户在这里选「覆盖同名」或「保留两者」才会写进正式目录与数据库。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { ScrollArea } from '@cogito/design/components/scroll-area'
import { Separator } from '@cogito/design/components/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle
} from '@cogito/design/components/sheet'
import { Spinner } from '@cogito/design/components/spinner'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { openPath } from '@/views/knowledge/lib/session.ts'

function joinPath(root: string, relative: string): string {
  const base = root.replace(/[\\/]+$/, '')
  return `${base}/${relative.replace(/^[\\/]+/, '')}`
}

function formatTime(ms: number): string {
  if (!ms) return ''
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(ms))
  } catch (error) {
    console.warn('[knowledge-hub] 时间格式化失败:', error)
    return ''
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

interface KnowledgeHubProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function KnowledgeHub(props: KnowledgeHubProps) {
  const bases = useKnowledgeBaseStore(function (state) {
    return state.bases
  })
  const activeBaseID = useKnowledgeBaseStore(function (state) {
    return state.activeBaseID
  })
  const docs = useKnowledgeBaseStore(function (state) {
    return state.docs
  })
  const hits = useKnowledgeBaseStore(function (state) {
    return state.hits
  })
  const staging = useKnowledgeBaseStore(function (state) {
    return state.staging
  })
  const query = useKnowledgeBaseStore(function (state) {
    return state.query
  })
  const isLoading = useKnowledgeBaseStore(function (state) {
    return state.isLoading
  })
  const isPublishing = useKnowledgeBaseStore(function (state) {
    return state.isPublishing
  })
  const error = useKnowledgeBaseStore(function (state) {
    return state.error
  })
  const refresh = useKnowledgeBaseStore(function (state) {
    return state.refresh
  })
  const selectBase = useKnowledgeBaseStore(function (state) {
    return state.selectBase
  })
  const setQuery = useKnowledgeBaseStore(function (state) {
    return state.setQuery
  })
  const runSearch = useKnowledgeBaseStore(function (state) {
    return state.runSearch
  })
  const clearSearch = useKnowledgeBaseStore(function (state) {
    return state.clearSearch
  })
  const create = useKnowledgeBaseStore(function (state) {
    return state.create
  })
  const rescan = useKnowledgeBaseStore(function (state) {
    return state.rescan
  })
  const publish = useKnowledgeBaseStore(function (state) {
    return state.publish
  })
  const discard = useKnowledgeBaseStore(function (state) {
    return state.discard
  })
  const [newName, setNewName] = useState('')

  useEffect(
    function () {
      if (!props.open) return
      void refresh()
    },
    [props.open, refresh]
  )

  const activeBase = bases.find(function (base) {
    return base.id === activeBaseID
  })

  async function openDoc(relative: string) {
    if (!activeBase) return
    const ok = await openPath(joinPath(activeBase.rootPath, relative))
    if (ok) props.onOpenChange(false)
  }

  return (
    <Sheet
      open={props.open}
      onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[440px] max-w-[92vw] flex-col gap-3 p-4 sm:max-w-[440px]">
        <div className="flex items-center justify-between gap-2">
          <SheetTitle className="text-sm">知识库</SheetTitle>
          <Button
            size="sm"
            variant="ghost"
            aria-label="重新扫描磁盘"
            title="重新扫描磁盘（外部改动入库）"
            disabled={isLoading || !activeBaseID}
            onClick={function () {
              void rescan()
            }}>
            <Icon
              icon="lucide:refresh-cw"
              className="size-4"
            />
          </Button>
        </div>
        <SheetDescription className="text-xs text-muted-foreground">
          正文以磁盘文件为准；智能体只能写「待发布草稿」，是否入库由你确认。
        </SheetDescription>

        <div className="flex items-center gap-2">
          <Select
            value={activeBaseID ?? undefined}
            onValueChange={function (value) {
              if (typeof value === 'string') void selectBase(value)
            }}>
            <SelectTrigger
              size="sm"
              className="flex-1">
              <SelectValue placeholder="选择知识库" />
            </SelectTrigger>
            <SelectContent>
              {bases.map(function (base) {
                return (
                  <SelectItem
                    key={base.id}
                    value={base.id}>
                    {base.name}（{base.slug}）
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1.5">
          <Input
            value={newName}
            placeholder="新建知识库名称"
            className="h-8"
            onChange={function (event) {
              setNewName(event.target.value)
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!newName.trim()}
            onClick={function () {
              void create(newName.trim()).then(function (ok) {
                if (ok) setNewName('')
              })
            }}>
            新建
          </Button>
        </div>

        <Separator />

        <form
          className="flex items-center gap-1.5"
          onSubmit={function (event) {
            event.preventDefault()
            void runSearch()
          }}>
          <Input
            value={query}
            placeholder="检索知识库（1–2 个字也能命中）"
            className="h-8"
            onChange={function (event) {
              setQuery(event.target.value)
            }}
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={!query.trim()}>
            检索
          </Button>
          {hits.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={clearSearch}>
              清除
            </Button>
          ) : null}
        </form>

        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <ScrollArea className="min-h-0 flex-1">
          {hits.length > 0 ? (
            <ul className="mb-3 flex flex-col gap-1">
              <li className="px-1 text-xs font-medium text-muted-foreground">
                检索命中 {hits.length} 条
                {hits[0]?.mode === 'like' ? '（短词，按更新时间）' : ''}
              </li>
              {hits.map(function (hit) {
                return (
                  <li key={hit.docId}>
                    <button
                      type="button"
                      className="w-full rounded-md px-2 py-1.5 text-left hover:bg-muted"
                      onClick={function () {
                        void openDoc(hit.relPath)
                      }}>
                      <span className="block truncate text-sm">{hit.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {hit.snippet}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : null}

          <div className="mb-1 flex items-center justify-between px-1 text-xs font-medium text-muted-foreground">
            <span>文档 {docs.length}</span>
            {isLoading ? <Spinner className="size-3" /> : null}
          </div>
          {docs.length === 0 && !isLoading ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              还没有文档。可以让智能体生成，或在编辑器里新建后保存到库目录。
            </p>
          ) : null}
          <ul className="flex flex-col gap-0.5">
            {docs.map(function (doc) {
              return (
                <li key={doc.id}>
                  <button
                    type="button"
                    className="w-full rounded-md px-2 py-1.5 text-left hover:bg-muted"
                    onClick={function () {
                      void openDoc(doc.relPath)
                    }}>
                    <span className="block truncate text-sm">{doc.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {doc.relPath} · {doc.wordCount} 字 · {formatTime(doc.updatedAt)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          {staging.length > 0 ? (
            <>
              <Separator className="my-3" />
              <div className="mb-1 flex items-center gap-1 px-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                <Icon
                  icon="lucide:sparkles"
                  className="size-3.5"
                />
                待发布草稿 {staging.length}
              </div>
              <ul className="flex flex-col gap-2">
                {staging.map(function (file) {
                  return (
                    <li
                      key={file.path}
                      className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
                      <p className="truncate text-sm">{file.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        来自 {file.session} · {formatSize(file.size)} ·{' '}
                        {formatTime(file.modifiedAt)}
                      </p>
                      <div className="mt-1.5 flex items-center gap-1">
                        <Button
                          size="sm"
                          disabled={isPublishing}
                          onClick={function () {
                            void publish(file, 'replace').then(function (ok) {
                              if (ok) toast.success(`已发布「${file.name}」`)
                            })
                          }}>
                          覆盖同名
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isPublishing}
                          onClick={function () {
                            void publish(file, 'keepboth').then(function (ok) {
                              if (ok) toast.success(`已发布「${file.name}」（保留两者）`)
                            })
                          }}>
                          保留两者
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={function () {
                            void discard(file)
                          }}>
                          丢弃
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : null}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

export { KnowledgeHub }
