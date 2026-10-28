/**
 * 服务端任务行 → 界面用的 `Automation` 形状。
 *
 * 为什么做这层映射：列表里要一视同仁地显示本机 / goose / 服务端三种任务，
 * 但它们的来源与可执行动作完全不同（服务端不能「立即执行」，也不能改成本机）。
 */
import type { CloudJob } from '@/apis/schedule'
import type { Automation } from '@/shared/ipc/specs/automation'

function toCloudAutomation(job: CloudJob): Automation {
  return {
    id: job.id,
    name: job.name,
    prompt: job.prompt,
    knowledgeBaseId: null,
    schedule: job.cron,
    timezone: job.timezone,
    enabled: job.enabled,
    owner: 'cloud',
    runAsKind: job.runAsKind,
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
}) {
  return {
    id: input.id,
    name: input.name,
    prompt: input.prompt,
    cron: input.schedule,
    timezone: input.timezone,
    enabled: input.enabled,
    runAsKind: 'user' as const
  }
}

export { toCloudAutomation, toCloudInput }
