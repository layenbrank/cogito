/**
 * 工具栏里的 AI 菜单：选动作 → 取输入 → 预览 diff → 应用。
 *
 * 自成一体（只要一个 `editor`）是为了不把回调一路穿到工具栏：
 * Section / FormatToolbar 都只是「按钮摆在哪」，不需要知道 AI 的任何状态。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import type { Editor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { runInlinePrompt } from '@/features/agent/inline-prompt'
import { reportCaught } from '@/utils/exception-report'
import { AI_ACTIONS, applyAiResult, findAiPlan, type AiAction, type AiPlan } from '@/views/knowledge/lib/ai-edit.ts'
import { t } from '@/views/knowledge/locale.ts'
import { AiPreviewDialog } from '@/views/knowledge/workspace/ai-preview-dialog.tsx'

const AI_ORDER: readonly AiAction[] = ['continue', 'rewrite', 'summarize']

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return t('AI_FAILED')
}

interface AiMenuProps {
  editor: Editor | null
}

function AiMenu(props: AiMenuProps) {
  const [plan, setPlan] = useState<AiPlan | null>(null)
  const [suggestion, setSuggestion] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // 组件卸载（切到源码模式等）时别把一轮请求晾着
  useEffect(function () {
    return function () {
      abortRef.current?.abort()
    }
  }, [])

  async function run(next: AiPlan) {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setIsBusy(true)
    setError(null)
    setSuggestion('')
    try {
      const content = await runInlinePrompt({ text: next.prompt, signal: controller.signal })
      if (controller.signal.aborted) return
      setSuggestion(content)
    } catch (cause) {
      if (controller.signal.aborted) return
      reportCaught('knowledge.ai', cause, 'warning')
      setError(toMessage(cause))
    } finally {
      if (!controller.signal.aborted) setIsBusy(false)
    }
  }

  function start(action: AiAction) {
    if (!props.editor) return
    const next = findAiPlan(props.editor, action)
    if (!next) {
      toast.error(
        action === 'rewrite'
          ? t('AI_NEED_SELECTION')
          : action === 'continue'
            ? t('AI_NEED_CONTEXT')
            : t('AI_NEED_CONTENT')
      )
      return
    }
    setPlan(next)
    void run(next)
  }

  function close() {
    abortRef.current?.abort()
    setPlan(null)
    setSuggestion('')
    setError(null)
    setIsBusy(false)
  }

  function apply() {
    if (!props.editor || !plan) return
    applyAiResult(props.editor, plan, suggestion)
    close()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 rounded-md px-2 text-xs"
              disabled={!props.editor}
              aria-label="AI 写作辅助"
              title="AI 写作辅助"
            />
          }>
          <Icon
            icon="lucide:sparkles"
            className="size-4"
          />
          AI
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-44">
          {AI_ORDER.map(function (action) {
            const meta = AI_ACTIONS[action]
            return (
              <DropdownMenuItem
                key={action}
                onClick={function () {
                  start(action)
                }}>
                <Icon
                  icon={meta.icon}
                  className="size-4"
                />
                {meta.label}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <AiPreviewDialog
        open={plan !== null}
        actionLabel={plan ? AI_ACTIONS[plan.action].label : ''}
        original={plan?.original ?? ''}
        suggestion={suggestion}
        isBusy={isBusy}
        error={error}
        onOpenChange={function (open) {
          if (!open) close()
        }}
        onApply={apply}
        onRetry={function () {
          if (plan) void run(plan)
        }}
      />
    </>
  )
}

export { AiMenu }
