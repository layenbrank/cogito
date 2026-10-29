/**
 * 服务端任务行 → 界面用的 `Automation` 形状。
 *
 * 为什么做这层映射：列表里要一视同仁地显示本机 / goose / 服务端三种任务，
 * 但它们的来源与可执行动作完全不同（服务端不能「立即执行」，也不能改成本机）。
 * 云端枚举仍是英文语义串，在此映射到本地字典 value。
 */
import type { CloudJob } from '@/apis/schedule'
import { DICT_VALUE } from '@/shared/ipc/specs/dict'
import type { Automation } from '@/shared/ipc/specs/automation'

const OWNER = DICT_VALUE.AUTOMATION_OWNER
const RUN_AS = DICT_VALUE.AUTOMATION_RUN_AS
const RUN_STATUS = DICT_VALUE.AUTOMATION_RUN_STATUS

function parseRunAs(value: string | null | undefined): string {
  if (value === 'tenant' || value === RUN_AS.TENANT) return RUN_AS.TENANT
  return RUN_AS.USER
}

function parseRunStatus(value: string | null | undefined): string | null {
  if (!value) return null
  switch (value) {
    case 'pending':
    case RUN_STATUS.PENDING:
      return RUN_STATUS.PENDING
    case 'running':
    case RUN_STATUS.RUNNING:
      return RUN_STATUS.RUNNING
    case 'succeeded':
    case 'ok':
    case RUN_STATUS.SUCCEEDED:
      return RUN_STATUS.SUCCEEDED
    case 'failed':
    case RUN_STATUS.FAILED:
      return RUN_STATUS.FAILED
    default:
      return value
  }
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
    lastStatus: parseRunStatus(job.lastStatus),
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
