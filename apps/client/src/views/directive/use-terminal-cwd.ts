/**
 * 指令页终端 cwd：优先 agent 工作区主路径，否则用户家目录。
 */
import { homeDir } from '@tauri-apps/api/path'
import { useEffect, useState } from 'react'

import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'

const EMPTY_CWD_MESSAGE = '无法确定工作目录'

function useTerminalCwd() {
  const { primaryPath } = useActiveWorkspace()
  const [homePath, setHomePath] = useState<string | null>(null)

  useEffect(
    function () {
      if (primaryPath) return
      let cancelled = false
      void homeDir()
        .then(function (path) {
          if (!cancelled) setHomePath(path)
        })
        .catch(function (error) {
          console.warn('[directive] 读取家目录失败', error)
          if (!cancelled) setHomePath(null)
        })
      return function () {
        cancelled = true
      }
    },
    [primaryPath]
  )

  const cwd = primaryPath ?? homePath

  return {
    cwd,
    emptyCwdMessage: EMPTY_CWD_MESSAGE
  }
}

export { useTerminalCwd, EMPTY_CWD_MESSAGE }
