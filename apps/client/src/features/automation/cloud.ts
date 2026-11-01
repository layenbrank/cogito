/**
 * 服务端任务行 → 界面用的 `Automation` 形状。
 *
 * 列表里要一视同仁地显示本机 / goose / 服务端三种任务；
 * wire 与本地均用全局字典三位 value，不再做英文映射。
 */
import type { CloudJob } from '@/apis/schedule'
import { DICT_KEY, DICT_VALUE_BY_KEY } from '@/shared/ipc/specs/dict'
import type { Automation } from '@/shared/ipc/specs/automation'

const OWNER = {
  CLIENT: DICT_VALUE_BY_KEY[DICT_KEY.OWNER_CLIENT]!,
  GOOSE: DICT_VALUE_BY_KEY[DICT_KEY.OWNER_GOOSE]!,
  CLOUD: DICT_VALUE_BY_KEY[DICT_KEY.OWNER_CLOUD]!
}
const RUN_AS = {
  USER: DICT_VALUE_BY_KEY[DICT_KEY.RUN_AS_USER]!,
  TENANT: DICT_VALUE_BY_KEY[DICT_KEY.RUN_AS_TENANT]!
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

/** 界面 → 服务端请求体（`runAsKind` 缺省用 user，执行人是创建人） */
function toCloudInput(input: {
  id?: string
  name: string
  prompt: string
  schedule: string
  timezone?: string
  enabled?: boolean
  runAsKind?: string
}) {
  const runAsKind: 'user' | 'tenant' =
    input.runAsKind === RUN_AS.TENANT || input.runAsKind === 'tenant' ? 'tenant' : 'user'
  return {
    id: input.id,
    name: input.name,
    prompt: input.prompt,
    cron: input.schedule,
    timezone: input.timezone,
    enabled: input.enabled,
    runAsKind
  }
}

export { toCloudAutomation, toCloudInput }
