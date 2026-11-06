/**
 * 知识库浏览：composer 的「知识库」按钮与右栏「知识库」页签共用同一份实现。
 *
 * 一条文档就是磁盘上的一个 Markdown 文件（`<库根>/<relPath>`）。点选后把它的
 * **引用路径**挂成附件交给 agent —— 与文件树、`@`、`+` 面板的「引用」同一条通道
 * （`attachWorkspaceFile`），不另造一套上下文注入：知识库文档本来就能被 agent 读，
 * 这里要解决的只是「找得到、点得到」。
 */
import type { useAui } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { clsx } from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { attachWorkspaceFile } from '@/features/agent/attachment.ts'
import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { joinWorkspacePath, toAgentPath } from '@/features/agent/workspace/paths.ts'
import {
  listBases,
  listDocs,
  type KnowledgeBase,
  type KnowledgeDocSummary
} from '@/lib/knowledge-ipc.ts'

type ComposerAui = ReturnType<typeof useAui>

interface KnowledgeBrowserProps {
  aui: ComposerAui
  /** 面板可见时才去读库：popover 关着、页签没选中都不该发 IPC */
  active: boolean
  /** 引用成功后的回调（popover 用它收起面板） */
  onPicked?: () => void
  className?: string
}

function filterDocs(docs: readonly KnowledgeDocSummary[], query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return docs
  return docs.filter(function (doc) {
    return (
      doc.title.toLowerCase().includes(needle) || doc.relPath.toLowerCase().includes(needle)
    )
  })
}

const KnowledgeBrowser = function KnowledgeBrowser(props: KnowledgeBrowserProps) {
  const navigate = useNavigate()
  const { primaryRootPath } = useActiveWorkspace()
  const [bases, updateBases] = useState<KnowledgeBase[]>([])
  const [baseID, updateBaseID] = useState<string | null>(null)
  const [docs, updateDocs] = useState<KnowledgeDocSummary[]>([])
  const [query, updateQuery] = useState('')
  const [isLoading, updateLoading] = useState(false)
  const [error, updateError] = useState<string | null>(null)

  // 库列表：面板第一次打开时读一次（切会话 / 重挂载都会重新走这里）
  useEffect(
    function () {
      if (!props.active) return
      let cancelled = false
      async function load() {
        try {
          updateLoading(true)
          updateError(null)
          const rows = await listBases()
          if (cancelled) return
          updateBases(rows)
          updateBaseID(function (current) {
            if (current && rows.some((row) => row.id === current)) return current
            return rows[0]?.id ?? null
          })
        } catch (cause) {
          if (cancelled) return
          console.warn('[knowledge-browser] 读取知识库失败', cause)
          updateBases([])
          updateError(cause instanceof Error ? cause.message : '读取知识库失败')
        } finally {
          if (!cancelled) updateLoading(false)
        }
      }
      void load()
      return function () {
        cancelled = true
      }
    },
    [props.active]
  )

  // 文档列表：跟着当前库走
  useEffect(
    function () {
      // 库切没了就什么都不读：列表在渲染时按 baseID 兜空，不在这里 setState
      if (!props.active || !baseID) return
      const currentBaseID = baseID
      let cancelled = false
      async function load() {
        try {
          updateLoading(true)
          updateError(null)
          const rows = await listDocs(currentBaseID)
          if (!cancelled) updateDocs(rows)
        } catch (cause) {
          if (cancelled) return
          console.warn('[knowledge-browser] 读取文档失败', cause)
          updateDocs([])
          updateError(cause instanceof Error ? cause.message : '读取文档列表失败')
        } finally {
          if (!cancelled) updateLoading(false)
        }
      }
      void load()
      return function () {
        cancelled = true
      }
    },
    [props.active, baseID]
  )

  const baseById = useMemo(
    function () {
      const map = new Map<string, KnowledgeBase>()
      for (const base of bases) map.set(base.id, base)
      return map
    },
    [bases]
  )
  const visible = baseID ? filterDocs(docs, query) : []

  function openKnowledge() {
    props.onPicked?.()
    void navigate('/knowledge')
  }

  function pick(doc: KnowledgeDocSummary) {
    const base = baseById.get(doc.baseId)
    if (!base) {
      toast.error('这份文档所属的知识库已不在列表里')
      return
    }
    // 库根可能不在工作区内：`toAgentPath` 对工作区外的路径原样给绝对路径
    const reference = toAgentPath(joinWorkspacePath(base.rootPath, doc.relPath), primaryRootPath)
    void attachWorkspaceFile(props.aui, reference)
      .then(function () {
        toast.success(`已引用「${doc.title}」`)
        props.onPicked?.()
      })
      .catch(function (cause: unknown) {
        toast.error(cause instanceof Error ? cause.message : '引用失败')
      })
  }

  return (
    <div className={clsx('flex min-h-0 flex-1 flex-col', props.className)}>
      {bases.length > 1 ? (
        <div className="border-border/60 flex shrink-0 gap-1 overflow-x-auto border-b p-1.5">
          {bases.map(function (base) {
            const isActive = base.id === baseID
            return (
              <Button
                key={base.id}
                type="button"
                variant="ghost"
                className={clsx(
                  'h-6 shrink-0 rounded-md px-2 text-xs font-normal',
                  isActive ? 'bg-muted font-medium' : 'text-muted-foreground'
                )}
                onClick={function () {
                  updateBaseID(base.id)
                }}>
                {base.name}
              </Button>
            )
          })}
        </div>
      ) : null}

      <div className="shrink-0 border-b p-2">
        <Input
          value={query}
          placeholder="搜索文档"
          aria-label="搜索知识库文档"
          className="h-7 text-xs"
          onChange={function (event) {
            updateQuery(event.target.value)
          }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {isLoading && visible.length === 0 ? (
          <p className="text-muted-foreground flex items-center gap-1.5 p-2.5 text-xs">
            <Icon
              icon="lucide:loader-circle"
              className="size-3.5 animate-spin"
            />
            读取中…
          </p>
        ) : null}

        {error && !isLoading ? (
          <p className="text-muted-foreground p-2.5 text-xs">{error}</p>
        ) : null}

        {visible.map(function (doc) {
          return (
            <Button
              key={doc.id}
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-xs font-normal"
              title={doc.relPath}
              onClick={function () {
                pick(doc)
              }}>
              <Icon
                icon="lucide:file-text"
                className="text-muted-foreground size-3.5 shrink-0"
              />
              <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                <span className="w-full truncate text-start">{doc.title}</span>
                <span className="text-muted-foreground w-full truncate text-start text-xs">
                  {doc.relPath}
                </span>
              </span>
              <Icon
                icon="lucide:plus"
                className="text-muted-foreground size-3.5 shrink-0"
              />
            </Button>
          )
        })}

        {!isLoading && !error && visible.length === 0 ? (
          <p className="text-muted-foreground p-2.5 text-xs">
            {bases.length === 0
              ? '还没有知识库：打开知识库视图新建一个'
              : query.trim()
                ? '没有匹配的文档'
                : '这个库还没有文档'}
          </p>
        ) : null}
      </div>

      <div className="border-border/60 flex shrink-0 items-center justify-between gap-2 border-t px-2.5 py-1.5">
        <span className="text-muted-foreground truncate text-xs">
          {baseID ? `${visible.length} 篇文档` : '未选择知识库'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground h-6 gap-1 px-1.5 text-xs"
          onClick={openKnowledge}>
          <Icon
            icon="lucide:library"
            className="size-3.5"
          />
          打开知识库
        </Button>
      </div>
    </div>
  )
}

export { KnowledgeBrowser }
export type { KnowledgeBrowserProps }
