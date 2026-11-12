/**
 * 新建 / 编辑任务表单。
 *
 * 执行配置都在这里落：工作区 + 工作区下的目录、执行授权（能否不问就动手）。授权只有两档 ——
 * 「询问审批」不会出现在任务里，因为没人能应答。
 *
 * 时间定义走可视化面板（`schedule-field.tsx`）：普通用户按「每天 / 每周 / 每月 / 每小时 / 按分钟」
 * 选就行，不必懂 crontab；表达式只在「自定义」里出现。
 *
 * 表单按「任务是什么 / 什么时候跑 / 怎么执行」分三段：292px 的窄栏里，一道段标题比
 * 十几个同等重量的字段更容易扫读；控件一律走设计系统默认尺寸（h-9 / 14px），
 * 和仓库里其它表单一致，也不再出现「输入框比下拉高一档」的错位。
 *
 * 仍不在本地算「下次触发」：仓库没有 cron 解析依赖，两份实现必然漂移，
 * 准确时间以保存后 Rust 回填的 `nextRunAt` 为准。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Switch } from '@cogito/design/components/switch'
import { Textarea } from '@cogito/design/components/textarea'
import { clsx } from 'clsx'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { GOAL_BUDGET_OPTIONS } from '@/features/agent/goal-run'
import { THINKING_OPTIONS } from '@/features/agent/model/model-prefs'
import type { ThinkingLevel } from '@/features/persist'
import { listPickableSessions, type PickableSession } from '@/features/automation/session-picker'
import { parseModels } from '@/features/agent/model/providers'
import { listPlanFiles, type PlanFileEntry } from '@/features/agent/plan-file'
import { DICT_TYPE } from '@/shared/ipc/specs/dict'
import { useAgentStore } from '@/stores/agent.ts'
import { useAutomationStore } from '@/stores/automation'
import { useDictStore } from '@/stores/dict'
import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { useProviderStore } from '@/stores/provider'
import {
  MODE_OPTIONS,
  OWNER,
  SESSION_MODE_OPTIONS,
  findDraftProblem,
  findOwnerHint,
  parseSessionMode,
  toSaveInput,
  type TaskDraft
} from './model'
import { ScheduleField } from './schedule-field'
import styles from './tasks.module.scss'

interface TaskFormProps {
  draft: TaskDraft
  onCancel: () => void
  onSaved: () => void
}

/** 常用时区：够覆盖绝大部分排期诉求，避免让人手打 IANA 名字 */
const TIMEZONES = [
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles'
]

const OWNER_OPTIONS = [OWNER.CLIENT, OWNER.GOOSE, OWNER.CLOUD]

const APPROVAL_OPTIONS = [
  { value: 'readonly', label: '只读' },
  { value: 'auto', label: '自动批准' }
] as const

/** 档位说明与选择器同一份文案（`THINKING_OPTIONS`），避免两处各写一遍 */
function findThinkingHint(level: ThinkingLevel): string {
  const found = THINKING_OPTIONS.find(function (option) {
    return option.value === level
  })
  return found?.hint ?? '日常默认，速度与质量兼顾'
}

