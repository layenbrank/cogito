/**
 * 知识库面板：库切换 / 文档列表 / 检索 / 待发布草稿。
 *
 * 定位：**唯一**能看到并确认 staging 草稿的地方。agent 只能写 staging，
 * 用户在这里选「覆盖同名」或「保留两者」才会写进正式目录与数据库。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
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
import { Switch } from '@cogito/design/components/switch'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { setNextPrompt } from '@/features/agent/model/pending-prompt'
import type { BasePatch, StagedFile } from '@/lib/knowledge-ipc'
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

interface StagingGroup {
  session: string
  files: StagedFile[]
}

type BaseFlag = 'autoUpdate' | 'autoExport' | 'citation'

/** 库级选项：标签与含义（选项本身存在库里，这里只是展示表） */
const BASE_FLAGS: readonly { key: BaseFlag; label: string; hint: string }[] = [
  { key: 'autoUpdate', label: '自动更新', hint: '打开本面板时把磁盘上的改动更新进来' },
  { key: 'autoExport', label: '自动导出', hint: '发布后另存一份 HTML 到库目录的 exports/' },
  { key: 'citation', label: '生成带引用', hint: '生成文档时标注引用了哪几篇' }
]

/** 单个开关 → 只带这一项的 patch（后端按「未给的保持不变」处理） */
const FLAG_PATCH: Record<BaseFlag, (value: boolean) => BasePatch> = {
  autoUpdate: function (value) {
    return { autoUpdate: value }
  },
  autoExport: function (value) {
    return { autoExport: value }
  },
  citation: function (value) {
    return { citation: value }
  }
}

/** 同一次生成的分章都落在同一个会话目录，按会话分组才能给出「合并」动作 */
function groupStaging(files: StagedFile[]): StagingGroup[] {
  const buckets = new Map<string, StagedFile[]>()
  for (const file of files) {
    const bucket = buckets.get(file.session)
    if (bucket) bucket.push(file)
    else buckets.set(file.session, [file])
  }
  return [...buckets.entries()].map(function ([session, items]) {
    return {
      session,
      files: [...items].sort(function (left, right) {
        return left.path.localeCompare(right.path)
      })
    }
  })
}

/** 合并标题默认取首章名（去掉序号与扩展名），用户可改 */
function mergeTitleOf(files: StagedFile[]): string {
  const firstName = files[0]?.name ?? ''
  return firstName
    .replace(/\.md$/i, '')
    .replace(/^\d+\s*[-_.、]?\s*/, '')
    .trim()
}

