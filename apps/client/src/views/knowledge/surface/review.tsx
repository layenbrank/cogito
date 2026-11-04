/**
 * 审核页：类型化 review + 打开/建页/dismiss。
 */
import { Button } from '@cogito/design/components/button'
import { ScrollArea } from '@cogito/design/components/scroll-area'
import { exists, mkdir, writeTextFile } from '@tauri-apps/plugin-fs'
import { useState } from 'react'
import { toast } from 'sonner'

import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { joinPath } from '@/views/knowledge/lib/path.ts'
import {
  patchReviewItem,
  pushReviewItem,
  readReviewItems,
  writeReviewItems,
  type ReviewItem,
  type ReviewItemKind
} from '@/views/knowledge/lib/review-store.ts'
import { openEditorPath } from '@/views/knowledge/workspace/editor-context.ts'
import {
  ToolEmpty,
  ToolListCard,
  ToolPageHeader,
  ToolStatPill,
  ToolTag
} from '@/views/knowledge/surface/tool-surface.tsx'

const KIND_LABEL: Record<ReviewItemKind, string> = {
  confirm: '确认',
  suggestion: '建议',
  contradiction: '矛盾',
  duplicate: '重复',
  'missing-page': '缺页'
}

const STATUS_LABEL: Record<ReviewItem['status'], string> = {
  pending: '待处理',
  approved: '已通过',
  dismissed: '已忽略',
  rejected: '已拒绝'
}

function ReviewTab() {
  const bases = useKnowledgeBaseStore(function (state) {
    return state.bases
  })
  const activeBaseID = useKnowledgeBaseStore(function (state) {
    return state.activeBaseID
  })
  const [items, setItems] = useState<ReviewItem[]>(function () {
    return readReviewItems()
  })

  function refresh() {
    setItems(readReviewItems())
  }

  function patchStatus(id: string, status: ReviewItem['status']) {
    patchReviewItem(id, { status })
    refresh()
  }

  function insertDemo() {
    pushReviewItem({
      title: '示例审核',
      prompt: '新资料与 overview 中某主张可能矛盾，请确认是否更新实体页。',
      status: 'pending',
      kind: 'contradiction'
    })
    refresh()
  }

  async function openOrCreatePage(item: ReviewItem) {
    const base = bases.find(function (entry) {
      return entry.id === activeBaseID
    })
    if (!base?.rootPath) {
      toast.error('无活动知识库')
      return
    }
    if (item.wikiPath) {
      const absolute = joinPath(base.rootPath, item.wikiPath)
      if (await exists(absolute)) {
        openEditorPath(absolute)
        return
      }
    }
    const slug =
      item.title
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
        .slice(0, 40) || `review-${Date.now()}`
    const relative = `wiki/${slug}.md`
    const absolute = joinPath(base.rootPath, relative)
    const parent = joinPath(base.rootPath, 'wiki')
    if (!(await exists(parent))) await mkdir(parent, { recursive: true })
    const body = `---\ntitle: ${JSON.stringify(item.title)}\ntype: concept\n---\n\n# ${item.title}\n\n> 由 Review 创建\n\n${item.prompt}\n`
    await writeTextFile(absolute, body)
    patchReviewItem(item.id, { wikiPath: relative, status: 'approved' })
    refresh()
    openEditorPath(absolute)
    toast.success('已建页并打开')
  }

  function clearResolved() {
    writeReviewItems(
      readReviewItems().filter(function (item) {
        return item.status === 'pending'
      })
    )
    refresh()
  }

  async function autoFixPending() {
    const base = bases.find(function (entry) {
      return entry.id === activeBaseID
    })
    if (!base?.rootPath) {
      toast.error('无活动知识库')
      return
    }
    let fixed = 0
    for (const item of readReviewItems()) {
      if (item.status !== 'pending') continue
      if (item.kind !== 'missing-page' && item.kind !== 'suggestion') continue
      try {
        await openOrCreatePage(item)
        fixed += 1
      } catch (error) {
        console.error('[review] auto-fix failed', item.id, error)
      }
    }
    refresh()
    toast.success(`自动修复处理 ${fixed} 项（缺页/建议已建页）`)
  }

  const openItems = items.filter(function (item) {
    return item.status === 'pending'
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ToolPageHeader
        title="审阅"
        description="Ingest 与维护产生的待确认项：缺页、矛盾、重复等。"
        meta={
          <>
            <ToolStatPill
              label="待处理"
              value={openItems.length}
              tone={openItems.length > 0 ? 'warn' : 'ok'}
            />
            <ToolStatPill
              label="全部"
              value={items.length}
            />
          </>
        }
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={insertDemo}>
              示例
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={refresh}>
              刷新
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={clearResolved}>
              清理已处理
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="h-8"
              disabled={openItems.length === 0}
              onClick={function () {
                void autoFixPending()
              }}>
              自动修复缺页
            </Button>
          </>
        }
      />
      <ScrollArea className="min-h-0 flex-1">
        {items.length === 0 ? (
          <ToolEmpty
            icon="lucide:list-todo"
            title="暂无审阅项"
            description="Ingest 确认、去重维护或手动加入示例后会出现在此。"
          />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {items.map(function (item) {
              return (
                <li key={item.id}>
                  <ToolListCard>
                    <div className="flex flex-wrap items-center gap-2">
                      <ToolTag>{KIND_LABEL[item.kind] ?? item.kind}</ToolTag>
                      <span className="text-muted-foreground text-xs">
                        {STATUS_LABEL[item.status] ?? item.status}
                      </span>
                      <p className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</p>
                    </div>
                    <p className="text-muted-foreground mt-1.5 text-sm leading-6">{item.prompt}</p>
                    {item.wikiPath ? (
                      <p className="text-muted-foreground mt-1 truncate text-xs">{item.wikiPath}</p>
                    ) : null}
                    {item.status === 'pending' ? (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        <Button
                          size="sm"
                          className="h-7 px-2.5 text-xs"
                          onClick={function () {
                            void openOrCreatePage(item)
                          }}>
                          打开/建页
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 px-2.5 text-xs"
                          onClick={function () {
                            patchStatus(item.id, 'approved')
                          }}>
                          通过
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2.5 text-xs"
                          onClick={function () {
                            patchStatus(item.id, 'dismissed')
                          }}>
                          忽略
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2.5 text-xs"
                          onClick={function () {
                            patchStatus(item.id, 'rejected')
                          }}>
                          拒绝
                        </Button>
                      </div>
                    ) : null}
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

export { ReviewTab }
