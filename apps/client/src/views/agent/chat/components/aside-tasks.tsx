/**
 * 右栏「任务」面板：卡片式管理 + 创建，不再跳独立页面。
 *
 * 三视图共用一块面板（列表 / 详情 / 表单），返回不离开当前会话：
 * - 列表：按执行方分组的**网格卡片**（`schedule-card` 元素：名称 / 周期 / 启停 / 下次触发 / 最近执行），
 *   卡底一行是立即执行 + 更多；窄栏一列、右栏拉宽自动 2–4 列；
 * - 详情：点卡片进入，定义卡片 + 执行记录（`TaskRuns`），可编辑 / 删除；
 * - 表单：新建与编辑（`TaskForm`，单列窄栏布局）。
 *
 * 版式跟「详情」页签（`aside-busy` + `aside-section`）共用同一套语言：
 * 抬头 14px、正文 13px、元信息 12px，卡片用 `schedule-card` 元素的纸面，
 * 分区用 `AsideSection`（图标 + 标题 + 右侧动作）。此前这里是 11px 一套自写 scss，
 * 切页签像换了个人做的。
 *
 * 数据仍走 `stores/automation`（本机 / goose / 服务端三源），纯逻辑在
 * `views/agent/tasks/model.ts`；这里只做组合与呈现。
 */
import { Icon } from '@iconify/react/offline'
import { ScheduleCard } from '@cogito/design/assistant/schedule-card'
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
import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { Switch } from '@cogito/design/components/switch'
import { clsx } from 'clsx'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { useAui } from '@assistant-ui/react'
import { toast } from 'sonner'

import { describeSchedule } from '@/features/automation/describe-schedule'
import type { Automation } from '@/shared/ipc/specs/automation'
import { DICT_TYPE } from '@/shared/ipc/specs/dict'
import { useAgentStore } from '@/stores/agent.ts'
import { useAutomationStore } from '@/stores/automation'
import { useDictStore } from '@/stores/dict'
import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { useProviderStore } from '@/stores/provider'
import { AsideSection } from '@/views/agent/chat/components/aside-section'
import { subscribeAsideTasks } from '@/views/agent/chat/components/open-aside-tasks'
import { formatTime } from '@/views/knowledge/lib/format.ts'
import {
  OWNER,
  buildTaskGroups,
  canRunNow,
  createDraft,
  findOwnerHint,
  findPhaseLabel,
  findRecentRuns,
  findSessionModeLabel,
  findTaskBadge,
  findTaskModeLabel,
  findTaskModeTag,
  toDraft,
  type TaskDraft
} from '@/views/agent/tasks/model'
import { TaskForm } from '@/views/agent/tasks/task-form'
import { TaskRuns } from '@/views/agent/tasks/task-runs'
import { TaskStatusPill } from '@/views/agent/tasks/task-status-pill'

type PanelView =
  | { kind: 'list' }
  | { kind: 'detail'; id: string }
  | { kind: 'all-runs' }
  | { kind: 'form'; draft: TaskDraft }

/** 执行方的图标与点缀色：与详情页签里「命令 / 工作区」的图标色同一档饱和度 */
const OWNER_ICON: Record<string, { icon: string; tone: string }> = {
  [OWNER.CLIENT]: { icon: 'lucide:monitor', tone: 'text-muted-foreground' },
  [OWNER.GOOSE]: { icon: 'lucide:bot', tone: 'text-primary' },
  [OWNER.CLOUD]: { icon: 'lucide:cloud', tone: 'text-sky-500' }
}

function findOwnerIcon(owner: string): { icon: string; tone: string } {
  return OWNER_ICON[owner] ?? { icon: 'lucide:circle-dot', tone: 'text-muted-foreground' }
}

/** 下次触发那一格的值：只说时间（`next` 的标签卡上已经有了） */
function findNextRunValue(item: Automation): string {
  if (!item.nextRunAt) {
    if (item.owner === OWNER.CLOUD) return '排期在服务端'
    if (item.owner === OWNER.GOOSE) return '排期在 goose'
    return '未排期'
  }
  return formatTime(item.nextRunAt)
}

/** 详情里的「下次触发」：停用态不编假时间，直接说「已停用」 */
function findNextLabel(item: Automation): string {
  if (!item.enabled) return '已停用'
  if (!item.nextRunAt) return findNextRunValue(item)
  return `下次 ${formatTime(item.nextRunAt)}`
}