function TaskForm(props: TaskFormProps) {
  const [draft, updateDraft] = useState<TaskDraft>(props.draft)
  const [isSaving, updateSaving] = useState(false)
  /** 校验提示等用户动过一版再出现：空白表单上手就甩一行红字太凶，按钮置灰已经说明问题 */
  const [isDirty, updateDirty] = useState(false)
  const [planFiles, updatePlanFiles] = useState<PlanFileEntry[]>([])
  const [isListingPlans, updateListingPlans] = useState(false)
  /** 「固定对话」的可选会话；本机任务才有意义 */
  const [sessions, updateSessions] = useState<PickableSession[]>([])

  const workspaces = useAgentStore(function (state) {
    return state.workspaces
  })
  const folders = useAgentStore(function (state) {
    return state.workspaceFolders
  })
  const bases = useKnowledgeBaseStore(function (state) {
    return state.bases
  })
  const save = useAutomationStore(function (state) {
    return state.save
  })
  const findLabel = useDictStore(function (state) {
    return state.findLabel
  })
  const providers = useProviderStore(function (state) {
    return state.providers
  })

  const isCloud = draft.owner === OWNER.CLOUD
  /** goose 任务由 goose 自己跑：工作目录与授权在 goose 侧，客户端配了也不会生效（原先是静默失效） */
  const isGoose = draft.owner === OWNER.GOOSE
  /** 这两档的执行配置都不归客户端管：锁住 + 说清由谁决定 */
  const isExecConfigLocked = isCloud || isGoose
  const isClient = draft.owner === OWNER.CLIENT
  const hasBoundPlan = Boolean(draft.planFilePath?.trim())
  const problem = findDraftProblem(draft)
  // 轮次只在 goal / 计划后执行时用；绑定计划 + 执行模式不显示
  const showBudget = draft.planThenGoal || draft.mode === 'goal'
  const modeOptions = hasBoundPlan
    ? MODE_OPTIONS.filter(function (option) {
        return option.value !== 'plan'
      })
    : MODE_OPTIONS

  function findWorkspaceFolders(workspaceID: string) {
    return folders
      .filter(function (item) {
        return item.workspaceID === workspaceID
      })
      .sort(function (left, right) {
        return left.sort - right.sort
      })
  }

  function findWorkspacePath(workspaceID: string): string {
    const owned = folders.filter(function (item) {
      return item.workspaceID === workspaceID
    })
    return owned[0]?.path ?? ''
  }

  // 候选对话每次打开表单 / 换工作区时现读一次：会话可能刚被删，拿旧列表会绑到空气上。
  // 列表按**任务的工作区**过滤：绑上别的工作区的对话，执行时会按那条对话自己的目录跑，
  // 用户以为自己选了项目 A、实际动的是项目 B。
  useEffect(
    function () {
      if (isExecConfigLocked) {
        updateSessions([])
        return
      }
      let cancelled = false
      void listPickableSessions(draft.workspaceId)
        .then(function (rows) {
          if (!cancelled) updateSessions(rows)
        })
        .catch(function (error) {
          console.warn('[tasks/form] 读取会话列表失败:', error)
        })
      return function () {
        cancelled = true
      }
    },
    [isExecConfigLocked, draft.workspaceId]
  )

  useEffect(
    function () {
      if (!isClient || !draft.workspaceId) {
        updatePlanFiles([])
        return
      }
      const rootPath = draft.workspacePath?.trim() || findWorkspacePath(draft.workspaceId)
      if (!rootPath) {
        updatePlanFiles([])
        return
      }
      let cancelled = false
      updateListingPlans(true)
      void listPlanFiles(rootPath)
        .then(function (entries) {
          if (!cancelled) updatePlanFiles(entries)
        })
        .catch(function (error: unknown) {
          console.warn('[agent/tasks] 列出计划文件失败:', error)
          if (!cancelled) updatePlanFiles([])
        })
        .finally(function () {
          if (!cancelled) updateListingPlans(false)
        })
      return function () {
        cancelled = true
      }
    },
    // findWorkspacePath 依赖 folders；workspace 切换时重拉
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isClient, draft.workspaceId, draft.workspacePath, folders]
  )

  const modelItems = [
    { value: 'follow', label: '跟随当前激活模型' },
    ...providers.flatMap(function (provider) {
      return parseModels(provider.models).map(function (model) {
        return {
          value: `${provider.id}::${model}`,
          label: `${provider.name || provider.kind} · ${model}`
        }
      })
    })
  ]
  const modelValue =
    draft.providerId && draft.modelId ? `${draft.providerId}::${draft.modelId}` : 'follow'

  /**
   * 下拉的显示文案必须走 `items`：Base UI 的 `Select.Value` 默认渲染裸 value，
   * 不传 items 时触发器会露出 `client` / UUID 这类内部值（用户看到的就是这个 bug）。
   */
  const timezoneOptions = TIMEZONES.includes(draft.timezone)
    ? TIMEZONES
    : [...TIMEZONES, draft.timezone]
  const timezoneItems = timezoneOptions.map(function (zone) {
    return { value: zone, label: zone }
  })
  const ownerItems = OWNER_OPTIONS.map(function (owner) {
    return { value: owner, label: findLabel(DICT_TYPE.AUTOMATION_OWNER, owner) }
  })
  const workspaceItems = [
    { value: 'none', label: '不指定（家目录）' },
    ...workspaces.map(function (workspace) {
      const count = findWorkspaceFolders(workspace.id).length
      return {
        value: workspace.id,
        label: count > 1 ? `${workspace.title} · ${count} 个目录` : workspace.title
      }
    })
  ]
  const directoryItems = [
    { value: 'auto', label: '跟随工作区默认目录' },
    ...(draft.workspaceId
      ? findWorkspaceFolders(draft.workspaceId).map(function (folder) {
          return { value: folder.path, label: folder.path }
        })
      : [])
  ]
  const sessionModeItems = SESSION_MODE_OPTIONS.map(function (option) {
    return { value: option.value, label: option.label }
  })
  const sessionItems = [
    { value: 'none', label: '选择一个对话…' },
    ...sessions.map(function (session) {
      return {
        value: session.id,
        label: session.workspaceTitle
          ? `${session.title} · ${session.workspaceTitle}`
          : session.title
      }
    })
  ]
  // 绑定的对话被删了：补一条失效项，别让触发器露出裸 UUID
  if (
    draft.sessionId &&
    !sessions.some(function (item) {
      return item.id === draft.sessionId
    })
  ) {
    sessionItems.push({
      value: draft.sessionId,
      label: draft.workspaceId ? '原对话不在当前工作区' : '原对话已不存在'
    })
  }
  const knowledgeItems = [
    { value: 'none', label: '不关联知识库' },
    ...bases.map(function (base) {
      return { value: base.id, label: base.name }
    })
  ]

  // 老任务引用的目录 / 知识库可能已被删：补一条失效项，别让触发器露出裸 UUID
  if (
    draft.workspaceId &&
    !workspaces.some(function (item) {
      return item.id === draft.workspaceId
    })
  ) {
    workspaceItems.push({ value: draft.workspaceId, label: '原工作目录已不存在' })
  }
  if (
    draft.knowledgeBaseId &&
    !bases.some(function (base) {
      return base.id === draft.knowledgeBaseId
    })
  ) {
    knowledgeItems.push({ value: draft.knowledgeBaseId, label: '原知识库已不存在' })
  }

  function patch(next: Partial<TaskDraft>) {
    updateDirty(true)
    updateDraft(function (prev) {
      return { ...prev, ...next }
    })
  }

  const planItems = [
    { value: 'none', label: isListingPlans ? '读取计划中…' : '不绑定（用指令现场跑）' },
    ...planFiles.map(function (entry) {
      return { value: entry.relative, label: entry.name }
    })
  ]
  if (
    draft.planFilePath &&
    !planFiles.some(function (entry) {
      return entry.relative === draft.planFilePath
    })
  ) {
    planItems.push({ value: draft.planFilePath, label: `${draft.planFilePath}（文件可能已删除）` })
  }

  async function handleSave() {
    if (problem) return
    updateSaving(true)
    try {
      const ok = await save(toSaveInput(draft))
      if (ok) props.onSaved()
    } finally {
      updateSaving(false)
    }
  }

  return (
    <div className={styles.form}>
      <div className={styles.formHead}>
        <h2 className={styles.formTitle}>{draft.id ? '编辑任务' : '新建任务'}</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[12px]"
          onClick={props.onCancel}>
          取消
        </Button>
      </div>

      <div className={styles.formBody}>
        <section className={styles.formSection}>
          <div className={styles.formSectionHead}>
            <p className={styles.formSectionTitle}>任务</p>
            <span className={styles.formSectionHint}>到点交给智能体做什么</span>
          </div>

          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>名称</span>
            <Input
              value={draft.name}
              placeholder="例如：每天整理知识库变更"
              onChange={function (event) {
                patch({ name: event.target.value })
              }}
            />
          </div>

          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>指令</span>
            <Textarea
              value={draft.prompt}
              placeholder={
                hasBoundPlan
                  ? '可选：附加说明（执行依据是已绑定的计划正文）'
                  : '到期时交给智能体的一句话，例如：把当前目录的文件数写进 report.txt'
              }
              className="min-h-20 text-[13px]"
              onChange={function (event) {
                patch({ prompt: event.target.value })
              }}
            />
          </div>
        </section>

        <section className={styles.formSection}>
          <div className={styles.formSectionHead}>
            <p className={styles.formSectionTitle}>时间</p>
            <span className={styles.formSectionHint}>按下面的时区排期</span>
          </div>

          <ScheduleField
            value={draft.schedule}
            onChange={function (schedule) {
              patch({ schedule })
            }}
          />

          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>时区</span>
            <Select
              items={timezoneItems}
              value={draft.timezone}
              onValueChange={function (value) {
                if (typeof value === 'string') patch({ timezone: value })
              }}>
              <SelectTrigger>
                <SelectValue placeholder="Asia/Shanghai" />
              </SelectTrigger>
              <SelectContent>
                {timezoneOptions.map(function (zone) {
                  return (
                    <SelectItem
                      key={zone}
                      value={zone}>
                      {zone}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
        </section>

        <section className={styles.formSection}>
          <div className={styles.formSectionHead}>
            <p className={styles.formSectionTitle}>执行</p>
            <span className={styles.formSectionHint}>{findOwnerHint(draft.owner)}</span>
          </div>

          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>执行方</span>
            <Select
              items={ownerItems}
              value={draft.owner}
              disabled={Boolean(draft.id) && isCloud}
              onValueChange={function (value) {
                if (typeof value !== 'string') return
                // 换成 goose / 云端：执行配置不归客户端管，留着只会让列表显示错误语义
                if (value !== OWNER.CLIENT) {
                  patch({
                    owner: value,
                    workspaceId: null,
                    workspacePath: null,
                    sessionMode: 'new',
                    sessionId: null,
                    approval: 'readonly',
                    providerId: null,
                    modelId: null,
                    mode: 'agent',
                    planThenGoal: false,
                    planFilePath: null,
                    goalBudget: 6
                  })
                  return
                }
                patch({ owner: value })
              }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ownerItems.map(function (item) {
                  return (
                    <SelectItem
                      key={item.value}
                      value={item.value}>
                      {item.label}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>工作区</span>
            <Select
              items={workspaceItems}
              value={draft.workspaceId ?? 'none'}
              disabled={isExecConfigLocked}
              onValueChange={function (value) {
                if (typeof value !== 'string') return
                // 换工作区：目录、已绑计划、已绑对话都跟着作废 —— 它们都属于旧工作区
                patch({
                  workspaceId: value === 'none' ? null : value,
                  workspacePath: null,
                  planFilePath: null,
                  sessionId: null
                })
              }}>
              <SelectTrigger>
                <SelectValue placeholder="家目录" />
              </SelectTrigger>
              <SelectContent>
                {workspaceItems.map(function (item) {
                  return (
                    <SelectItem
                      key={item.value}
                      value={item.value}>
                      {item.label}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            <p className={styles.fieldHint}>
              {isGoose
                ? '由 goose 决定：客户端配的目录不会传过去。'
                : '任务的读写与命令都落在这个工作区里。'}
            </p>
          </div>

          {/* 目录：工作区下具体哪个文件夹。一个工作区可以有多个目录，不选就跟随默认 */}
          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>目录</span>
            <Select
              items={directoryItems}
              value={draft.workspacePath ?? 'auto'}
              disabled={isExecConfigLocked || !draft.workspaceId}
              onValueChange={function (value) {
                if (typeof value !== 'string') return
                patch({
                  workspacePath: value === 'auto' ? null : value,
                  planFilePath: null
                })
              }}>
              <SelectTrigger>
                <SelectValue placeholder="跟随工作区默认目录" />
              </SelectTrigger>
              <SelectContent>
                {directoryItems.map(function (item) {
                  return (
                    <SelectItem
                      key={item.value}
                      value={item.value}>
                      {item.label}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            {/* 下拉里的绝对路径会被 truncate，这里把选中的完整路径摊开（可换行） */}
            <p className={styles.fieldHint}>
              {!draft.workspaceId
                ? '先选工作区，才能指定工作区下的目录'
                : draft.workspacePath
                  ? `执行目录：${draft.workspacePath}`
                  : '不选则用工作区里第一个可用目录'}
            </p>
          </div>

          {/* 会话绑定：跑出来的内容写进哪个对话。只对本机执行有效（goose / 云端在客户端外跑） */}
          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>会话</span>
            <Select
              items={sessionModeItems}
              value={draft.sessionMode}
              disabled={isExecConfigLocked}
              onValueChange={function (value) {
                if (typeof value !== 'string') return
                const next = parseSessionMode(value)
                patch({
                  sessionMode: next,
                  // 只有「固定对话」保留具体会话；其它档位清掉，避免切回来还挂着旧 id
                  sessionId: next === 'fixed' ? draft.sessionId : null
                })
              }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sessionModeItems.map(function (item) {
                  return (
                    <SelectItem
                      key={item.value}
                      value={item.value}>
                      {item.label}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            <p className={styles.fieldHint}>
              {isExecConfigLocked
                ? '由执行端决定：客户端选的会话不会传过去。'
                : draft.sessionMode === 'fixed'
                  ? '执行内容写进你选的对话，上下文连续。'
                  : draft.sessionMode === 'ask'
                    ? '到点先弹窗让你选对话；没人应答或关掉弹窗都按新建处理。'
                    : '每次执行新建一场会话，跑完留在侧栏对应工作区分组里。'}
            </p>
          </div>

          {isClient && draft.sessionMode === 'fixed' ? (
            <div className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>对话</span>
              <Select
                items={sessionItems}
                value={draft.sessionId ?? 'none'}
                // 对话按工作区过滤：没选工作区就先别让人绑，避免绑到别的项目里
                disabled={!draft.workspaceId}
                onValueChange={function (value) {
                  if (typeof value !== 'string') return
                  patch({ sessionId: value === 'none' ? null : value })
                }}>
                <SelectTrigger>
                  <SelectValue placeholder="选择一个对话…" />
                </SelectTrigger>
                <SelectContent>
                  {sessionItems.map(function (item) {
                    return (
                      <SelectItem
                        key={item.value}
                        value={item.value}>
                        {item.label}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              <p className={styles.fieldHint}>
                {!draft.workspaceId
                  ? '先选工作区，才能绑定对话（列表按工作区过滤）'
                  : draft.sessionId
                    ? '这个对话与任务在同一工作区；执行按它自己的工作目录读写。'
                    : '只列当前工作区里的对话；跨工作区的对话会按它自己的目录执行，已不允许。'}
              </p>
            </div>
          ) : null}

          {isClient ? (
            <div className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>绑定计划</span>
              <Select
                items={planItems}
                value={draft.planFilePath ?? 'none'}
                disabled={!draft.workspaceId}
                onValueChange={function (value) {
                  if (typeof value !== 'string') return
                  if (value === 'none') {
                    patch({ planFilePath: null })
                    return
                  }
                  // 绑定现成计划：关掉流水线；若还停在「计划」模式则改成目标
                  patch({
                    planFilePath: value,
                    planThenGoal: false,
                    mode: draft.mode === 'plan' ? 'goal' : draft.mode
                  })
                }}>
                <SelectTrigger>
                  <SelectValue placeholder="不绑定" />
                </SelectTrigger>
                <SelectContent>
                  {planItems.map(function (item) {
                    return (
                      <SelectItem
                        key={item.value}
                        value={item.value}>
                        {item.label}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              <p className={styles.fieldHint}>
                {!draft.workspaceId
                  ? '先指定工作目录，才能选择 .cogito/plans 里已保存的计划'
                  : '提前在会话里用计划模式保存；到期时按该计划执行，不必再现场生成'}
              </p>
            </div>
          ) : null}

          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>执行授权</span>
            <div
              className={styles.segmented}
              role="group"
              aria-label="执行授权">
              {APPROVAL_OPTIONS.map(function (option) {
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={draft.approval === option.value}
                    className={styles.segment}
                    disabled={isExecConfigLocked}
                    onClick={function () {
                      patch({ approval: option.value })
                    }}>
                    {option.label}
                  </button>
                )
              })}
            </div>
            <p
              className={clsx(
                styles.fieldHint,
                draft.approval === 'auto' && !draft.workspaceId && styles.fieldWarn
              )}>
              {isGoose
                ? '执行在 goose 侧：目录与授权由 goose 决定，客户端这两项不生效'
                : isCloud
                  ? '服务端任务的执行授权在服务端，客户端不能改'
                  : draft.approval === 'auto'
                    ? '触发后直接执行写文件 / 跑命令，不再询问；必须指定工作目录'
                    : '只允许检索与阅读，写操作会被拒绝并计入记录'}
            </p>
          </div>

          {isClient ? (
            <>
              <div className={styles.fieldGroup}>
                <span className={styles.fieldLabel}>模型</span>
                <Select
                  items={modelItems}
                  value={modelValue}
                  onValueChange={function (value) {
                    if (typeof value !== 'string') return
                    if (value === 'follow') {
                      patch({ providerId: null, modelId: null })
                      return
                    }
                    const sep = value.indexOf('::')
                    if (sep < 0) return
                    patch({
                      providerId: value.slice(0, sep),
                      modelId: value.slice(sep + 2)
                    })
                  }}>
                  <SelectTrigger>
                    <SelectValue placeholder="跟随当前" />
                  </SelectTrigger>
                  <SelectContent>
                    {modelItems.map(function (item) {
                      return (
                        <SelectItem
                          key={item.value}
                          value={item.value}>
                          {item.label}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
                <p className={styles.fieldHint}>空 = 用设置里当前激活的供应商与模型</p>
              </div>

              <div className={styles.fieldGroup}>
                <span className={styles.fieldLabel}>模式</span>
                <div
                  className={styles.segmented}
                  role="group"
                  aria-label="执行模式">
                  {modeOptions.map(function (option) {
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={!draft.planThenGoal && draft.mode === option.value}
                        className={styles.segment}
                        disabled={draft.planThenGoal}
                        onClick={function () {
                          patch({ mode: option.value })
                        }}>
                        {option.label}
                      </button>
                    )
                  })}
                </div>
                <p className={styles.fieldHint}>
                  {hasBoundPlan
                    ? '已绑定计划：按目标或执行模式落地计划正文'
                    : draft.planThenGoal
                      ? '已开启「计划后执行」：将先计划再按目标轮次推进'
                      : draft.mode === 'plan'
                        ? '只产出可审阅计划，不自动改代码'
                        : draft.mode === 'goal'
                          ? '按目标自动续跑，直到达成或轮次用尽'
                          : '单轮执行：直接改代码 / 跑命令'}
                </p>
              </div>

              {!hasBoundPlan ? (
                <div className={styles.fieldGroup}>
                  <span className={styles.fieldLabel}>计划后执行</span>
                  <div className="flex h-9 items-center gap-2">
                    <Switch
                      checked={draft.planThenGoal}
                      aria-label="计划后执行"
                      onCheckedChange={function (checked) {
                        patch({ planThenGoal: checked })
                      }}
                    />
                    <span className={styles.fieldHint}>
                      先用计划模式出方案，再以目标模式按轮次执行
                    </span>
                  </div>
                </div>
              ) : null}

              {showBudget ? (
                <div className={styles.fieldGroup}>
                  <span className={styles.fieldLabel}>目标轮次</span>
                  <div
                    className={styles.segmented}
                    role="group"
                    aria-label="目标轮次">
                    {GOAL_BUDGET_OPTIONS.map(function (budget) {
                      return (
                        <button
                          key={budget}
                          type="button"
                          aria-pressed={draft.goalBudget === budget}
                          className={styles.segment}
                          onClick={function () {
                            patch({ goalBudget: budget })
                          }}>
                          {budget} 轮
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {/* 思考强度：只作用于本任务起的会话；不动用户对该模型的日常偏好 */}
              <div className={styles.fieldGroup}>
                <span className={styles.fieldLabel}>思考强度</span>
                <div
                  className={styles.segmented}
                  role="group"
                  aria-label="思考强度">
                  {THINKING_OPTIONS.map(function (option) {
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={draft.thinking === option.value}
                        className={styles.segment}
                        onClick={function () {
                          patch({ thinking: option.value })
                        }}>
                        {option.label}
                      </button>
                    )
                  })}
                </div>
                <p className={styles.fieldHint}>
                  {findThinkingHint(draft.thinking)}；只影响这次执行，不改变你对该模型的默认设置
                </p>
              </div>
            </>
          ) : null}

          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>关联知识库</span>
            <Select
              items={knowledgeItems}
              value={draft.knowledgeBaseId ?? 'none'}
              disabled={isCloud}
              onValueChange={function (value) {
                if (typeof value !== 'string') return
                patch({ knowledgeBaseId: value === 'none' ? null : value })
              }}>
              <SelectTrigger>
                <SelectValue placeholder="不关联知识库" />
              </SelectTrigger>
              <SelectContent>
                {knowledgeItems.map(function (item) {
                  return (
                    <SelectItem
                      key={item.value}
                      value={item.value}>
                      {item.label}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>启用</span>
            <div className="flex h-9 items-center gap-2">
              <Switch
                checked={draft.enabled}
                aria-label="启用任务"
                onCheckedChange={function (checked) {
                  patch({ enabled: checked })
                }}
              />
              <span className={styles.fieldHint}>
                {draft.enabled ? '保存后按计划排期' : '保存但不排期（仍可立即执行）'}
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* 校验提示单独占一行：窄栏里塞在按钮左边只剩半句话 */}
      <div className={styles.formFoot}>
        {problem && isDirty ? <p className={styles.formError}>{problem}</p> : null}
        <div className={styles.formActions}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={props.onCancel}>
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={Boolean(problem) || isSaving}
            onClick={function () {
              void handleSave().catch(function (error: unknown) {
                console.warn('[agent/tasks] 保存任务失败:', error)
                toast.error('保存任务失败')
              })
            }}>
            {isSaving ? '保存中…' : '保存'}
            <Icon
              icon="lucide:check"
              className="size-3.5"
            />
          </Button>
        </div>
      </div>
    </div>
  )
}

export { TaskForm }
export type { TaskFormProps }
