/**
 * 计划文件同步器：`source = 'file'` 的档案跟着 `.cogito/plans/*.md` 走。
 *
 * 为什么需要它：右栏计划一旦「从文件载入」或「保存到工作区」，正文的真相就在
 * 磁盘上。用户手改文件后，档案若不跟着更新，`revision` 永远停在旧值，右栏也就
 * 不会出现「计划已更新，需重新执行」的提示（对齐 VS Code `watchPlanChanges()`）。
 *
 * 做法：`source = 'file'` 时按 `stat` 的 `mtime + size` 轮询（1.5s，只读 stat，
 * 不读正文），变了才 `readPlanFile` 取回正文、算 digest，与档案 digest 不同就
 * `bumpRevision`（`running` 回落 `draft`，`done` / `interrupted` 归档成 `superseded`；
 * `executedRevision` 不动，于是右栏能显示「上次执行基于 rN」）。轮询而不是
 * `watch`：仓库已有 `readDir/stat` 权限，不需要新增 fs 能力。
 *
 * 对话里的回声不会覆盖文件：`plan-recorder` 对 `source = 'file'` 直接跳过。
 */
import { useAuiState } from '@assistant-ui/react'
import { join } from '@tauri-apps/api/path'
import { stat } from '@tauri-apps/plugin-fs'
import { useEffect } from 'react'

import { useActiveWorkspace } from '@/features/agent/workspace/active'
import { parsePlanText } from '@/features/agent/plan-draft'
import { readPlanFile } from '@/features/agent/plan-file'
import { bumpRevision, digestPlan, readPlan, usePlanRecord } from '@/features/agent/plan-store'
import { reportCaught } from '@/utils/exception-report'

/** 只 stat 不读正文，1.5s 一次足够跟上手工编辑 */
const POLL_INTERVAL = 1500

function PlanFileSync() {
  const threadID = useAuiState(function (state) {
    return state.threads.mainThreadId
  })
  const record = usePlanRecord(threadID)
  const { rootPath } = useActiveWorkspace()
  const filePath = record?.source === 'file' ? record.filePath : null

  useEffect(
    function () {
      if (!threadID || !rootPath || !filePath) return
      const id = threadID
      const root = rootPath
      const relative = filePath
      let alive = true
      let stamp = ''
      let reported = false
      let timer: ReturnType<typeof setInterval> | null = null

      async function sync() {
        try {
          const info = await stat(await join(root, relative))
          const next = `${info.mtime ? new Date(info.mtime).getTime() : 0}:${info.size ?? 0}`
          if (next === stamp) return
          stamp = next
          const file = await readPlanFile(root, relative)
          if (!alive) return
          reported = false
          const digest = digestPlan(file.body)
          const current = readPlan(id)
          if (!current || current.digest === digest) return
          const parsed = parsePlanText(file.body)
          bumpRevision(id, digest, {
            title: file.title,
            overview: file.overview,
            steps: parsed ? parsed.steps : current.steps,
            body: file.body
          })
        } catch (error) {
          // 文件被删/被移走都属正常态：只报一次，别每 1.5s 刷一条
          if (alive && !reported) {
            reported = true
            reportCaught('agent-plan-file-sync.sync', error)
          }
        }
      }

      void sync()
      timer = setInterval(function () {
        void sync()
      }, POLL_INTERVAL)

      return function () {
        alive = false
        if (timer !== null) clearInterval(timer)
      }
    },
    [threadID, rootPath, filePath]
  )

  return null
}

export { PlanFileSync }
