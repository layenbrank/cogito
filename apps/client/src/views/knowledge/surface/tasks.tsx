/**
 * 左面板 · 任务页：定时任务的增删改、立即执行与执行记录（全部就地，不弹框）。
 *
 * 语义只有一处要说清楚：**应用没运行就不会执行**（本机 worker 才有排期）。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { ScrollArea } from '@cogito/design/components/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Switch } from '@cogito/design/components/switch'
import { Textarea } from '@cogito/design/components/textarea'
import { useEffect, useState } from 'react'

import { SCHEDULE_PRESETS, describeSchedule } from '@/features/automation/describe-schedule'
import { DICT_TYPE, DICT_VALUE } from '@/shared/ipc/specs/dict'
import { useAutomationStore } from '@/stores/automation'
import { useDictStore } from '@/stores/dict'
import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { formatTime } from '@/views/knowledge/lib/format.ts'

const OWNER = DICT_VALUE.AUTOMATION_OWNER
const RUN_AS = DICT_VALUE.AUTOMATION_RUN_AS

type Owner =
  | typeof OWNER.CLIENT
  | typeof OWNER.GOOSE
  | typeof OWNER.CLOUD

interface Draft {
  id: string | null
  name: string
  prompt: string
  schedule: string
  knowledgeBaseId: string | null
  enabled: boolean
  owner: Owner
}

const EMPTY: Draft = {
  id: null,
  name: '',
  prompt: '',
  schedule: '0 9 * * *',
  knowledgeBaseId: null,
  enabled: true,
  owner: OWNER.CLIENT
}

function isOwner(value: string): value is Owner {
  return value === OWNER.CLIENT || value === OWNER.GOOSE || value === OWNER.CLOUD
}

function TaskForm(props: { draft: Draft; onClose: () => void }) {
  const [draft, setDraft] = useState(props.draft)
  const bases = useKnowledgeBaseStore(function (state) {
    return state.bases
  })
  const save = useAutomationStore(function (state) {
    return state.save
  })
  const findLabel = useDictStore(function (state) {
    return state.findLabel
  })

  const canSave = draft.name.trim() && draft.prompt.trim() && draft.schedule.trim()

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border p-2">
      <Input
        placeholder="任务名称"
        value={draft.name}
        className="h-7 text-xs"
        onChange={function (event) {
          setDraft({ ...draft, name: event.target.value })
        }}
      />
      <Textarea
        placeholder="执行提示词"
        value={draft.prompt}
        className="min-h-16 text-xs"
        onChange={function (event) {
          setDraft({ ...draft, prompt: event.target.value })
        }}
      />
      <Input
        placeholder="crontab（分 时 日 月 周）"
        value={draft.schedule}
        className="h-7 font-mono text-xs"
        onChange={function (event) {
          setDraft({ ...draft, schedule: event.target.value })
        }}
      />
      <div className="flex flex-wrap gap-1">
        {SCHEDULE_PRESETS.map(function (preset) {
          return (
            <Button
              key={preset.value}
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[11px] font-normal"
              onClick={function () {
                setDraft({ ...draft, schedule: preset.value })
              }}>
              {preset.label}
            </Button>
          )
        })}
      </div>
      <div className="flex items-center gap-1">
        {draft.owner === OWNER.CLOUD ? null : (
          <Select
            value={draft.knowledgeBaseId ?? 'none'}
            onValueChange={function (value) {
              setDraft({
                ...draft,
                knowledgeBaseId: value === 'none' || typeof value !== 'string' ? null : value
              })
            }}>
            <SelectTrigger
              size="sm"
              className="min-w-0 flex-1">
              <SelectValue placeholder="关联知识库" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">不关联知识库</SelectItem>
              {bases.map(function (base) {
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
        )}
        <Select
          value={draft.owner}
          disabled={draft.owner === OWNER.CLOUD && Boolean(draft.id)}
          onValueChange={function (value) {
            if (typeof value === 'string' && isOwner(value)) {
              setDraft({ ...draft, owner: value })
            }
          }}>
          <SelectTrigger
            size="sm"
            className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={OWNER.CLIENT}>
              {findLabel(DICT_TYPE.AUTOMATION_OWNER, OWNER.CLIENT)}
            </SelectItem>
            <SelectItem value={OWNER.GOOSE}>
              {findLabel(DICT_TYPE.AUTOMATION_OWNER, OWNER.GOOSE)}
            </SelectItem>
            <SelectItem value={OWNER.CLOUD}>
              {findLabel(DICT_TYPE.AUTOMATION_OWNER, OWNER.CLOUD)}
            </SelectItem>
          </SelectContent>
        </Select>
        <Switch
          checked={draft.enabled}
          onCheckedChange={function (checked) {
            setDraft({ ...draft, enabled: checked })
          }}
        />
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          disabled={!canSave}
          onClick={function () {
            void save({
              id: draft.id ?? undefined,
              name: draft.name.trim(),
              prompt: draft.prompt.trim(),
              schedule: draft.schedule.trim(),
              knowledgeBaseId: draft.knowledgeBaseId,
              enabled: draft.enabled,
              owner: draft.owner,
              runAsKind: RUN_AS.USER
            }).then(function (ok) {
              if (ok) props.onClose()
            })
          }}>
          保存
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={props.onClose}>
          取消
        </Button>
      </div>
    </div>
  )
}

function TasksTab() {
  const items = useAutomationStore(function (state) {
    return state.items
  })
  const cloudItems = useAutomationStore(function (state) {
    return state.cloudItems
  })
  const cloudStatus = useAutomationStore(function (state) {
    return state.cloudStatus
  })
  const cloudError = useAutomationStore(function (state) {
    return state.cloudError
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
  const findLabel = useDictStore(function (state) {
    return state.findLabel
  })

  const [draft, setDraft] = useState<Draft | null>(null)

  // 本机在前、服务端在后：两边的「立即执行」语义不同，不混着排
  const all = [...items, ...cloudItems]

  useEffect(
    function () {
      void refresh()
    },
    [refresh]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between px-0.5 text-[11px] text-muted-foreground">
        <span>
          共 {all.length} 条 · 本机任务需应用运行时才执行，服务端任务由服务端排期
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-[11px] font-normal"
          onClick={function () {
            setDraft({ ...EMPTY })
          }}>
          <Icon
            icon="lucide:plus"
            className="size-3"
          />
          新建
        </Button>
      </div>

      {cloudStatus === 'error' ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
          服务端任务读取失败：{cloudError}
        </p>
      ) : null}

      {draft ? (
        <TaskForm
          draft={draft}
          onClose={function () {
            setDraft(null)
          }}
        />
      ) : null}

      <ScrollArea className="min-h-0 flex-1">
        {all.length === 0 && !isLoading ? (
          <p className="px-1 py-2 text-[11px] text-muted-foreground">还没有定时任务。</p>
        ) : null}
        <ul className="flex flex-col gap-1.5">
          {all.map(function (item) {
            const isOpen = activeId === item.id
            const isCloud = item.owner === OWNER.CLOUD
            return (
              <li
                key={item.id}
                className="rounded-md border border-border px-2 py-1.5">
                <div className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-xs">{item.name}</span>
                  <Switch
                    checked={item.enabled}
                    onCheckedChange={function (checked) {
                      void toggle(item.id, checked)
                    }}
                  />
                </div>
                <p className="truncate text-[11px] text-muted-foreground">
                  {describeSchedule(item.schedule)} ·{' '}
                  {findLabel(DICT_TYPE.AUTOMATION_OWNER, item.owner)}
                  {item.enabled ? ` · 下次 ${formatTime(item.nextRunAt)}` : ' · 已停用'}
                </p>
                {item.lastStatus ? (
                  <p className="truncate text-[11px] text-muted-foreground">
                    上次 {findLabel(DICT_TYPE.AUTOMATION_RUN_STATUS, item.lastStatus)} ·{' '}
                    {formatTime(item.lastRunAt)}
                    {item.lastError ? ` · ${item.lastError}` : ''}
                  </p>
                ) : null}
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    disabled={running[item.id] || isCloud}
                    title={isCloud ? '服务端任务按排期执行，不能手动触发' : '立即跑一次'}
                    onClick={function () {
                      void runNow(item.id)
                    }}>
                    {running[item.id] ? '执行中' : '立即执行'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-[11px]"
                    disabled={isCloud}
                    title={isCloud ? '服务端任务的执行记录在服务端' : '查看执行记录'}
                    onClick={function () {
                      if (isOpen) closeRuns()
                      else void openRuns(item.id)
                    }}>
                    {isOpen ? '收起记录' : '记录'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-[11px]"
                    onClick={function () {
                      setDraft({
                        id: item.id,
                        name: item.name,
                        prompt: item.prompt,
                        schedule: item.schedule,
                        knowledgeBaseId: item.knowledgeBaseId ?? null,
                        enabled: item.enabled,
                        owner: isOwner(item.owner) ? item.owner : OWNER.CLIENT
                      })
                    }}>
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-[11px] text-destructive"
                    onClick={function () {
                      void remove(item.id)
                    }}>
                    删除
                  </Button>
                </div>
                {isOpen ? (
                  <ul className="mt-1 flex flex-col gap-0.5 border-t border-border pt-1">
                    {runs.length === 0 ? (
                      <li className="text-[11px] text-muted-foreground">还没有执行记录。</li>
                    ) : null}
                    {runs.map(function (run) {
                      return (
                        <li
                          key={run.id}
                          className="truncate text-[11px] text-muted-foreground">
                          {formatTime(run.startedAt ?? run.createdAt)} ·{' '}
                          {findLabel(DICT_TYPE.AUTOMATION_TRIGGER_KIND, run.triggerKind)} ·{' '}
                          {findLabel(DICT_TYPE.AUTOMATION_RUN_STATUS, run.status)}
                          {run.error ? ` · ${run.error}` : ''}
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>
      </ScrollArea>
    </div>
  )
}

export { TasksTab }
