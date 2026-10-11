import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { fetchJobs, startJob, stopJob } from '@/lib/directive-ipc.ts'
import type { JobKind, JobView } from '@/shared/ipc/specs/sidecar'
import { useCorexStore } from '@/stores/corex.ts'

const JOBS_CACHE_MS = 2_500
const DEAD_POLL_MS = 150
const DEAD_POLL_MAX = 20
let jobsCache: { at: number; jobs: JobView[] } | null = null

interface GuardAlive {
  cron: boolean
  watch: boolean
}

interface UseGuardRunOptions {
  name: string
  beforeGuard?: () => Promise<string | null>
}

interface GuardRunApi {
  alive: GuardAlive
  isBusy: boolean
  stopKind: JobKind | null
  isCronRunning: boolean
  isWatchRunning: boolean
  isCronStopping: boolean
  isWatchStopping: boolean
  refreshAlive: () => Promise<void>
  startGuard: (kind: JobKind) => Promise<void>
  requestStop: (kind: JobKind) => void
  confirmStop: (kind: JobKind, force: boolean) => Promise<void>
  closeStopDialog: () => void
}

function sleep(ms: number): Promise<void> {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

function toIpcMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return fallback
}

async function loadJobs(): Promise<JobView[]> {
  const now = Date.now()
  if (jobsCache && now - jobsCache.at < JOBS_CACHE_MS) return jobsCache.jobs
  const reply = await fetchJobs({})
  const jobs = reply.jobs ?? []
  jobsCache = { at: now, jobs }
  return jobs
}

function dropJobsCache() {
  jobsCache = null
}

function isAlive(jobs: JobView[], kind: JobKind, name: string): boolean {
  return jobs.some(function (job) {
    return job.kind === kind && job.name === name && job.is_alive
  })
}

async function waitUntilDead(kind: JobKind, name: string): Promise<boolean> {
  for (let i = 0; i < DEAD_POLL_MAX; i += 1) {
    dropJobsCache()
    const jobs = await loadJobs()
    if (!isAlive(jobs, kind, name)) return true
    await sleep(DEAD_POLL_MS)
  }
  return false
}

async function stopGuardJob(fields: {
  kind: JobKind
  name: string
  force: boolean
  isTaskRunning: boolean
}): Promise<void> {
  await stopJob({
    kind: fields.kind,
    name: fields.name,
    force: fields.force
  })
  dropJobsCache()
  const label = fields.kind === 'cron' ? 'cron' : 'watch'
  if (fields.force) {
    useCorexStore.getState().cancelTriggerRuns(fields.name, fields.kind)
    toast.success(fields.kind === 'cron' ? '已强制停止 cron' : '已强制停止 watch', {
      description: '进行中的任务已一并终止'
    })
    return
  }
  if (fields.isTaskRunning) {
    useCorexStore.getState().markTriggerStopping(fields.name, fields.kind)
    toast.success(fields.kind === 'cron' ? '已请求停止 cron' : '已请求停止 watch', {
      description: '当前任务结束后再退出'
    })
    return
  }
  toast.success(fields.kind === 'cron' ? '已停止 cron' : '已停止 watch', {
    description: label
  })
}

function useGuardRun(options: UseGuardRunOptions): GuardRunApi {
  const [alive, updateAlive] = useState<GuardAlive>({ cron: false, watch: false })
  const [isBusy, updateBusy] = useState(false)
  const [stopKind, updateStopKind] = useState<JobKind | null>(null)
  const wasCronRunning = useRef(false)
  const wasWatchRunning = useRef(false)

  const isCronRunning = useCorexStore(function (state) {
    return state.runs.some(function (run) {
      return run.name === options.name && run.status === 'running' && run.trigger === 'cron'
    })
  })
  const isWatchRunning = useCorexStore(function (state) {
    return state.runs.some(function (run) {
      return run.name === options.name && run.status === 'running' && run.trigger === 'watch'
    })
  })
  const isCronStopping = useCorexStore(function (state) {
    return state.runs.some(function (run) {
      return (
        run.name === options.name &&
        run.status === 'running' &&
        run.trigger === 'cron' &&
        run.isStopping
      )
    })
  })
  const isWatchStopping = useCorexStore(function (state) {
    return state.runs.some(function (run) {
      return (
        run.name === options.name &&
        run.status === 'running' &&
        run.trigger === 'watch' &&
        run.isStopping
      )
    })
  })

  const refreshAlive = useCallback(
    async function () {
      if (!options.name) return
      try {
        const jobs = await loadJobs()
        updateAlive({
          cron: isAlive(jobs, 'cron', options.name),
          watch: isAlive(jobs, 'watch', options.name)
        })
      } catch (error) {
        console.warn('[guard-run] 对账守护状态失败', options.name, error)
        updateAlive({ cron: false, watch: false })
      }
    },
    [options.name]
  )

  useEffect(
    function () {
      if (wasCronRunning.current && !isCronRunning) {
        dropJobsCache()
        void refreshAlive()
      }
      wasCronRunning.current = isCronRunning
    },
    [isCronRunning, refreshAlive]
  )

  useEffect(
    function () {
      if (wasWatchRunning.current && !isWatchRunning) {
        dropJobsCache()
        void refreshAlive()
      }
      wasWatchRunning.current = isWatchRunning
    },
    [isWatchRunning, refreshAlive]
  )

  async function startGuard(kind: JobKind) {
    if (!options.name || isBusy) return
    updateBusy(true)
    try {
      const name = options.beforeGuard ? await options.beforeGuard() : options.name
      if (!name) return
      await startJob({ kind, name })
      dropJobsCache()
      toast.success(kind === 'cron' ? '已启动 cron 守护' : '已启动 watch 守护', {
        description: name
      })
      await refreshAlive()
    } catch (error) {
      toast.error(kind === 'cron' ? '无法启动 cron' : '无法启动 watch', {
        description: toIpcMessage(error, '启动失败')
      })
    } finally {
      updateBusy(false)
    }
  }

  function requestStop(kind: JobKind) {
    const isTaskRunning = kind === 'cron' ? isCronRunning : isWatchRunning
    if (isTaskRunning) {
      updateStopKind(kind)
      return
    }
    void confirmStop(kind, false)
  }

  async function confirmStop(kind: JobKind, force: boolean) {
    if (!options.name || isBusy) return
    const isTaskRunning = kind === 'cron' ? isCronRunning : isWatchRunning
    updateBusy(true)
    try {
      await stopGuardJob({
        kind,
        name: options.name,
        force,
        isTaskRunning
      })
      updateStopKind(null)
      if (force || !isTaskRunning) {
        updateAlive(function (prev) {
          return { ...prev, [kind]: false }
        })
        const isDead = await waitUntilDead(kind, options.name)
        if (!isDead) await refreshAlive()
      }
    } catch (error) {
      toast.error('无法停止守护', { description: toIpcMessage(error, '停止失败') })
      await refreshAlive()
    } finally {
      updateBusy(false)
    }
  }

  function closeStopDialog() {
    updateStopKind(null)
  }

  return {
    alive,
    isBusy,
    stopKind,
    isCronRunning,
    isWatchRunning,
    isCronStopping,
    isWatchStopping,
    refreshAlive,
    startGuard,
    requestStop,
    confirmStop,
    closeStopDialog
  }
}

export { dropJobsCache, isAlive, loadJobs as fetchJobs, useGuardRun, waitUntilDead }
export type { GuardAlive, GuardRunApi }
