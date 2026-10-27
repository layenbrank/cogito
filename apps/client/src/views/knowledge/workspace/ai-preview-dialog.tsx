/**
 * AI 结果预览：先看 diff 再决定要不要落进文档。
 *
 * 刻意不做成「一边编辑器一边预览」：改写结果常常只是几行差异，
 * 统一 diff 比对着两栏长文本找不同快得多。
 */
import { Button } from '@cogito/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import { Spinner } from '@cogito/design/components/spinner'
import { cn } from 'cn'

import { t } from '@/views/knowledge/locale.ts'
import { countDiff, diffLines, type DiffRow } from '@/views/knowledge/lib/diff.ts'

interface AiPreviewDialogProps {
  open: boolean
  /** 动作名（续写 / 重写 / 总结），显示在标题里 */
  actionLabel: string
  /** 被替换的原文；续写与总结为空 */
  original: string
  /** 模型给出的正文；生成中为空 */
  suggestion: string
  isBusy: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onApply: () => void
  onRetry: () => void
}

const DIFF_PREFIX: Record<DiffRow['kind'], string> = {
  same: ' ',
  add: '+',
  remove: '-'
}

const DIFF_CLASS: Record<DiffRow['kind'], string> = {
  same: 'text-muted-foreground',
  add: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  remove: 'bg-destructive/10 text-destructive'
}

function DiffBody(props: { original: string; suggestion: string }) {
  const rows = diffLines(props.original, props.suggestion)
  const { added, removed } = countDiff(rows)
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {removed > 0 ? `−${removed} 行 · ` : ''}+{added} 行
      </p>
      <div className="max-h-[52vh] overflow-auto rounded-md border border-border bg-muted/30">
        <pre className="min-w-full p-2 text-xs leading-5">
          {rows.map(function (row, index) {
            return (
              <div
                // diff 行本身没有稳定 id，位置即身份
                key={index}
                className={cn('whitespace-pre-wrap wrap-break-word px-1', DIFF_CLASS[row.kind])}>
                {DIFF_PREFIX[row.kind]} {row.text}
              </div>
            )
          })}
        </pre>
      </div>
    </>
  )
}

function AiPreviewDialog(props: AiPreviewDialogProps) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-150">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {t('AI_PREVIEW_TITLE')} · {props.actionLabel}
          </DialogTitle>
        </DialogHeader>
        <DialogDescription className="text-xs text-muted-foreground">
          应用后可用 Ctrl+Z 整体撤销。
        </DialogDescription>

        {props.isBusy ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            {t('AI_RUNNING')}
          </p>
        ) : null}

        {props.error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-xs text-destructive">
            {props.error}
          </p>
        ) : null}

        {!props.isBusy && !props.error ? (
          <DiffBody
            original={props.original}
            suggestion={props.suggestion}
          />
        ) : null}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={function () {
              props.onOpenChange(false)
            }}>
            {t('CONFIRM_CANCEL')}
          </Button>
          <Button
            variant="outline"
            disabled={props.isBusy}
            onClick={props.onRetry}>
            {t('AI_RETRY')}
          </Button>
          <Button
            disabled={props.isBusy || !!props.error || !props.suggestion.trim()}
            onClick={props.onApply}>
            {t('AI_APPLY')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { AiPreviewDialog }
export type { AiPreviewDialogProps }
