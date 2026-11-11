/**
 * 提示词库管理弹窗：列表 + 编辑区。
 *
 * 入口在 `::` 触发面板的底部（「管理提示词」）。不单开设置页：
 * 提示词是在写消息时想起来的，离开输入框去设置里找一圈，回来草稿还在不在都不确定。
 */
import { parsePromptVariables } from '@cogito/design/assistant/prompt-vars'
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
import { Textarea } from '@cogito/design/components/textarea'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useEffect, useState } from 'react'

import {
  createPrompt,
  deletePrompt,
  ensurePrompts,
  setPromptManagerOpen,
  updatePrompt,
  usePrompts,
  usePromptManagerOpen,
  type SavedPrompt
} from '@/features/prompts'

interface Draft {
  title: string
  body: string
}

const EMPTY_DRAFT: Draft = { title: '', body: '' }

function PromptLibraryManager() {
  const open = usePromptManagerOpen()
  const prompts = usePrompts()
  const [selectedID, setSelectedID] = useState<string | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [pendingDeleteID, setPendingDeleteID] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // 首次打开补齐磁盘数据；打开时默认选中第一条
  useEffect(
    function () {
      if (!open) return
      void ensurePrompts()
      setPendingDeleteID(null)
    },
    [open]
  )

  useEffect(
    function () {
      if (!open) return
      if (selectedID !== null || isNew) return
      const first = prompts[0]
      if (!first) return
      setSelectedID(first.id)
      setDraft({ title: first.title, body: first.body })
    },
    [prompts, open, selectedID, isNew]
  )

  function selectPrompt(prompt: SavedPrompt) {
    setSelectedID(prompt.id)
    setIsNew(false)
    setDraft({ title: prompt.title, body: prompt.body })
    setPendingDeleteID(null)
  }

  function startNew() {
    setSelectedID(null)
    setIsNew(true)
    setDraft(EMPTY_DRAFT)
    setPendingDeleteID(null)
  }

  async function save() {
    if (!draft.body.trim() || isSaving) return
    setIsSaving(true)
    try {
      if (isNew) {
        const created = await createPrompt(draft)
        if (created) {
          setSelectedID(created.id)
          setIsNew(false)
          setDraft({ title: created.title, body: created.body })
        }
        return
      }
      if (selectedID) {
        const updated = await updatePrompt(selectedID, draft)
        if (updated) setDraft({ title: updated.title, body: updated.body })
      }
    } finally {
      setIsSaving(false)
    }
  }

  async function remove(id: string) {
    if (pendingDeleteID !== id) {
      setPendingDeleteID(id)
      return
    }
    await deletePrompt(id)
    setPendingDeleteID(null)
    setSelectedID(null)
    setIsNew(false)
    setDraft(EMPTY_DRAFT)
  }

  const variables = parsePromptVariables(draft.body)
  const canSave = draft.body.trim().length > 0 && !isSaving

  return (
    <Dialog
      open={open}
      onOpenChange={setPromptManagerOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>提示词库</DialogTitle>
          <DialogDescription>
            在输入框里打 <code className="font-mono">::</code> 就能挑一条插入；模板里的{' '}
            <code className="font-mono">{'{name}'}</code> 会保留成文本，插进去再填。
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 grid-cols-[13rem_1fr] gap-3">
          <div className="flex min-h-0 flex-col gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mb-1 justify-start gap-1.5"
              onClick={startNew}>
              <Icon
                icon="lucide:plus"
                className="size-3.5"
              />
              新建提示词
            </Button>
            <div className="flex max-h-[min(46vh,22rem)] flex-col gap-0.5 overflow-y-auto">
              {prompts.map(function (prompt) {
                const count = parsePromptVariables(prompt.body).length
                return (
                  <button
                    key={prompt.id}
                    type="button"
                    data-selected={!isNew && prompt.id === selectedID ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm transition-colors',
                      'hover:bg-foreground/[0.03] data-selected:bg-foreground/[0.06]'
                    )}
                    onClick={function () {
                      selectPrompt(prompt)
                    }}>
                    <span className="min-w-0 flex-1 truncate">{prompt.title}</span>
                    {count > 0 ? (
                      <span className="text-muted-foreground font-mono text-xs">{count}</span>
                    ) : null}
                  </button>
                )
              })}
              {prompts.length === 0 ? (
                <p className="text-muted-foreground px-2 py-1.5 text-xs">还没有提示词</p>
              ) : null}
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <Input
              value={draft.title}
              placeholder="标题（留空取正文第一行）"
              aria-label="提示词标题"
              onChange={function (event) {
                setDraft(function (previous) {
                  return { ...previous, title: event.target.value }
                })
              }}
            />
            <Textarea
              value={draft.body}
              placeholder="模板正文；变量写成 {branch} 这种形式"
              aria-label="提示词正文"
              className="min-h-[9rem] font-mono text-sm"
              onChange={function (event) {
                setDraft(function (previous) {
                  return { ...previous, body: event.target.value }
                })
              }}
            />
            <div className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs">
              {variables.length === 0 ? (
                <span>没有变量</span>
              ) : (
                variables.map(function (name) {
                  return (
                    <span
                      key={name}
                      className="bg-foreground/[0.06] rounded px-1.5 py-0.5 font-mono">
                      {'{' + name + '}'}
                    </span>
                  )
                })
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          {!isNew && selectedID ? (
            <Button
              type="button"
              variant="ghost"
              className={cn('mr-auto', pendingDeleteID === selectedID && 'text-destructive')}
              onClick={function () {
                void remove(selectedID)
              }}>
              {pendingDeleteID === selectedID ? '再点一次删除' : '删除'}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            onClick={function () {
              setPromptManagerOpen(false)
            }}>
            关闭
          </Button>
          <Button
            type="button"
            disabled={!canSave}
            onClick={function () {
              void save()
            }}>
            {isNew ? '创建' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { PromptLibraryManager }
