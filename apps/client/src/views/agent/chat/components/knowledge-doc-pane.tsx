/**
 * 知识库文档面板：预览 / 编辑（Markdown 源文）/ 引用 / 重新载入 / 删除。
 *
 * 与列表（`knowledge-browser`）同处右栏与 composer popover，所以宽度通常在 350–450px：
 * 预览用只读 Markdown，编辑用源文 textarea —— 不引 tiptap（那是知识库整窗编辑器的
 * 体量），也不给窄栏套 Monaco（散文换行需求比代码补全重要）。
 *
 * 保存走 `knowledge:writeDoc`：文档在库内时由服务端写盘 + 落库，并用打开时取到的 hash
 * 判断「期间库内是否被别处改过」；冲突先问「保留我的 / 重新载入」，不自作主张覆盖。
 */
import { Icon } from '@iconify/react/offline'
import { MarkdownContent } from '@cogito/design/assistant/markdown-text'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@cogito/design/components/alert-dialog'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  removeDoc,
  resolveDoc,
  writeDoc,
  type KnowledgeBase,
  type KnowledgeDocSummary
} from '@/lib/knowledge-ipc.ts'
import { rewriteMarkdownAssetSrc } from '@/views/agent/chat/components/knowledge-doc.ts'
import { parseFrontMatter } from '@/views/knowledge/lib/front-matter.ts'
import { readMarkdownFile, writeMarkdownFile } from '@/views/knowledge/lib/fs.ts'
import { formatTime } from '@/views/knowledge/lib/format.ts'
import { joinPath } from '@/views/knowledge/lib/path.ts'

/** 面板只认「库 + 库内路径」，命中结果（检索）与完整摘要都能满足 */
interface KnowledgeDocTarget {
  id: string
  title: string
  relPath: string
}

interface KnowledgeDocPaneProps {
  base: KnowledgeBase
  doc: KnowledgeDocTarget
  /** 列表里点「编辑」进来时直接落在编辑态 */
  initialEditing?: boolean
  /** 字数 / 更新时间：检索命中里没有，允许缺省 */
  wordCount?: number
  updatedAt?: number
  onBack: () => void
  onAttach: () => void
  onOpenInKnowledge: () => void
  /** 保存成功：列表据此更新标题 / 时间，并重新拉一次文档列表 */
  onSaved: (doc: KnowledgeDocSummary) => void
  onDeleted: (docID: string) => void
}

type PaneMode = 'preview' | 'edit'

