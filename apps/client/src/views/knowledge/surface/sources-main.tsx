/**
 * 来源主视图：文件/文件夹/URL 导入、删除级联、队列状态摘要。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import { Textarea } from '@cogito/design/components/textarea'
import { open } from '@tauri-apps/plugin-dialog'
import { copyFile, exists, mkdir } from '@tauri-apps/plugin-fs'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useIngestQueueStore } from '@/views/knowledge/lib/ingest-queue.ts'
import { findFileName, joinPath } from '@/views/knowledge/lib/path.ts'
import { pushReviewItem } from '@/views/knowledge/lib/review-store.ts'
import {
  deleteSourceCascade,
  importFolderToSources,
  isIngestableSourcePath
} from '@/views/knowledge/lib/source-lifecycle.ts'
import { importUrlsToSources } from '@/views/knowledge/lib/url-source-import.ts'
import { WIKI_DIR_RAW_SOURCES } from '@/views/knowledge/lib/wiki-scaffold.ts'
import { openEditorPath } from '@/views/knowledge/workspace/editor-context.ts'
import { Overlay } from '@/views/knowledge/workspace/overlay/index.ts'

function SourcesMain() {
  const bases = useKnowledgeBaseStore(function (state) {
    return state.bases
  })
  const activeBaseID = useKnowledgeBaseStore(function (state) {
    return state.activeBaseID
  })
  const rescan = useKnowledgeBaseStore(function (state) {
    return state.rescan
  })
  const toBumpTree = useKnowledgeStore(function (state) {
    return state.toBumpTree
  })
  const enqueue = useIngestQueueStore(function (state) {
    return state.enqueue
  })
  const queueItems = useIngestQueueStore(function (state) {
    return state.items
  })
  const [isImporting, setImporting] = useState(false)
  const [urlOpen, setUrlOpen] = useState(false)
  const [urlText, setUrlText] = useState('')
  const [skipReport, setSkipReport] = useState<string[]>([])

  const activeBase = bases.find(function (base) {
    return base.id === activeBaseID
  })
  const rootPath = activeBase?.rootPath ?? null
  const sourcesRoot = rootPath ? joinPath(rootPath, WIKI_DIR_RAW_SOURCES) : null

  const statusHint = useMemo(
    function () {
      const counts = { queued: 0, running: 0, failed: 0, blocked: 0, done: 0 }
      for (const item of queueItems) {
        if (item.status === 'pending') counts.queued += 1
        else if (item.status === 'running') counts.running += 1
        else if (item.status === 'failed') counts.failed += 1
        else if (item.status === 'blocked') counts.blocked += 1
        else if (item.status === 'succeeded' || item.status === 'skipped') counts.done += 1
      }
      return counts
    },
    [queueItems]
  )

  useEffect(
    function () {
      if (!sourcesRoot) return
      void (async function () {
        try {
          if (!(await exists(sourcesRoot))) {
            await mkdir(sourcesRoot, { recursive: true })
          }
          toBumpTree()
        } catch (error) {
          console.error('[sources] ensure raw/sources failed', error)
        }
      })()
    },
    [sourcesRoot, toBumpTree]
  )

  async function importFiles() {
    if (!sourcesRoot || !rootPath) {
      toast.error('无活动知识库')
      return
    }
    setImporting(true)
    try {
      const picked = await open({
        multiple: true,
        filters: [
          {
            name: '资料',
            extensions: ['md', 'markdown', 'txt', 'pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif']
          },
          { name: '全部', extensions: ['*'] }
        ]
      })
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : []
      if (paths.length === 0) return
      if (!(await exists(sourcesRoot))) {
        await mkdir(sourcesRoot, { recursive: true })
      }
      const skipped: string[] = []
      let imported = 0
      for (const source of paths) {
        const name = findFileName(source)
        const dest = joinPath(sourcesRoot, name)
        await copyFile(source, dest)
        const relative = `${WIKI_DIR_RAW_SOURCES}/${name}`
        if (isIngestableSourcePath(dest)) {
          enqueue(relative)
          imported += 1
        } else {
          skipped.push(`${relative}（扩展名不可 ingest）`)
        }
      }
      setSkipReport(skipped)
      toBumpTree()
      toast.success(`已导入 ${imported} 个可 ingest 文件`)
    } catch (error) {
      console.error('[sources] import failed', error)
      toast.error(error instanceof Error ? error.message : '导入失败')
    } finally {
      setImporting(false)
    }
  }

  async function importFolder() {
    if (!rootPath) {
      toast.error('无活动知识库')
      return
    }
    setImporting(true)
    try {
      const picked = await open({ directory: true, multiple: false })
      const folder = Array.isArray(picked) ? picked[0] : picked
      if (!folder) return
      const result = await importFolderToSources({ rootPath, folderPath: folder })
      for (const relative of result.imported) {
        enqueue(relative)
      }
      setSkipReport(
        result.skipped.map(function (item) {
          return `${item.path}（${item.reason}）`
        })
      )
      toBumpTree()
      toast.success(`文件夹导入 ${result.imported.length} 个，跳过 ${result.skipped.length} 个`)
    } catch (error) {
      console.error('[sources] folder import failed', error)
      toast.error(error instanceof Error ? error.message : '文件夹导入失败')
    } finally {
      setImporting(false)
    }
  }

  async function importUrls() {
    if (!rootPath) {
      toast.error('无活动知识库')
      return
    }
    setImporting(true)
    try {
      const results = await importUrlsToSources({ rootPath, urlsText: urlText })
      let ok = 0
      const failed: string[] = []
      for (const item of results) {
        if (item.path) {
          enqueue(item.path)
          ok += 1
        } else {
          failed.push(`${item.url}: ${item.error || '失败'}`)
          pushReviewItem({
            title: 'URL 导入失败',
            prompt: `${item.url}\n${item.error || ''}`,
            status: 'pending',
            kind: 'confirm',
            sourcePath: item.url
          })
        }
      }
      setSkipReport(failed)
      setUrlOpen(false)
      setUrlText('')
      toBumpTree()
      toast.success(`URL 导入成功 ${ok}，失败 ${failed.length}`)
    } catch (error) {
      console.error('[sources] url import failed', error)
      toast.error(error instanceof Error ? error.message : 'URL 导入失败')
    } finally {
      setImporting(false)
    }
  }

  async function handleDeleteAbsolute(absolute: string): Promise<void> {
    if (!rootPath) return
    const relative = toRelativePath(rootPath, absolute)
    const result = await deleteSourceCascade({
      rootPath,
      sourceRelative: relative
    })
    void rescan()
    toast.success(
      result.removedWiki.length > 0
        ? `已删除来源，并清理 ${result.removedWiki.length} 个 wiki 页`
        : '已删除来源'
    )
  }

  if (!rootPath || !sourcesRoot) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-6 text-sm">
        请先选择或创建知识库
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold">来源</h1>
          <p className="text-muted-foreground truncate text-xs">
            raw/sources · 队列 {statusHint.queued}/{statusHint.running} 跑 · 失败{' '}
            {statusHint.failed} · 阻塞 {statusHint.blocked} · 完成 {statusHint.done}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={isImporting}
          className="h-8 gap-1 text-xs"
          onClick={function () {
            void importFiles()
          }}>
          <Icon
            icon="lucide:plus"
            className="size-3.5"
          />
          导入文件
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={isImporting}
          className="h-8 gap-1 text-xs"
          onClick={function () {
            void importFolder()
          }}>
          <Icon
            icon="lucide:folder-plus"
            className="size-3.5"
          />
          导入文件夹
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={isImporting}
          className="h-8 gap-1 text-xs"
          onClick={function () {
            setUrlOpen(true)
          }}>
          <Icon
            icon="lucide:link"
            className="size-3.5"
          />
          导入 URL
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1 text-xs"
          onClick={function () {
            toBumpTree()
            void rescan()
          }}>
          <Icon
            icon="lucide:refresh-cw"
            className="size-3.5"
          />
          刷新
        </Button>
      </div>
      {skipReport.length > 0 ? (
        <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs">
          <p className="font-medium">跳过 / 失败报告</p>
          <ul className="text-muted-foreground mt-1 max-h-20 overflow-y-auto overscroll-y-contain">
            {skipReport.map(function (line) {
              return <li key={line}>{line}</li>
            })}
          </ul>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        <Overlay.Navigation
          onOpenPath={openEditorPath}
          rootOverride={sourcesRoot}
          onDeleteAbsolute={function (absolute) {
            return handleDeleteAbsolute(absolute)
          }}
        />
      </div>

      <Dialog
        open={urlOpen}
        onOpenChange={setUrlOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>批量导入 URL</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-xs">
            每行一个 http(s) URL，最多 50 条；拒绝私网地址。
          </p>
          <Textarea
            value={urlText}
            rows={8}
            placeholder={'https://example.com/a\nhttps://example.com/b'}
            onChange={function (event) {
              setUrlText(event.target.value)
            }}
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={function () {
                setUrlOpen(false)
              }}>
              取消
            </Button>
            <Button
              disabled={isImporting || !urlText.trim()}
              onClick={function () {
                void importUrls()
              }}>
              导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function toRelativePath(root: string, absolute: string): string {
  const normalized = absolute.replace(/\\/g, '/')
  const rootNorm = root.replace(/\\/g, '/').replace(/\/+$/, '')
  if (normalized.toLowerCase().startsWith(rootNorm.toLowerCase() + '/')) {
    return normalized.slice(rootNorm.length + 1)
  }
  return normalized
}

export { SourcesMain }
