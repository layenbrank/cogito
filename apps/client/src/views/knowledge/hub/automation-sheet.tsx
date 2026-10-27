/**
 * 自动化面板：定时任务的增删改、立即执行与执行记录。
 *
 * 定位：知识库侧栏里的一个独立 Sheet（不塞进主面板，那里已经有库/文档/检索/草稿四块）。
 * 语义要说清楚的地方只有一处：**应用没运行就不会执行**，所以到期时间旁边直接标注。
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
import { Label } from '@cogito/design/components/label'
import { ScrollArea } from '@cogito/design/components/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Spinner } from '@cogito/design/components/spinner'
import { Switch } from '@cogito/design/components/switch'
import { Textarea } from '@cogito/design/components/textarea'
import { useEffect, useState } from 'react'

import { SCHEDULE_PRESETS, describeSchedule } from '@/features/automation/describe-schedule'
import type { KnowledgeBase } from '@/lib/knowledge-ipc'
import { useAutomationStore, type Automation } from '@/stores/automation'

interface AutomationSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bases: KnowledgeBase[]
  activeBaseID: string | null
}

interface DraftState {
  id: string | null
  name: string
  prompt: string
  schedule: string
  knowledgeBaseId: string | null
  enabled: boolean
}

const EMPTY_DRAFT: DraftState = {
  id: null,
  name: '',
  prompt: '',
  schedule: '0 9 * * *',
  knowledgeBaseId: null,
  enabled: true
}

function formatTime(ms: number | null | undefined): string {
  if (!ms) return '—'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(ms))
  } catch (error) {
    console.warn('[automation-sheet] 时间格式化失败:', error)
    return '—'
  }
}

const STATUS_TEXT: Record<string, string> = {
  running: '执行中',
  succeeded: '成功',
  failed: '失败',
  pending: '等待中'
}

const TRIGGER_TEXT: Record<string, string> = {
  schedule: '按时',
  manual: '手动',
  catchup: '补跑'
}

function AutomationSheet(props: AutomationSheetProps) {
  const items = useAutomationStore(function (state) {
    return state.items
  })
  const isLoading = useAutomationStore(function (state) {
    return state.isLoading
  })
  const running = useAutomationStore(function (state) {
    return state.running
  })
  const runs = useAutomationStore(function (state) {
    return state.runs
  })
  const activeId = useAutomationStore(function (state) {
    return state.activeId
  })
  const refresh = useAutomationStore(function (state) {
    return state.refresh
  })
  const save = useAutomationStore(function (state) {
    return state.save
  })
  const toggle = useAutomationStore(function (state) {
    return state.toggle
  })
  const remove = useAutomationStore(function (state) {
    return state.remove
  })
  const runNow = useAutomationStore(function (state) {
    return state.runNow
  })
  const openRuns = useAutomationStore(function (state) {
    return state.openRuns
  })
  const closeRuns = useAutomationStore(function (state) {
    return state.closeRuns
  })

  const [draft, setDraft] = useState<DraftState | null>(null)

  useEffect(
    function () {
      if (!props.open) return
      void refresh()
    },
    [props.open, refresh]
  )

  function startCreate() {
    setDraft({ ...EMPTY_DRAFT, knowledgeBaseId: props.activeBaseID })
  }

  function startEdit(item: Automation) {
    setDraft({
      id: item.id,
      name: item.name,
      prompt: item.prompt,
      schedule: item.schedule,
      knowledgeBaseId: item.knowledgeBaseId ?? null,
      enabled: item.enabled
    })
  }

  async function confirmDraft() {
    const current = draft
    if (!current) return
    const ok = await save({
      id: current.id ?? undefined,
      name: current.name.trim(),
      prompt: current.prompt.trim(),
      knowledgeBaseId: current.knowledgeBaseId,
      schedule: current.schedule.trim(),
      enabled: current.enabled
    })
    if (ok) setDraft(null)
  }

  const canSave = Boolean(draft?.name.trim() && draft?.prompt.trim() && draft?.schedule.trim())
  const activeRunsItem = items.find(function (item) {
    return item.id === activeId
  })

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 sm:max-w-120">
        <DialogHeader>
          <DialogTitle className="text-sm">自动化</DialogTitle>
        </DialogHeader>
        <DialogDescription className="text-xs text-muted-foreground">
          到点后由智能体跑一次，结果记在「执行记录」。应用没运行时不会执行；错过的时段重启后只补一次。
        </DialogDescription>

        <div className="flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            onClick={startCreate}>
            <Icon
              icon="lucide:plus"
              className="size-4"
            />
            新建任务
          </Button>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          {isLoading && items.length === 0 ? (
            <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
              <Spinner className="size-3" />
              读取中…
            </div>
          ) : items.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">
              还没有任务。可以新建「每天整理知识库变更」这类定时任务。
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map(function (item) {
                const isRunning = Boolean(running[item.id])
                return (
                  <li
                    key={item.id}
                    className="flex flex-col gap-2 rounded-md border p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-xs font-medium">{item.name}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {describeSchedule(item.schedule)} · 下次 {formatTime(item.nextRunAt)}
                        </span>
                        {item.lastStatus ? (
                          <span className="truncate text-xs text-muted-foreground">
                            上次 {STATUS_TEXT[item.lastStatus] ?? item.lastStatus}
                            {item.lastStatus === 'failed' && item.lastError
                              ? `：${item.lastError}`
                              : ''}
                          </span>
                        ) : null}
                      </div>
                      <Switch
                        checked={item.enabled}
                        aria-label="启用"
                        onCheckedChange={function (checked) {
                          void toggle(item.id, checked)
                        }}
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isRunning}
                        onClick={function () {
                          void runNow(item.id)
                        }}>
                        {isRunning ? <Spinner className="size-3" /> : null}
                        立即执行
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={function () {
                          void openRuns(item.id)
                        }}>
                        记录
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={function () {
                          startEdit(item)
                        }}>
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={function () {
                          void remove(item.id)
                        }}>
                        删除
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </ScrollArea>

        <Dialog
          open={draft !== null}
          onOpenChange={function (open) {
            if (!open) setDraft(null)
          }}>
          <DialogContent className="sm:max-w-105">
            <DialogHeader>
              <DialogTitle className="text-sm">{draft?.id ? '编辑任务' : '新建任务'}</DialogTitle>
            </DialogHeader>
            <DialogDescription className="text-xs text-muted-foreground">
              任务内容会作为一句话交给智能体；它只能做只读操作，需要写入时会失败并记进执行记录。
            </DialogDescription>
            <div className="flex flex-col gap-2">
              <Label className="text-xs">名称</Label>
              <Input
                value={draft?.name ?? ''}
                placeholder="例如：每天整理知识库变更"
                onChange={function (event) {
                  const value = event.target.value
                  setDraft(function (prev) {
                    return prev ? { ...prev, name: value } : prev
                  })
                }}
              />
              <Label className="text-xs">任务内容</Label>
              <Textarea
                value={draft?.prompt ?? ''}
                rows={3}
                placeholder="例如：检索本库最近新增的文档，归纳成一页摘要"
                onChange={function (event) {
                  const value = event.target.value
                  setDraft(function (prev) {
                    return prev ? { ...prev, prompt: value } : prev
                  })
                }}
              />
              <Label className="text-xs">计划</Label>
              <Input
                value={draft?.schedule ?? ''}
                placeholder="分 时 日 月 周，例如 0 9 * * *"
                onChange={function (event) {
                  const value = event.target.value
                  setDraft(function (prev) {
                    return prev ? { ...prev, schedule: value } : prev
                  })
                }}
              />
              <div className="flex flex-wrap items-center gap-1">
                {SCHEDULE_PRESETS.map(function (preset) {
                  return (
                    <Button
                      key={preset.value}
                      size="sm"
                      variant="ghost"
                      onClick={function () {
                        setDraft(function (prev) {
                          return prev ? { ...prev, schedule: preset.value } : prev
                        })
                      }}>
                      {preset.label}
                    </Button>
                  )
                })}
                <span className="ml-auto text-xs text-muted-foreground">
                  {draft ? describeSchedule(draft.schedule) : ''}
                </span>
              </div>
              <Label className="text-xs">关联知识库（可选）</Label>
              <Select
                value={draft?.knowledgeBaseId ?? 'none'}
                onValueChange={function (value) {
                  const next = value === 'none' ? null : value
                  setDraft(function (prev) {
                    return prev ? { ...prev, knowledgeBaseId: next } : prev
                  })
                }}>
                <SelectTrigger size="sm">
                  <SelectValue placeholder="不关联" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不关联</SelectItem>
                  {props.bases.map(function (base) {
                    return (
                      <SelectItem
                        key={base.id}
                        value={base.id}>
                        {base.name}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>启用</span>
                <Switch
                  checked={draft?.enabled ?? false}
                  onCheckedChange={function (checked) {
                    setDraft(function (prev) {
                      return prev ? { ...prev, enabled: checked } : prev
                    })
                  }}
                />
              </label>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={function () {
                  setDraft(null)
                }}>
                取消
              </Button>
              <Button
                disabled={!canSave}
                onClick={function () {
                  void confirmDraft()
                }}>
                保存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={activeId !== null}
          onOpenChange={function (open) {
            if (!open) closeRuns()
          }}>
          <DialogContent className="sm:max-w-120">
            <DialogHeader>
              <DialogTitle className="text-sm">
                执行记录 · {activeRunsItem?.name ?? ''}
              </DialogTitle>
            </DialogHeader>
            <DialogDescription className="text-xs text-muted-foreground">
              只保留最近 10 次；输出是智能体这轮的回复（超长会截断）。
            </DialogDescription>
            <ScrollArea className="max-h-80">
              {runs.length === 0 ? (
                <p className="p-2 text-xs text-muted-foreground">还没有执行过。</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {runs.map(function (run) {
                    return (
                      <li
                        key={run.id}
                        className="flex flex-col gap-1 rounded-md border p-2">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{formatTime(run.scheduledFor)}</span>
                          <span>· {TRIGGER_TEXT[run.triggerKind] ?? run.triggerKind}</span>
                          <span>· {STATUS_TEXT[run.status] ?? run.status}</span>
                        </div>
                        {run.error ? (
                          <p className="text-xs text-destructive">{run.error}</p>
                        ) : null}
                        {run.output ? (
                          <p className="whitespace-pre-wrap text-xs">{run.output}</p>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              )}
            </ScrollArea>
            <DialogFooter>
              <Button onClick={closeRuns}>关闭</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}

export { AutomationSheet }
