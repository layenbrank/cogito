/**
 * 服务端定时任务（cogito `/api/v1/automations`）。
 *
 * 与本机任务（`lib/automation-ipc.ts`）是两条路：这里由服务端 worker 认领与执行，
 * 关掉客户端照跑。鉴权（JWT + `X-Tenant-ID` + `traceparent`）由 `utils/http.ts` 统一注入。
 *
 * 字段与 `apps/service/src/services/schedule/schema.rs` 的 `JobP` / `JobR` 对齐：
 * cron 是 **5 段 crontab**（分 时 日 月 周），`nextRunAt` 由服务端算，客户端不传。
 */
import { HttpEnvelope } from '@/utils/http/errors.ts'
import { http } from '@/utils/http/http.ts'

/** 服务端任务行（`JobR`） */
interface CloudJob {
  id: string
  name: string
  prompt: string
  cron: string
  timezone: string
  enabled: boolean
  runAsKind: string
  runAsUserId: string | null
  /** 下次触发（epoch ms）；停用时为空 */
  nextRunAt: number | null
  lastRunAt: number | null
  /** `running` / `succeeded` / `failed` */
  lastStatus: string | null
  lastError: string | null
  /** 最近一次起出来的 agent 任务 id */
  lastTaskId: string | null
  createdAt: number
  updatedAt: number
}

/** 新建或整体替换（`JobP`）：`id` 非空即替换 */
interface CloudJobInput {
  id?: string
  name: string
  prompt: string
  cron: string
  timezone?: string
  enabled?: boolean
  runAsKind?: 'user' | 'tenant'
  runAsUserId?: string
}

/** 局部更新（`JobPatchP`）：只传要改的项 */
interface CloudJobPatch {
  name?: string
  prompt?: string
  cron?: string
  timezone?: string
  enabled?: boolean
  runAsKind?: 'user' | 'tenant'
  runAsUserId?: string
}

function GET_JOBS(signal?: AbortSignal): Promise<CloudJob[]> {
  return http
    .get<RSF<CloudJob[]>>('/automations', { env: 'cogito', signal })
    .then(HttpEnvelope)
    .then(function (rows) {
      return rows ?? []
    })
}

function SAVE_JOB(input: CloudJobInput): Promise<CloudJob> {
  return http
    .post<RSF<CloudJob>>('/automations', input, { env: 'cogito' })
    .then(HttpEnvelope)
}

function PATCH_JOB(id: string, patch: CloudJobPatch): Promise<CloudJob> {
  return http
    .patch<RSF<CloudJob>>(`/automations/${id}`, patch, { env: 'cogito' })
    .then(HttpEnvelope)
}

function DELETE_JOB(id: string): Promise<number> {
  return http
    .delete<RSF<number>>(`/automations/${id}`, { env: 'cogito' })
    .then(HttpEnvelope)
}

export { DELETE_JOB, GET_JOBS, PATCH_JOB, SAVE_JOB }
export type { CloudJob, CloudJobInput, CloudJobPatch }
