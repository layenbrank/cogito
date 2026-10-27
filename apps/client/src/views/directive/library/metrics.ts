/**
 * 指令库洞察：本会话 runs 聚合「正在运行」与页眉计数。
 * 历史活动/结果饼图已从侧栏移除；内存/CPU 由 use-host-metrics 采样。
 */

import type { DirectiveEntry } from '@/shared/ipc/specs/sidecar'
import type { CorexRun } from '@/stores/corex'
import { indexLastRuns, isRunning } from '@/views/directive/run/run-status'

interface LibraryMetrics {
  running: CorexRun[]
  totals: {
    directives: number
    running: number
    ok: number
    failed: number
  }
}

function buildLibraryMetrics(args: {
  directives: readonly DirectiveEntry[]
  runs: readonly CorexRun[]
}): LibraryMetrics {
  const running = args.runs.filter(isRunning)

  let ok = 0
  let failed = 0
  args.runs.forEach(function (run) {
    if (run.status === 'ok') ok += 1
    else if (run.status === 'failed') failed += 1
  })

  // last_run 补会话外完成态，避免页眉全空
  const lastRuns = indexLastRuns(args.directives)
  Object.values(lastRuns).forEach(function (last) {
    if (last.ok) ok += 1
    else failed += 1
  })

  return {
    running,
    totals: {
      directives: args.directives.length,
      running: running.length,
      ok,
      failed
    }
  }
}

export { buildLibraryMetrics }
export type { LibraryMetrics }