/**
 * 定义区的一行：左标签 12px、右值 13px。
 *
 * 292px 宽下八条字段竖排会吃掉一整屏，所以不用「每条一段 label+value」，
 * 而是一行一格（跟详情页签里的 Chip 行同一密度）。
 */
function MetaRow(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-muted-foreground w-[4.25rem] shrink-0 text-xs">{props.label}</span>
      {/* 值可能是「人话 + 表达式」两段：用 flex 拉开间距，别让它们粘成一句 */}
      <span className="text-foreground flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 text-[13px] leading-relaxed break-words">
        {props.children}
      </span>
    </div>
  )
}

/** 面板抬头：标题 / 计数 / 右侧动作，与「计划」页签的抬头同高同边距 */
function PanelHead(props: { title: string; count?: number; children?: ReactNode }) {
  return (
    <div className="border-border/60 flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
      <h2 className="text-foreground min-w-0 truncate text-sm font-semibold">{props.title}</h2>
      {props.count ? (
        <Badge
          variant="secondary"
          className="h-[18px] shrink-0 px-1.5 text-[11px] tabular-nums">
          {props.count}
        </Badge>
      ) : null}
      <span className="ms-auto flex shrink-0 items-center gap-1">{props.children}</span>
    </div>
  )
}

function AsideTasks() {
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
  const phases = useAutomationStore(function (state) {
    return state.phases
  })
  const aui = useAui()
  const toReadProviders = useProviderStore(function (state) {
    return state.toReadProviders
  })
  const runs = useAutomationStore(function (state) {
    return state.runs
  })
  const allRuns = useAutomationStore(function (state) {
    return state.allRuns
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
  const openAllRuns = useAutomationStore(function (state) {
    return state.openAllRuns
  })
  const findLabel = useDictStore(function (state) {
    return state.findLabel
  })
  const workspaces = useAgentStore(function (state) {
    return state.workspaces
  })
  const folders = useAgentStore(function (state) {
    return state.workspaceFolders
  })
  const bases = useKnowledgeBaseStore(function (state) {
    return state.bases
  })

  const [view, updateView] = useState<PanelView>({ kind: 'list' })
  /** 待确认删除的任务：卡片菜单离「编辑」只差一格，级联删记录前问一句 */
  const [pendingRemove, updatePendingRemove] = useState<Automation | null>(null)

  const all = useMemo(
    function () {
      return [...items, ...cloudItems]
    },
    [items, cloudItems]
  )
  const groups = useMemo(
    function () {
      return buildTaskGroups(items, cloudItems)
    },
    [items, cloudItems]
  )
  const total = all.length
  const picked = view.kind === 'detail' ? all.find((task) => task.id === view.id) : undefined

  useEffect(
    function () {
      void refresh()
      void useAgentStore.getState().toReadWorkspaces()
      void useAgentStore.getState().toReadWorkspaceFolders()
      void useKnowledgeBaseStore.getState().refresh()
      void toReadProviders()
      // 卡片上的执行方 / 状态 / 触发方式都是字典 value，先把三类拉进缓存
      void useDictStore
        .getState()
        .bootstrap([
          DICT_TYPE.AUTOMATION_OWNER,
          DICT_TYPE.AUTOMATION_RUN_STATUS,
          DICT_TYPE.AUTOMATION_TRIGGER_KIND
        ])
    },
    [refresh, toReadProviders]
  )

  useEffect(
    function () {
      return subscribeAsideTasks(function (detail) {
        if (!detail.taskId) return
        updateView({ kind: 'detail', id: detail.taskId })
        void openRuns(detail.taskId)
      })
    },
    [openRuns]
  )

  async function openSession(sessionId: string | null | undefined) {
    if (!sessionId) {
      toast.info('这次执行还没有关联会话')
      return
    }
    try {
      await aui.threads.reload()
      aui.threads.switchToThread(sessionId)
    } catch (error) {
      console.error('[agent/tasks] 打开任务会话失败:', sessionId, error)
      toast.error(error instanceof Error ? error.message : '打开会话失败')
    }
  }

  function findWorkspaceLabel(
    workspaceID: string | null | undefined,
    workspacePath?: string | null
  ): string {
    if (!workspaceID) return '家目录'
    const workspace = workspaces.find(function (item) {
      return item.id === workspaceID
    })
    // 任务可以只绑工作区（跟随默认目录），也可以指定工作区下某个具体目录
    const path =
      workspacePath?.trim() ||
      folders.find(function (item) {
        return item.workspaceID === workspaceID
      })?.path
    return `${workspace?.title ?? workspaceID}${path ? ` · ${path}` : ''}`
  }

  function findBaseLabel(baseID: string | null | undefined): string {
    if (!baseID) return '不关联知识库'
    const base = bases.find(function (item) {
      return item.id === baseID
    })
    return base?.name ?? '原知识库已不存在'
  }

  function openTask(id: string) {
    updateView({ kind: 'detail', id })
    void openRuns(id)
  }

  function openCreate() {
    updateView({ kind: 'form', draft: createDraft(OWNER.CLIENT) })
  }

  function openEdit(task: Automation) {
    updateView({ kind: 'form', draft: toDraft(task) })
  }

  function backToList() {
    updateView({ kind: 'list' })
  }

  function backFromForm(draft: TaskDraft) {
    if (draft.id) openTask(draft.id)
    else backToList()
  }

  function askRemove(task: Automation) {
    updatePendingRemove(task)
  }

  function handleRemove(task: Automation) {
    updatePendingRemove(null)
    void remove(task.id)
    // 详情里删掉的正是当前这条：回列表，别停在找不着任务的空详情
    if (view.kind === 'detail' && view.id === task.id) backToList()
  }

  function renderCard(item: Automation) {
    const isRunning = Boolean(running[item.id])
    const badge = findTaskBadge(item, isRunning)
    const phaseLabel = isRunning ? findPhaseLabel(phases[item.id]) : null
    const isActive = view.kind === 'detail' && view.id === item.id
    const modeTag = findTaskModeTag(item)
    const runLabel = isRunning ? (phaseLabel ?? '执行中') : '立即执行'
    // 最近执行：列表没有跨任务的记录缓存时退回「上一次执行」，不为三行字再发一轮请求
    const history = findRecentRuns(item, allRuns.length > 0 ? allRuns : runs).map(function (run) {
      return { id: run.id, at: formatTime(run.atMs), ok: run.ok }
    })
    return (
      <article
        key={item.id}
        className="group relative flex min-w-0 flex-col">
        {/* 整张卡可点：撑满的透明按钮垫在下面，开关单独抬起来（卡面本身不接指针） */}
        <button
          type="button"
          aria-label={`打开任务 ${item.name}`}
          aria-current={isActive ? 'true' : undefined}
          className="focus-visible:ring-ring/40 absolute inset-0 z-0 rounded-2xl outline-none focus-visible:ring-2"
          onClick={function () {
            openTask(item.id)
          }}
        />
        <ScheduleCard
          className={clsx(
            'pointer-events-none relative z-10 transition-colors group-hover:border-primary/25 [&_[data-slot=schedule-card-switch]]:pointer-events-auto',
            isActive && 'border-primary/40'
          )}
          name={item.name}
          cadence={describeSchedule(item.schedule)}
          nextRun={findNextRunValue(item)}
          enabled={item.enabled}
          history={history}
          onToggle={function () {
            void toggle(item.id, !item.enabled)
          }}
        />
        {item.lastError ? (
          <span
            className="text-destructive relative z-10 mt-1 flex min-w-0 items-center gap-1 text-xs leading-snug"
            title={item.lastError}>
            <Icon
              icon="lucide:circle-alert"
              className="size-3 shrink-0"
            />
            {/* 只占一行：错误长短不一致会把整行卡片撑高（详情里有完整信息） */}
            <span className="truncate">{item.lastError}</span>
          </span>
        ) : null}
        <div className="relative z-10 mt-1 flex items-center gap-1 px-0.5">
          <TaskStatusPill
            tone={badge.tone}
            label={phaseLabel ?? badge.label}
          />
          {modeTag ? (
            <span className="border-border/70 text-muted-foreground shrink-0 rounded-full border px-1 py-px text-[10px] leading-none">
              {modeTag}
            </span>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={clsx(
              'h-7 min-w-0 gap-1 px-1.5 text-xs',
              isRunning ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
            aria-label={runLabel}
            disabled={isRunning || !canRunNow(item)}
            title={
              canRunNow(item)
                ? '立即跑一次（与定时触发同一条路径）'
                : '服务端任务按排期执行，客户端暂时不能手动触发'
            }
            onClick={function () {
              void runNow(item.id)
            }}>
            <Icon
              icon={isRunning ? 'lucide:loader-circle' : 'lucide:play'}
              className={clsx('size-3.5 shrink-0', isRunning && 'animate-spin')}
            />
            <span className="truncate">{runLabel}</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-foreground ms-auto size-6"
                  aria-label="更多操作"
                />
              }>
              <Icon
                icon="lucide:ellipsis"
                className="size-3.5"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={function () {
                  openEdit(item)
                }}>
                编辑
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={function () {
                  openTask(item.id)
                }}>
                查看记录
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={function () {
                  askRemove(item)
                }}>
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </article>
    )
  }

  function renderList() {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PanelHead
          title="任务"
          count={total || undefined}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground size-6"
            aria-label="刷新任务列表"
            title="重新读取本机 / goose / 服务端三份任务"
            onClick={function () {
              void refresh()
            }}>
            <Icon
              icon="lucide:refresh-cw"
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
                  className="text-muted-foreground hover:text-foreground size-6"
                  aria-label="更多任务操作"
                />
              }>
              <Icon
                icon="lucide:ellipsis"
                className="size-3.5"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={function () {
                  updateView({ kind: 'all-runs' })
                  void openAllRuns()
                }}>
                全部执行记录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={openCreate}>
            <Icon
              icon="lucide:plus"
              className="size-3.5"
            />
            新建
          </Button>
        </PanelHead>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-y-contain p-3">
          {total === 0 ? (
            <div className="flex flex-col items-center gap-2 px-2 py-10 text-center">
              <span className="bg-muted text-muted-foreground flex size-9 items-center justify-center rounded-xl">
                <Icon
                  icon="lucide:calendar-clock"
                  className="size-4.5"
                />
              </span>
              <p className="text-foreground text-sm font-medium">还没有任务</p>
              <p className="text-muted-foreground max-w-[24em] text-xs leading-relaxed">
                任务是可重复触发的自动化工作，与「会话」不是一回事：到点按计划跑一轮指令，
                结果记在执行记录里。
              </p>
              <Button
                type="button"
                size="sm"
                className="mt-1 gap-1 text-xs"
                onClick={openCreate}>
                <Icon
                  icon="lucide:plus"
                  className="size-3.5"
                />
                新建任务
              </Button>
            </div>
          ) : null}

          {isLoading && total === 0 ? (
            <p className="text-muted-foreground px-1 text-xs">加载中…</p>
          ) : null}

          {groups.map(function (group) {
            return (
              <section
                key={group.owner}
                className="flex flex-col gap-1.5">
                <div className="flex min-w-0 items-center gap-1.5 px-1">
                  <Icon
                    icon={findOwnerIcon(group.owner).icon}
                    className={clsx('size-3.5 shrink-0', findOwnerIcon(group.owner).tone)}
                  />
                  <span className="text-muted-foreground shrink-0 text-xs font-medium">
                    {findLabel(DICT_TYPE.AUTOMATION_OWNER, group.owner)}
                  </span>
                  <span className="text-muted-foreground/50 shrink-0 text-[11px] tabular-nums">
                    {group.items.length}
                  </span>
                  <span className="text-muted-foreground/70 truncate text-[11px]">
                    {findOwnerHint(group.owner)}
                  </span>
                </div>
                {/* 网格：窄栏 1 列、拉宽后 2–3 列（auto-fill）；12rem 是实测能把「每周一 10:00
                    + 目标·6 轮」放进一行、又不至于宽到把 4 列挤成豆腐块的宽度 */}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2">
                  {group.items.map(renderCard)}
                </div>
              </section>
            )
          })}

          {cloudStatus === 'error' ? (
            <p className="text-destructive px-1 text-xs leading-relaxed">
              服务端任务读取失败：{cloudError}
            </p>
          ) : null}
          {cloudStatus === 'off' ? (
            <p className="text-muted-foreground px-1 text-xs leading-relaxed">
              未登录：只显示本机与 goose 任务
            </p>
          ) : null}
        </div>
      </div>
    )
  }

  function renderDetail(task: Automation) {
    const isCloud = task.owner === OWNER.CLOUD
    const isRunning = Boolean(running[task.id])
    const badge = findTaskBadge(task, isRunning)
    const phaseLabel = isRunning ? findPhaseLabel(phases[task.id]) : null
    const latestSession = runs.find(function (run) {
      return Boolean(run.sessionId)
    })?.sessionId
    const modeTag = findTaskModeTag(task)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* 抬头：返回 / 名称 + 状态 / 启停与执行（与列表卡片的操作位置一致，肌肉记忆不换） */}
        <div className="border-border/60 flex shrink-0 items-start gap-1.5 border-b py-2 pe-2 ps-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground mt-0.5 size-6 shrink-0"
            aria-label="返回任务列表"
            onClick={backToList}>
            <Icon
              icon="lucide:chevron-left"
              className="size-4"
            />
          </Button>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="text-foreground min-w-0 truncate text-sm font-semibold">{task.name}</h2>
            <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
              <TaskStatusPill
                tone={badge.tone}
                label={phaseLabel ?? badge.label}
              />
              <span className="min-w-0 truncate">
                {[
                  findLabel(DICT_TYPE.AUTOMATION_OWNER, task.owner),
                  describeSchedule(task.schedule),
                  modeTag
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Switch
              checked={task.enabled}
              size="sm"
              aria-label={`${task.enabled ? '停用' : '启用'}任务`}
              onCheckedChange={function (checked) {
                void toggle(task.id, checked)
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground size-6"
              aria-label="立即执行"
              disabled={isRunning || !canRunNow(task)}
              title={
                canRunNow(task)
                  ? '立即跑一次（与定时触发同一条执行路径）'
                  : '服务端任务按排期执行，客户端暂时不能手动触发'
              }
              onClick={function () {
                void runNow(task.id)
              }}>
              <Icon
                icon="lucide:play"
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
                    className="text-muted-foreground hover:text-foreground size-6"
                    aria-label="更多操作"
                  />
                }>
                <Icon
                  icon="lucide:ellipsis"
                  className="size-3.5"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={function () {
                    openEdit(task)
                  }}>
                  编辑
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={function () {
                    askRemove(task)
                  }}>
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-y-contain p-3">
          {/* 指令：这块是「跑什么」，放在最前，读数优先 */}
          <AsideSection
            icon="lucide:sparkles"
            iconClass="text-primary"
            title="指令"
            meta={findTaskModeLabel(task)}>
            {task.prompt.trim() ? (
              <p className="text-foreground/90 text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                {task.prompt}
              </p>
            ) : (
              <p className="text-muted-foreground text-xs leading-relaxed">
                {task.planFilePath
                  ? `按计划文件执行：${task.planFilePath}`
                  : '这条任务没有指令正文'}
              </p>
            )}
          </AsideSection>

          <AsideSection
            icon="lucide:calendar-clock"
            iconClass="text-amber-500"
            title="排期"
            meta={task.timezone}>
            <div className="flex flex-col gap-1.5">
              <MetaRow label="计划">
                <span>{describeSchedule(task.schedule)}</span>
                <span className="text-muted-foreground/80 font-mono text-[11px]">
                  {task.schedule}
                </span>
              </MetaRow>
              <MetaRow label="下次触发">{findNextLabel(task)}</MetaRow>
              <MetaRow label="上次执行">
                {formatTime(task.lastRunAt)}
                {task.lastStatus
                  ? ` · ${findLabel(DICT_TYPE.AUTOMATION_RUN_STATUS, task.lastStatus)}`
                  : ''}
              </MetaRow>
            </div>
          </AsideSection>

          <AsideSection
            icon="lucide:cpu"
            title="执行"
            meta={findOwnerHint(task.owner)}>
            <div className="flex flex-col gap-1.5">
              <MetaRow label="执行方">{findLabel(DICT_TYPE.AUTOMATION_OWNER, task.owner)}</MetaRow>
              <MetaRow label="执行授权">
                {isCloud
                  ? '由服务端控制'
                  : task.approval === 'auto'
                    ? '自动批准（不再询问）'
                    : '只读'}
              </MetaRow>
              <MetaRow label="工作目录">
                {findWorkspaceLabel(task.workspaceId, task.workspacePath)}
              </MetaRow>
              <MetaRow label="模式">{findTaskModeLabel(task)}</MetaRow>
              {findSessionModeLabel(task) ? (
                <MetaRow label="会话">
                  {findSessionModeLabel(task)}
                  {task.sessionMode === 'fixed' ? ' · 写进已选对话' : ''}
                </MetaRow>
              ) : null}
              {task.planFilePath ? (
                <MetaRow label="计划文件">
                  <span className="font-mono text-[11px]">{task.planFilePath}</span>
                </MetaRow>
              ) : null}
              <MetaRow label="知识库">{findBaseLabel(task.knowledgeBaseId)}</MetaRow>
            </div>
            {latestSession ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-1 w-full gap-1.5 text-xs"
                onClick={function () {
                  void openSession(latestSession)
                }}>
                <Icon
                  icon="lucide:messages-square"
                  className="size-3.5"
                />
                打开最近会话
              </Button>
            ) : null}
          </AsideSection>

          {canRunNow(task) ? (
            <AsideSection
              icon="lucide:history"
              title="执行记录"
              meta={`${runs.length} 条`}
              action={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-foreground size-6"
                  aria-label="刷新执行记录"
                  title="刷新执行记录"
                  onClick={function () {
                    void openRuns(task.id)
                  }}>
                  <Icon
                    icon="lucide:refresh-cw"
                    className="size-3.5"
                  />
                </Button>
              }>
              <TaskRuns
                runs={runs}
                running={running}
                onRerun={function (id) {
                  void runNow(id)
                }}
                onOpenSession={function (sessionId) {
                  void openSession(sessionId)
                }}
              />
            </AsideSection>
          ) : (
            <AsideSection
              icon="lucide:cloud"
              iconClass="text-sky-500"
              title="执行记录"
              meta="在服务端">
              <p className="text-muted-foreground text-xs leading-relaxed">
                服务端任务的执行与记录都在服务端；这里只能启停、删除，不能手动触发。
              </p>
            </AsideSection>
          )}
        </div>
      </div>
    )
  }

  function renderAllRuns() {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-border/60 flex shrink-0 items-start gap-1.5 border-b py-2 pe-2 ps-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground mt-0.5 size-6 shrink-0"
            aria-label="返回任务列表"
            onClick={backToList}>
            <Icon
              icon="lucide:chevron-left"
              className="size-4"
            />
          </Button>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="text-foreground min-w-0 truncate text-sm font-semibold">全部执行记录</h2>
            <p className="text-muted-foreground truncate text-xs">
              跨任务的最近 50 条；服务端任务的记录在服务端
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground size-6"
            aria-label="刷新执行记录"
            title="刷新执行记录"
            onClick={function () {
              void openAllRuns()
            }}>
            <Icon
              icon="lucide:refresh-cw"
              className="size-3.5"
            />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-3">
          <TaskRuns
            runs={allRuns}
            tasks={all}
            running={running}
            onRerun={function (id) {
              void runNow(id)
            }}
            onOpenSession={function (sessionId) {
              void openSession(sessionId)
            }}
          />
        </div>
      </div>
    )
  }

  if (view.kind === 'form') {
    return (
      <TaskForm
        key={view.draft.id ?? 'new'}
        draft={view.draft}
        onCancel={function () {
          backFromForm(view.draft)
        }}
        onSaved={function () {
          backFromForm(view.draft)
        }}
      />
    )
  }

  const body =
    view.kind === 'all-runs'
      ? renderAllRuns()
      : // 详情里的任务在刷新后消失（被删 / 换租户）：直接回列表，不停在空详情
        picked
        ? renderDetail(picked)
        : renderList()

  return (
    <>
      {body}
      <AlertDialog
        open={pendingRemove !== null}
        onOpenChange={function (open) {
          if (!open) updatePendingRemove(null)
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这个任务？</AlertDialogTitle>
            <AlertDialogDescription>
              「{pendingRemove?.name}」和它的执行记录会一起删掉，不能撤销。
              {pendingRemove?.owner === OWNER.CLOUD ? '服务端那条排期也会同步删除。' : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={function () {
                if (pendingRemove) handleRemove(pendingRemove)
              }}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export { AsideTasks }