/** 云端角标：只有「有状态」的文档才显示，未同步不占位置 */
const CLOUD_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: '待上云', className: 'text-muted-foreground' },
  running: { label: '索引中', className: 'text-amber-700 dark:text-amber-400' },
  succeeded: { label: '已上云', className: 'text-emerald-700 dark:text-emerald-400' },
  failed: { label: '同步失败', className: 'text-destructive' }
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
  const cloudState = useKnowledgeBaseStore(function (state) {
    return state.cloudState
  })
  const counts = useKnowledgeBaseStore(function (state) {
    return state.counts
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
  const merge = useKnowledgeBaseStore(function (state) {
    return state.merge
  })
  const updateBase = useKnowledgeBaseStore(function (state) {
    return state.updateBase
  })
  const syncCloud = useKnowledgeBaseStore(function (state) {
    return state.syncCloud
  })
  const cloudStates = useKnowledgeBaseStore(function (state) {
    return state.cloudStates
  })
  const isSyncingCloud = useKnowledgeBaseStore(function (state) {
    return state.isSyncingCloud
  })
  const [newName, setNewName] = useState('')
  const [isGenerateOpen, setIsGenerateOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [topic, setTopic] = useState('')
  const [withCitation, setWithCitation] = useState(true)
  const [mergeTarget, setMergeTarget] = useState<StagedFile[] | null>(null)
  const [mergeTitle, setMergeTitle] = useState('')

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

  const stagingGroups = groupStaging(staging)

  async function openDoc(relative: string) {
    if (!activeBase) return
    const ok = await openPath(joinPath(activeBase.rootPath, relative))
    if (ok) props.onOpenChange(false)
  }

  /** 生成交给聊天：讲清主题后由 knowledge 场景的 playbook 驱动，分章写入 staging */
  function startGenerate() {
    const title = topic.trim()
    if (!title) return
    const citation = withCitation
      ? '先检索库里已有的相关文档，相近内容先说明；引用结论时标注来源。'
      : '不必引用现有文档。'
    // 这次的选择回报给库，下次打开对话框就按上次的来
    if (activeBase && activeBase.citation !== withCitation) {
      void updateBase({ citation: withCitation })
    }
    setNextPrompt({
      text: `请帮我写一篇知识库文档：${title}\n${citation}`,
      scenario: 'knowledge'
    })
    setTopic('')
    props.onOpenChange(false)
    void import('@/routers').then(function (module) {
      return module.router.navigate('/agent/chat')
    })
  }

  async function confirmMerge() {
    const target = mergeTarget
    const title = mergeTitle.trim()
    if (!target || !title) return
    const ok = await merge(
      target.map(function (file) {
        return file.path
      }),
      title
    )
    if (!ok) return
    setMergeTarget(null)
    toast.success(`已合并为「${title}」`)
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
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="secondary"
              title="让智能体按大纲生成文档"
              onClick={function () {
                setWithCitation(activeBase?.citation ?? true)
                setIsGenerateOpen(true)
              }}>
              <Icon
                icon="lucide:sparkles"
                className="size-4"
              />
              生成
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="同步到云端"
              title="把本库还没上云的文档传上去建索引"
              disabled={isSyncingCloud || !activeBase || docs.length === 0}
              onClick={function () {
                void syncCloud()
              }}>
              <Icon
                icon="lucide:cloud-upload"
                className="size-4"
              />
            </Button>
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
          <Button
            size="sm"
            variant="ghost"
            aria-label="库设置"
            title="库设置（自动更新 / 自动导出 / 生成带引用）"
            disabled={!activeBase}
            onClick={function () {
              setIsSettingsOpen(true)
            }}>
            <Icon
              icon="lucide:settings-2"
              className="size-4"
            />
          </Button>
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
                {counts.cloud > 0 ? `（本地 ${counts.local} · 云端 ${counts.cloud}）` : ''}
                {cloudState === 'unavailable' ? ' · 云端暂不可用，仅本地结果' : ''}
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
              const badge = CLOUD_BADGE[cloudStates[doc.id]?.status ?? '']
              return (
                <li key={doc.id}>
                  <button
                    type="button"
                    className="w-full rounded-md px-2 py-1.5 text-left hover:bg-muted"
                    onClick={function () {
                      void openDoc(doc.relPath)
                    }}>
                    <span className="flex items-center gap-1">
                      <span className="truncate text-sm">{doc.title}</span>
                      {badge ? (
                        <span
                          className={`shrink-0 text-[11px] ${badge.className}`}
                          title={cloudStates[doc.id]?.error ?? undefined}>
                          {badge.label}
                        </span>
                      ) : null}
                    </span>
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
              <div className="flex flex-col gap-3">
                {stagingGroups.map(function (group) {
                  return (
                    <div
                      key={group.session}
                      className="flex flex-col gap-2">
                      {group.files.length > 1 ? (
                        <div className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
                          <span className="truncate">同批生成 {group.files.length} 章</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs"
                            disabled={isPublishing}
                            title="按文件名顺序拼成一篇，仍是待发布草稿"
                            onClick={function () {
                              setMergeTarget(group.files)
                              setMergeTitle(mergeTitleOf(group.files))
                            }}>
                            合并
                          </Button>
                        </div>
                      ) : null}
                      <ul className="flex flex-col gap-2">
                        {group.files.map(function (file) {
                          return (
                            <li
                              key={file.path}
                              className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
                              <p className="truncate text-sm">{file.name}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {formatSize(file.size)} · {formatTime(file.modifiedAt)}
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
                                      if (ok)
                                        toast.success(`已发布「${file.name}」（保留两者）`)
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
                    </div>
                  )
                })}
              </div>
            </>
          ) : null}
        </ScrollArea>

        <Dialog
          open={isGenerateOpen}
          onOpenChange={setIsGenerateOpen}>
          <DialogContent className="sm:max-w-105">
            <DialogHeader>
              <DialogTitle className="text-sm">生成文档</DialogTitle>
            </DialogHeader>
            <DialogDescription className="text-xs text-muted-foreground">
              智能体会先与你确认大纲，再逐章写入待发布草稿；是否入库仍由你在这里确认。
            </DialogDescription>
            <Input
              value={topic}
              placeholder="要写什么？例如「季度复盘模板」"
              onChange={function (event) {
                setTopic(event.target.value)
              }}
            />
            <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>引用库里已有的相关文档</span>
              <Switch
                checked={withCitation}
                onCheckedChange={function (checked) {
                  setWithCitation(checked)
                }}
              />
            </label>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={function () {
                  setIsGenerateOpen(false)
                }}>
                取消
              </Button>
              <Button
                disabled={!topic.trim()}
                onClick={startGenerate}>
                开始
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={isSettingsOpen}
          onOpenChange={setIsSettingsOpen}>
          <DialogContent className="sm:max-w-105">
            <DialogHeader>
              <DialogTitle className="text-sm">库设置 · {activeBase?.name ?? ''}</DialogTitle>
            </DialogHeader>
            <DialogDescription className="text-xs text-muted-foreground">
              只影响这台机器上的使用习惯；文档本身仍以库目录里的文件为准。
            </DialogDescription>
            <div className="flex flex-col gap-3">
              {BASE_FLAGS.map(function (flag) {
                return (
                  <label
                    key={flag.key}
                    className="flex items-start justify-between gap-3">
                    <span className="flex flex-col gap-0.5">
                      <span className="text-xs">{flag.label}</span>
                      <span className="text-xs text-muted-foreground">{flag.hint}</span>
                    </span>
                    <Switch
                      checked={activeBase?.[flag.key] ?? false}
                      onCheckedChange={function (checked) {
                        void updateBase(FLAG_PATCH[flag.key](checked))
                      }}
                    />
                  </label>
                )
              })}
            </div>
            <DialogFooter>
              <Button
                onClick={function () {
                  setIsSettingsOpen(false)
                }}>
                完成
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={mergeTarget !== null}
          onOpenChange={function (open) {
            if (!open) setMergeTarget(null)
          }}>
          <DialogContent className="sm:max-w-105">
            <DialogHeader>
              <DialogTitle className="text-sm">合并分章</DialogTitle>
            </DialogHeader>
            <DialogDescription className="text-xs text-muted-foreground">
              按文件名顺序拼成一篇，结果仍是待发布草稿。
            </DialogDescription>
            <Input
              value={mergeTitle}
              placeholder="文档标题"
              onChange={function (event) {
                setMergeTitle(event.target.value)
              }}
            />
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={function () {
                  setMergeTarget(null)
                }}>
                取消
              </Button>
              <Button
                disabled={!mergeTitle.trim() || isPublishing}
                onClick={function () {
                  void confirmMerge()
                }}>
                合并
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  )
}

export { KnowledgeHub }