function KnowledgeDocPane(props: KnowledgeDocPaneProps) {
  const absolutePath = joinPath(props.base.rootPath, props.doc.relPath)
  const [mode, updateMode] = useState<PaneMode>(props.initialEditing ? 'edit' : 'preview')
  const [content, updateContent] = useState<string | null>(null)
  /** 落盘时的正文：与 content 不同即「未保存」 */
  const [savedContent, updateSavedContent] = useState<string | null>(null)
  /** 库内 hash：保存时带回服务端做冲突判定 */
  const [hash, updateHash] = useState<string | null>(null)
  const [isLoading, updateLoading] = useState(true)
  const [error, updateError] = useState<string | null>(null)
  const [isSaving, updateSaving] = useState(false)
  const [reloadToken, updateReloadToken] = useState(0)
  const [conflictOpen, updateConflictOpen] = useState(false)
  const [discardOpen, updateDiscardOpen] = useState(false)
  const [deleteOpen, updateDeleteOpen] = useState(false)
  const [isDeleting, updateDeleting] = useState(false)
  /** 「保存后离开」：冲突框可能插在中间，用 ref 把意图带到下一次保存 */
  const closeAfterSaveRef = useRef(false)
  /** 主动离开（返回 / 删除 / 保存后离开）不报「修改已丢弃」：只有面板被外部关掉才提示 */
  const isLeavingRef = useRef(false)
  const isDirtyRef = useRef(false)

  // 读正文：hash 单独取，取不到也能编辑（只是保存时少一层冲突判定）
  useEffect(
    function () {
      let cancelled = false
      updateLoading(true)
      updateError(null)

      void readMarkdownFile(absolutePath)
        .then(function (text) {
          if (cancelled) return
          updateContent(text)
          updateSavedContent(text)
          // hash 单独取：取不到也能编辑，只是保存时少一层冲突判定
          void resolveDoc(absolutePath)
            .then(function (reference) {
              if (cancelled) return
              updateHash(reference.matched ? (reference.hash ?? null) : null)
            })
            .catch(function (cause: unknown) {
              console.warn('[agent/knowledge] 解析文档引用失败:', cause)
              if (cancelled) return
              updateHash(null)
            })
        })
        .catch(function (cause: unknown) {
          console.warn('[agent/knowledge] 读取文档失败:', cause)
          if (cancelled) return
          updateContent(null)
          updateError(cause instanceof Error ? cause.message : '读取文档失败')
        })
        .finally(function () {
          if (!cancelled) updateLoading(false)
        })

      return function () {
        cancelled = true
      }
    },
    [absolutePath, reloadToken]
  )

  const isDirty = content !== null && savedContent !== null && content !== savedContent
  isDirtyRef.current = isDirty

  // popover 收起等外部原因卸载时，脏内容会随组件一起消失 —— 至少提示一声
  useEffect(function () {
    return function () {
      if (isDirtyRef.current && !isLeavingRef.current) toast.message('未保存的修改已丢弃')
    }
  }, [])

  /**
   * 写盘：`force` 为真时跳过冲突判定（用户在冲突框里选了「保留我的」）。
   * 成功后才重置 baseline —— 中途用户又改了的话，正文与 baseline 仍不一致，保持「未保存」。
   */
  function save(options?: { force?: boolean; closeAfter?: boolean }) {
    if (content === null || isSaving) return
    const value = content
    if (options?.closeAfter) closeAfterSaveRef.current = true
    updateSaving(true)
    void writeDoc({
      path: absolutePath,
      content: value,
      expectedHash: options?.force ? null : hash,
      force: options?.force ?? false
    })
      .then(async function (outcome) {
        if (outcome.conflict) {
          updateConflictOpen(true)
          return
        }
        // 库根被挪走 / 已不在任何库里：退化成普通文件写，避免「点了保存却没落盘」
        if (!outcome.matched) {
          await writeMarkdownFile(absolutePath, value)
        }
        updateHash(outcome.hash ?? null)
        updateSavedContent(value)
        toast.success('已保存')
        if (outcome.doc) props.onSaved(outcome.doc)
        if (closeAfterSaveRef.current) {
          closeAfterSaveRef.current = false
          isLeavingRef.current = true
          props.onBack()
        }
      })
      .catch(function (cause: unknown) {
        console.warn('[agent/knowledge] 保存文档失败:', cause)
        toast.error(cause instanceof Error ? cause.message : '保存失败')
      })
      .finally(function () {
        updateSaving(false)
      })
  }

  function reload() {
    updateReloadToken(function (value) {
      return value + 1
    })
  }

  function confirmDelete() {
    updateDeleting(true)
    void removeDoc(props.doc.id)
      .then(function (count) {
        // 服务端连文件带索引一起删；0 表示行已经没了，只提示刷新
        toast.success(count > 0 ? '已删除文档' : '文档已不在库里，列表已刷新')
        isLeavingRef.current = true
        props.onDeleted(props.doc.id)
      })
      .catch(function (cause: unknown) {
        console.warn('[agent/knowledge] 删除文档失败:', cause)
        toast.error(cause instanceof Error ? cause.message : '删除失败')
      })
      .finally(function () {
        updateDeleting(false)
        updateDeleteOpen(false)
      })
  }

  function copyPath() {
    void navigator.clipboard.writeText(absolutePath).then(
      function () {
        toast.success('已复制路径')
      },
      function (cause: unknown) {
        console.warn('[agent/knowledge] 复制路径失败:', cause)
        toast.error('复制失败')
      }
    )
  }

  function handleBack() {
    if (!isDirty) {
      props.onBack()
      return
    }
    updateDiscardOpen(true)
  }

  const statusLabel = isLoading ? null : isSaving ? '保存中…' : isDirty ? '未保存' : '已保存'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border flex h-9 shrink-0 items-center gap-1 border-b px-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="返回知识库列表"
          title="返回列表"
          className="size-7"
          onClick={handleBack}>
          <Icon
            icon="lucide:chevron-left"
            className="size-3.5"
          />
        </Button>
        {isDirty ? (
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full bg-amber-500"
          />
        ) : (
          <Icon
            icon="lucide:file-text"
            className="text-muted-foreground size-3.5 shrink-0"
          />
        )}
        <span
          className="text-foreground min-w-0 flex-1 truncate text-xs font-medium"
          title={props.doc.relPath}>
          {props.doc.title}
        </span>
        {statusLabel ? (
          <span
            className={clsx(
              'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium',
              isDirty
                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                : 'bg-muted text-muted-foreground'
            )}
            aria-live="polite">
            {statusLabel}
          </span>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="添加到对话"
          title="引用到对话"
          className="size-7"
          onClick={props.onAttach}>
          <Icon
            icon="lucide:message-square-plus"
            className="size-3.5"
          />
        </Button>
        {mode === 'edit' ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="保存"
            title={isDirty ? '保存 (Ctrl+S)' : '已保存'}
            className={clsx('size-7', isDirty && 'text-amber-600 dark:text-amber-400')}
            disabled={!isDirty || isSaving || content === null}
            onClick={function () {
              save()
            }}>
            <Icon
              icon={isSaving ? 'lucide:loader-circle' : 'lucide:save'}
              className={clsx('size-3.5', isSaving && 'animate-spin')}
            />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={mode === 'edit' ? '预览' : '编辑'}
          title={mode === 'edit' ? '预览' : '编辑正文'}
          className="size-7"
          disabled={content === null || Boolean(error)}
          onClick={function () {
            updateMode(function (current) {
              return current === 'edit' ? 'preview' : 'edit'
            })
          }}>
          <Icon
            icon={mode === 'edit' ? 'lucide:eye' : 'lucide:pencil'}
            className="size-3.5"
          />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="更多操作"
                title="更多操作"
                className="size-7"
              />
            }>
            <Icon
              icon="lucide:ellipsis"
              className="size-3.5"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-36">
            <DropdownMenuItem
              onClick={function () {
                if (isDirty) toast.message('未保存的修改已丢弃')
                reload()
              }}>
              <Icon
                icon="lucide:refresh-cw"
                className="size-3.5"
              />
              重新载入
            </DropdownMenuItem>
            <DropdownMenuItem onClick={props.onOpenInKnowledge}>
              <Icon
                icon="lucide:library"
                className="size-3.5"
              />
              在知识库中打开
            </DropdownMenuItem>
            <DropdownMenuItem onClick={copyPath}>
              <Icon
                icon="lucide:clipboard-copy"
                className="size-3.5"
              />
              复制路径
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={function () {
                updateDeleteOpen(true)
              }}>
              <Icon
                icon="lucide:trash-2"
                className="size-3.5"
              />
              删除文档
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p className="text-muted-foreground border-border/60 shrink-0 truncate border-b px-2.5 py-1 text-[11px]">
        {props.doc.relPath}
        {typeof props.wordCount === 'number' ? ` · ${props.wordCount} 字` : ''}
        {props.updatedAt ? ` · 更新 ${formatTime(props.updatedAt)}` : ''}
      </p>

      {isLoading ? (
        <p className="text-muted-foreground flex items-center gap-1.5 p-3 text-xs">
          <Icon
            icon="lucide:loader-circle"
            className="size-3.5 animate-spin"
          />
          读取中…
        </p>
      ) : null}

      {error ? <p className="text-destructive p-3 text-xs">{error}</p> : null}

      {!isLoading && !error && content !== null ? (
        mode === 'edit' ? (
          <textarea
            value={content}
            aria-label="文档正文"
            spellCheck={false}
            className="text-foreground min-h-0 flex-1 resize-none bg-transparent p-2.5 font-mono text-xs leading-relaxed outline-none"
            onChange={function (event) {
              updateContent(event.target.value)
            }}
            onKeyDown={function (event) {
              // Ctrl/Cmd+S 保存：与整窗编辑器、右栏文件编辑一致
              if (event.key.toLowerCase() !== 's' || !(event.ctrlKey || event.metaKey)) return
              event.preventDefault()
              save()
            }}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
            <MarkdownContent
              markdown={rewriteMarkdownAssetSrc(parseFrontMatter(content).body, absolutePath)}
              className="max-w-none text-xs leading-relaxed"
            />
          </div>
        )
      ) : null}

      <AlertDialog
        open={discardOpen}
        onOpenChange={updateDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>还有未保存的修改</AlertDialogTitle>
            <AlertDialogDescription>
              返回列表会丢掉这些修改；也可以先保存再离开。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={function () {
                updateDiscardOpen(false)
                isLeavingRef.current = true
                props.onBack()
              }}>
              丢弃
            </AlertDialogAction>
            <AlertDialogAction
              onClick={function () {
                updateDiscardOpen(false)
                save({ closeAfter: true })
              }}>
              保存
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={conflictOpen}
        onOpenChange={function (next) {
          if (!next) updateConflictOpen(false)
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>库里的这篇文档已被改过</AlertDialogTitle>
            <AlertDialogDescription>
              打开之后库内出现了更新的版本。保留我的会覆盖那份新内容；重新载入会丢掉你现在的修改。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={function () {
                updateConflictOpen(false)
                if (isDirty) toast.message('未保存的修改已丢弃')
                reload()
              }}>
              重新载入
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={function () {
                updateConflictOpen(false)
                save({ force: true })
              }}>
              保留我的
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={updateDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{props.doc.title}」？</AlertDialogTitle>
            <AlertDialogDescription>
              会同时删掉磁盘上的文件和库内索引，无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={confirmDelete}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export { KnowledgeDocPane }
export type { KnowledgeDocPaneProps, KnowledgeDocTarget }
