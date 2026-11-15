/**
 * 服务端任务行 → 界面用的 `Automation` 形状。
 *
 * 列表里要一视同仁地显示本机 / goose / 服务端三种任务；
 * wire 与本地均用全局字典三位 value，不再做英文映射。
 */
import type { CloudJob, CloudJobInput } from '@/apis/schedule'
import { DICT_KEY, DICT_VALUE_BY_KEY } from '@/shared/ipc/specs/dict'
import type { Automation } from '@/shared/ipc/specs/automation'

const OWNER = {
  CLIENT: DICT_VALUE_BY_KEY[DICT_KEY.OWNER_CLIENT],
  GOOSE: DICT_VALUE_BY_KEY[DICT_KEY.OWNER_GOOSE],
  CLOUD: DICT_VALUE_BY_KEY[DICT_KEY.OWNER_CLOUD]
}
const RUN_AS = {
  USER: DICT_VALUE_BY_KEY[DICT_KEY.RUN_AS_USER],
  TENANT: DICT_VALUE_BY_KEY[DICT_KEY.RUN_AS_TENANT]
}

function parseRunAs(value: string | null | undefined): string {
  if (value === 'tenant' || value === RUN_AS.TENANT) return RUN_AS.TENANT
  return RUN_AS.USER
}

function toCloudAutomation(job: CloudJob): Automation {
  return {
    id: job.id,
    name: job.name,
    prompt: job.prompt,
    knowledgeBaseId: null,
    // 服务端任务的执行授权在服务端：客户端只镜像，界面按只读展示（不能本地改）
    workspaceId: null,
    approval: 'readonly',
    providerId: null,
    modelId: null,
    // 服务端任务的思考强度在服务端配：本地只镜像，界面按「标准」展示
    thinking: 'medium',
    mode: 'agent',
    goalBudget: 6,
    planThenGoal: false,
    planFilePath: null,
    schedule: job.cron,
    timezone: job.timezone,
    enabled: job.enabled,
    owner: OWNER.CLOUD,
    runAsKind: parseRunAs(job.runAsKind),
    runAsUserId: job.runAsUserId,
    tenantId: null,
    remoteId: job.id,
    nextRunAt: job.nextRunAt,
    lastRunAt: job.lastRunAt,
    lastStatus: job.lastStatus,
    lastError: job.lastError,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  }
}

/**
 * 界面 → 服务端请求体。
 *
 * `runAsKind` **只在明确认识时才带**：缺省写成 `user` 会把「以租户身份运行」的任务
 * 在编辑保存后悄悄改成「我自己跑」，而界面上看不出任何变化。不认识就不传，
 * 让服务端保留原值（新建时服务端本来也默认 user）。
 */
function toCloudInput(input: {
  id?: string
  name: string
  prompt: string
  schedule: string
  timezone?: string
  enabled?: boolean
  runAsKind?: string
}): CloudJobInput {
  const runAsKind =
    input.runAsKind === RUN_AS.TENANT || input.runAsKind === 'tenant'
      ? 'tenant'
      : input.runAsKind === RUN_AS.USER || input.runAsKind === 'user'
        ? 'user'
        : undefined
  const base: CloudJobInput = {
    id: input.id,
    name: input.name,
    prompt: input.prompt,
    cron: input.schedule,
    timezone: input.timezone,
    enabled: input.enabled
  }
  // 不认识就不传，交给服务端保留原值
  return runAsKind === undefined ? base : { ...base, runAsKind }
}

export { toCloudAutomation, toCloudInput }
