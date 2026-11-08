/**
 * 新建 / 编辑任务表单。
 *
 * 执行配置都在这里落：工作目录（cwd）、执行授权（能否不问就动手）。授权只有两档 ——
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
  findDraftProblem,
  findOwnerHint,
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

function TaskForm(props: TaskFormProps) {
  const [draft, updateDraft] = useState<TaskDraft>(props.draft)
  const [isSaving, updateSaving] = useState(false)
  /** 校验提示等用户动过一版再出现：空白表单上手就甩一行红字太凶，按钮置灰已经说明问题 */
  const [isDirty, updateDirty] = useState(false)
  const [planFiles, updatePlanFiles] = useState<PlanFileEntry[]>([])
  const [isListingPlans, updateListingPlans] = useState(false)

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

  function findWorkspacePath(workspaceID: string): string {
    const owned = folders.filter(function (item) {
      return item.workspaceID === workspaceID
    })
    return owned[0]?.path ?? ''
  }

  useEffect(
    function () {
      if (!isClient || !draft.workspaceId) {
        updatePlanFiles([])
        return
      }
      const rootPath = findWorkspacePath(draft.workspaceId)
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
    [isClient, draft.workspaceId, folders]
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
      const path = findWorkspacePath(workspace.id)
      return {
        value: workspace.id,
        label: path ? `${workspace.title} · ${path}` : workspace.title
      }
    })
  ]
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
            <span className={styles.fieldLabel}>工作目录</span>
            <Select
              items={workspaceItems}
              value={draft.workspaceId ?? 'none'}
              disabled={isExecConfigLocked}
              onValueChange={function (value) {
                if (typeof value !== 'string') return
                // 换工作目录：已绑的计划可能不属于新目录，清掉避免跑错文件
                patch({
                  workspaceId: value === 'none' ? null : value,
                  planFilePath: null
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
                : '任务的读写与命令都落在这个目录里。'}
            </p>
          </div>

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
                    <span className={styles.fieldHint}>先用计划模式出方案，再以目标模式按轮次执行</span>
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
