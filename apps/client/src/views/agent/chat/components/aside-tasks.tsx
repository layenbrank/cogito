/**
 * 右栏「任务」面板：卡片式管理 + 创建，不再跳独立页面。
 *
 * 三视图共用一块面板（列表 / 详情 / 表单），返回不离开当前会话：
 * - 列表：按执行方分组的卡片（名称 / 状态 / 计划 / 下次触发），卡上有启停、立即执行、更多；
 * - 详情：点卡片进入，展示定义与执行记录（`TaskRuns`），可编辑 / 删除；
 * - 表单：新建与编辑（`TaskForm`，单列窄栏布局）。
 *
 * 数据仍走 `stores/automation`（本机 / goose / 服务端三源），纯逻辑在
 * `views/agent/tasks/model.ts`；这里只做组合与呈现。
 */
import { Icon } from '@iconify/react/offline'
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
import { Switch } from '@cogito/design/components/switch'
import { clsx } from 'clsx'
import { useEffect, useMemo, useState } from 'react'

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
import { subscribeAsideTasks } from '@/views/agent/chat/components/open-aside-tasks'
import { formatTime } from '@/views/knowledge/lib/format.ts'
import {
  OWNER,
  buildTaskGroups,
  canRunNow,
  createDraft,
  findOwnerHint,
  findPhaseLabel,
  findTaskBadge,
  findTaskModeLabel,
  findTaskModeTag,
  toDraft,
  type TaskBadgeTone,
  type TaskDraft
} from '@/views/agent/tasks/model'
import { TaskForm } from '@/views/agent/tasks/task-form'
import { TaskRuns } from '@/views/agent/tasks/task-runs'
import styles from '@/views/agent/tasks/tasks.module.scss'

type PanelView =
  | { kind: 'list' }
  | { kind: 'detail'; id: string }
  | { kind: 'all-runs' }
  | { kind: 'form'; draft: TaskDraft }

const BADGE_CLASS: Record<TaskBadgeTone, string> = {
  running: styles.badgeRunning,
  ok: styles.badgeOk,
  fail: styles.badgeFail,
  off: styles.badgeOff,
  idle: styles.badgeIdle
}

