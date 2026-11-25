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
import { cn } from 'cn'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { applyRename, planRename, undoRename, type RenamePlan } from '@/views/gallery/data/rename'
import type { GalleryMedia } from '@/views/gallery/model/media'

const DEFAULT_TEMPLATE = '{date}_{place}_{seq}'

interface BatchRenameDialogProps {
  open: boolean
  medias: GalleryMedia[]
  onOpenChange: (open: boolean) => void
  /** 改名成功后刷新图库（文件路径已变，必须重读索引） */
  onApplied: () => void
}

function BatchRenameDialog(props: BatchRenameDialogProps) {
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE)
  const [place, setPlace] = useState('')
  const [start, setStart] = useState('1')
  const [plan, setPlan] = useState<RenamePlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startNumber = useMemo(
    function () {
      const parsed = Number.parseInt(start, 10)
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
    },
    [start]
  )

  useEffect(
    function () {
      if (!props.open) return
      setTemplate(DEFAULT_TEMPLATE)
      setPlace('')
      setStart('1')
      setPlan(null)
      setError(null)
      setBusy(false)
      setApplying(false)
    },
    [props.open]
  )

  const preview = useCallback(
    async function (nextTemplate: string, nextPlace: string, nextStart: number) {
      if (props.medias.length === 0) return
      setBusy(true)
      setError(null)
      try {
        const result = await planRename(
          props.medias.map(function (media) {
            return media.asset.id
          }),
          { template: nextTemplate, place: nextPlace, start: nextStart }
        )
        setPlan(result)
      } catch (cause) {
        // 打开对话框会自动预览一次，失败时不弹 toast 打断，但必须留痕
        console.error('[gallery] 重命名预览失败', cause)
        setPlan(null)
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setBusy(false)
      }
    },
    [props.medias]
  )

  useEffect(
    function () {
      if (!props.open || props.medias.length === 0) return
      // 只在打开 / 选择集变化时自动预览一次；输入变化交给「预览」按钮
      void preview(DEFAULT_TEMPLATE, '', 1)
    },
    [props.open, props.medias, preview]
  )

  async function undo(journalPath: string) {
    try {
      const undoResult = await undoRename(journalPath)
      toast.success(`已撤销 ${undoResult.restored.length} 项，文件名已改回`)
      props.onApplied()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      toast.error(`撤销失败：${message}`)
    }
  }

  async function execute() {
    if (!plan || plan.rows.length === 0 || plan.conflicts.length > 0) return
    setApplying(true)
    setError(null)
    try {
      const result = await applyRename(
        plan.rows.map(function (row) {
          return { id: row.id, toName: row.toName }
        })
      )
      const sidecarNote = result.sidecars > 0 ? `，连带 ${result.sidecars} 个边车` : ''
      toast.success(`已重命名 ${result.renamed.length} 个文件${sidecarNote}`, {
        description: `迁移日志：${result.journalPath}`,
        action: {
          label: '撤销',
          onClick: function () {
            void undo(result.journalPath)
          }
        }
      })
      props.onOpenChange(false)
      props.onApplied()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      toast.error(`重命名失败：${message}`)
      setError(message)
    } finally {
      setApplying(false)
    }
  }

  const blocked = !plan || plan.rows.length === 0 || plan.conflicts.length > 0
  const conflictByID = useMemo(
    function () {
      const map = new Map<string, string>()
      plan?.conflicts.forEach(function (conflict) {
        map.set(conflict.id, conflict.message)
      })
      return map
    },
    [plan]
  )

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>批量重命名</DialogTitle>
          <DialogDescription>
            文件名会真实改变，并同步图库索引。先预览再执行；有冲突时整批不改。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <label className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">命名模板</span>
            <Input
              value={template}
              aria-label="命名模板"
              onChange={function (event) {
                setTemplate(event.target.value)
              }}
            />
            <span className="text-xs text-muted-foreground">
              可用占位符：<code>{'{date}'}</code> 拍摄日期 · <code>{'{place}'}</code> 地点 ·{' '}
              <code>{'{seq}'}</code> 序号 · <code>{'{name}'}</code> 原文件名。扩展名自动保留。
            </span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">地点（留空则用照片关键词）</span>
              <Input
                value={place}
                placeholder="如：京都"
                aria-label="地点"
                onChange={function (event) {
                  setPlace(event.target.value)
                }}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">起始序号</span>
              <Input
                value={start}
                type="number"
                min={1}
                aria-label="起始序号"
                onChange={function (event) {
                  setStart(event.target.value)
                }}
              />
            </label>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy || props.medias.length === 0}
              onClick={function () {
                void preview(template, place, startNumber)
              }}>
              <Icon icon={busy ? 'lucide:loader-circle' : 'lucide:refresh-cw'} className={busy ? 'animate-spin' : undefined} />
              预览
            </Button>
            <span className="text-xs text-muted-foreground">
              选中 {props.medias.length} 项
              {plan ? ` · 将改名 ${plan.rows.length} 项` : ''}
              {plan && plan.skipped.length > 0 ? ` · ${plan.skipped.length} 项无需改动` : ''}
            </span>
          </div>

          {error ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {plan && plan.conflicts.length > 0 ? (
            <div
              role="alert"
              className="max-h-32 overflow-y-auto rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <p className="font-medium">发现 {plan.conflicts.length} 处冲突，无法执行：</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {plan.conflicts.map(function (conflict) {
                  return <li key={`${conflict.id}:${conflict.code}`}>{conflict.message}</li>
                })}
              </ul>
            </div>
          ) : null}

          {plan && plan.rows.length > 0 ? (
            <div className="max-h-64 overflow-y-auto rounded-md border border-border/60">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">原文件名</th>
                    <th className="px-2 py-1.5 font-medium">新文件名</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map(function (row) {
                    return (
                      <tr
                        key={row.id}
                        className="border-t border-border/40">
                        <td className="max-w-0 truncate px-2 py-1.5 text-muted-foreground">
                          {row.fromName}
                        </td>
                        <td
                          className={cn(
                            'max-w-0 truncate px-2 py-1.5',
                            conflictByID.has(row.id) && 'text-destructive'
                          )}>
                          {row.toName}
                          {row.warnings.length > 0 ? (
                            <span
                              className="ml-1 text-amber-500"
                              title={row.warnings.join('；')}>
                              ⚠
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={function () {
              props.onOpenChange(false)
            }}>
            取消
          </Button>
          <Button
            type="button"
            disabled={blocked || applying || busy}
            onClick={function () {
              void execute()
            }}>
            {applying ? '执行中…' : '执行改名'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { BatchRenameDialog }
export type { BatchRenameDialogProps }