/** 下次触发：没有 nextRunAt 时按 owner 说明「谁在排期」，不编一个假时间 */
function findNextLabel(item: Automation): string {
  if (!item.enabled) return '已停用'
  if (!item.nextRunAt) {
    if (item.owner === OWNER.CLOUD) return '排期在服务端'
    if (item.owner === OWNER.GOOSE) return '排期在 goose'
    return '未排期'
  }
  return `下次 ${formatTime(item.nextRunAt)}`
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
  const picked = view.kind === 'detail' ? all.find(task => task.id === view.id) : undefined

  useEffect(
    function () {
      void refresh()
      void useAgentStore.getState().toReadWorkspaces()
      void useAgentStore.getState().toReadWorkspaceFolders()
      void useKnowledgeBaseStore.getState().refresh()
      void toReadProviders()
      // 卡片上的执行方 / 状态 / 触发方式都是字典 value，先把三类拉进缓存
      void useDictStore.getState().bootstrap([
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

  function findWorkspaceLabel(workspaceID: string | null | undefined): string {
    if (!workspaceID) return '家目录'
    const workspace = workspaces.find(function (item) {
      return item.id === workspaceID
    })
    const path = folders.find(function (item) {
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
    return (
      <div
        key={item.id}
        className={clsx(styles.card, isActive && styles.cardActive, isRunning && styles.cardRunning)}>
        <button
          type="button"
          className={styles.cardMain}
          aria-current={isActive ? 'true' : undefined}
          onClick={function () {
            openTask(item.id)
          }}>
          <span className={styles.cardTitleRow}>
            <span className={styles.cardTitle}>{item.name}</span>
            <span className={clsx(styles.badge, BADGE_CLASS[badge.tone])}>
              {phaseLabel ?? badge.label}
            </span>
          </span>
          <span className={styles.cardMeta}>
            {describeSchedule(item.schedule)}
            {/* 停用的任务徽标已经写了「已停用」，元信息不用再说一遍 */}
            {item.enabled ? ` · ${findNextLabel(item)}` : ''}
            {modeTag ? ` · ${modeTag}` : ''}
          </span>
          {item.lastError ? (
            <span className={styles.cardError}>{item.lastError}</span>
          ) : null}
        </button>

        <div className={styles.cardActions}>
          <Switch
            checked={item.enabled}
            size="sm"
            aria-label={`${item.enabled ? '停用' : '启用'}任务 ${item.name}`}
            onCheckedChange={function (checked) {
              void toggle(item.id, checked)
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-8"
            aria-label="立即执行"
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
              icon="lucide:play"
              className="size-4"
            />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-8"
                  aria-label="更多操作"
                />
              }>
              <Icon
                icon="lucide:ellipsis"
                className="size-4"
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
      </div>
    )
  }

  function renderList() {
    return (
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <p className={styles.panelTitle}>任务</p>
          {total > 0 ? <span className={styles.panelCount}>{total}</span> : null}
          <span className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="刷新任务列表"
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
                  size="icon-xs"
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
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={openCreate}>
            <Icon
              icon="lucide:plus"
              className="size-3.5"
            />
            新建
          </Button>
        </div>

        <div className={styles.panelBody}>
          {total === 0 ? (
            <div className={styles.panelEmpty}>
              <p className={styles.panelEmptyTitle}>还没有任务</p>
              <p className={styles.panelEmptyHint}>
                任务是可重复触发的自动化工作，与「会话」不是一回事：到点按计划跑一轮指令，
                结果记在执行记录里。
              </p>
              <Button
                type="button"
                size="sm"
                className="mt-1 gap-1"
                onClick={openCreate}>
                <Icon
                  icon="lucide:plus"
                  className="size-3.5"
                />
                新建任务
              </Button>
            </div>
          ) : null}

          {isLoading && total === 0 ? <p className={styles.panelHint}>加载中…</p> : null}

          {groups.map(function (group) {
            return (
              <div
                key={group.owner}
                className={styles.group}>
                <p className={styles.groupLabel}>
                  {findLabel(DICT_TYPE.AUTOMATION_OWNER, group.owner)}
                  <span className={styles.groupHint}>{findOwnerHint(group.owner)}</span>
                </p>
                <div className={styles.cards}>{group.items.map(renderCard)}</div>
              </div>
            )
          })}

          {cloudStatus === 'error' ? (
            <p className={clsx(styles.panelHint, styles.rowError)}>
              服务端任务读取失败：{cloudError}
            </p>
          ) : null}
          {cloudStatus === 'off' ? (
            <p className={styles.panelHint}>未登录：只显示本机与 goose 任务</p>
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
    return (
      <div className={styles.detail}>
        <div className={styles.detailHead}>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="返回任务列表"
            onClick={backToList}>
            <Icon
              icon="lucide:chevron-left"
              className="size-4"
            />
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className={styles.detailTitle}>{task.name}</h2>
            <p className={styles.detailSub}>
              {findLabel(DICT_TYPE.AUTOMATION_OWNER, task.owner)}
              <span className={clsx(styles.badge, BADGE_CLASS[badge.tone], 'ms-1.5')}>
                {phaseLabel ?? badge.label}
              </span>
            </p>
          </div>
          <div className={styles.detailActions}>
            <Switch
              checked={task.enabled}
              size="sm"
              aria-label="启用任务"
              onCheckedChange={function (checked) {
                void toggle(task.id, checked)
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
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
                    size="icon-xs"
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

        <div className={styles.detailBody}>
          <p className={styles.prompt}>{task.prompt}</p>

          <section>
            <div className={styles.sectionHead}>
              <p className={styles.sectionTitle}>排期</p>
              <span className={styles.sectionMeta}>{task.timezone}</span>
            </div>
            <div className={styles.meta}>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>计划</span>
                <span className={styles.metaValue}>
                  {describeSchedule(task.schedule)}
                  <span className={styles.scheduleCode}>{task.schedule}</span>
                </span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>下次触发</span>
                <span className={styles.metaValue}>{findNextLabel(task)}</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>上次执行</span>
                <span className={styles.metaValue}>
                  {formatTime(task.lastRunAt)}
                  {task.lastStatus
                    ? ` · ${findLabel(DICT_TYPE.AUTOMATION_RUN_STATUS, task.lastStatus)}`
                    : ''}
                </span>
              </div>
            </div>
          </section>

          <section>
            <div className={styles.sectionHead}>
              <p className={styles.sectionTitle}>执行</p>
              <span className={styles.sectionMeta}>{findOwnerHint(task.owner)}</span>
            </div>
            <div className={styles.meta}>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>执行方</span>
                <span className={styles.metaValue}>
                  {findLabel(DICT_TYPE.AUTOMATION_OWNER, task.owner)}
                </span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>执行授权</span>
                <span className={styles.metaValue}>
                  {isCloud
                    ? '由服务端控制'
                    : task.approval === 'auto'
                      ? '自动批准（不再询问）'
                      : '只读'}
                </span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>工作目录</span>
                <span className={styles.metaValue}>{findWorkspaceLabel(task.workspaceId)}</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>模式</span>
                <span className={styles.metaValue}>{findTaskModeLabel(task)}</span>
              </div>
              {task.planFilePath ? (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>计划文件</span>
                  <span className={styles.metaValue}>{task.planFilePath}</span>
                </div>
              ) : null}
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>关联知识库</span>
                <span className={styles.metaValue}>{findBaseLabel(task.knowledgeBaseId)}</span>
              </div>
            </div>
            {latestSession ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 h-8 w-full text-[12px]"
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
          </section>

          {canRunNow(task) ? (
            <section>
              <div className={styles.sectionHead}>
                <p className={styles.sectionTitle}>执行记录</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[11px]"
                  onClick={function () {
                    void openRuns(task.id)
                  }}>
                  <Icon
                    icon="lucide:refresh-cw"
                    className="size-3"
                  />
                  刷新
                </Button>
              </div>
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
            </section>
          ) : (
            <p className={styles.emptyHint}>
              服务端任务的执行与记录都在服务端；这里只能启停、删除，不能手动触发。
            </p>
          )}
        </div>
      </div>
    )
  }

  function renderAllRuns() {
    return (
      <div className={styles.detail}>
        <div className={styles.detailHead}>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="返回任务列表"
            onClick={backToList}>
            <Icon
              icon="lucide:chevron-left"
              className="size-4"
            />
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className={styles.detailTitle}>全部执行记录</h2>
            <p className={styles.detailSub}>跨任务的最近 50 条；服务端任务的记录在服务端</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="刷新执行记录"
            onClick={function () {
              void openAllRuns()
            }}>
            <Icon
              icon="lucide:refresh-cw"
              className="size-3.5"
            />
          </Button>
        </div>
        <div className={styles.detailBody}>
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
        (picked ? renderDetail(picked) : renderList())

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
