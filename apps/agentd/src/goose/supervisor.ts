/**
 * goose 进程的生命周期（内层）：spawn → initialize → ready，失败进 failed。
 *
 * 分层约定（与 ADR D3/D8 一致）：
 * - **外层**（Tauri 的 `utils/agentd.rs`）负责「agentd 崩了重启 agentd」；
 * - **内层**（这里）负责「goose 崩了 / 需要重启时重启 goose」，由 `/admin/goose/restart` 驱动。
 * 两层不互相猜测对方的状态，各自只报自己的快照。
 */

import { spawnGooseAcp } from './client'
import type { GooseAcpClient, InitializeResult } from './client'

type GooseState = 'disabled' | 'starting' | 'ready' | 'failed'

interface GooseSupervisorOptions {
  /** 空表示**不托管 goose**（比如 CI / 只跑单测时） */
  binary: string | null
  pathRoot: string | null
  cwd?: string
  baseEnv?: NodeJS.ProcessEnv
  onStderr?: (text: string) => void
}

interface GooseSnapshot {
  state: GooseState
  restarts: number
  pid?: number
  agentInfo?: string
  error?: string
}

interface GooseSupervisor {
  start(): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
  client(): GooseAcpClient | null
  snapshot(): GooseSnapshot
}

function readGooseEnv(pathRoot: string, baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    GOOSE_PATH_ROOT: pathRoot,
    // 与 Rust `with_cli_envs` 对齐：Cursor CLI 的 PATH/KEY 由 Tauri 注入，这里只保证不被清掉
    NO_COLOR: '1'
  }
}

function createGooseSupervisor(options: GooseSupervisorOptions): GooseSupervisor {
  let client: GooseAcpClient | null = null
  let state: GooseState = options.binary && options.pathRoot ? 'starting' : 'disabled'
  let restarts = 0
  let lastError: string | undefined
  let agentInfo: string | undefined

  function snapshot(): GooseSnapshot {
    const value: GooseSnapshot = { state, restarts }
    if (lastError) value.error = lastError
    if (agentInfo) value.agentInfo = agentInfo
    if (client?.pid !== undefined) value.pid = client.pid
    return value
  }

  function dispose(): void {
    if (!client) return
    try {
      client.close()
    } catch {
      // 进程已经没了
    }
    client = null
  }

  async function start(): Promise<void> {
    if (!options.binary || !options.pathRoot) {
      state = 'disabled'
      return
    }
    dispose()
    state = 'starting'
    lastError = undefined
    agentInfo = undefined

    const next = spawnGooseAcp({
      binary: options.binary,
      cwd: options.cwd,
      env: readGooseEnv(options.pathRoot, options.baseEnv ?? process.env),
      onStderr: options.onStderr,
      onExit: function (code) {
        // 非主动停止时进 failed；state 已 ready 说明是运行中崩了
        if (state === 'ready' || state === 'starting') {
          state = 'failed'
          lastError = `goose acp 退出（code=${code ?? 'null'}）`
        }
      }
    })
    client = next

    try {
      const info: InitializeResult = await next.initialize()
      agentInfo = info.agentInfo
        ? `${info.agentInfo.name ?? 'goose'} ${info.agentInfo.version ?? ''}`.trim()
        : undefined
      state = 'ready'
    } catch (error) {
      state = 'failed'
      lastError = error instanceof Error ? error.message : String(error)
      dispose()
    }
  }

  async function stop(): Promise<void> {
    dispose()
    if (state !== 'disabled') state = 'failed'
  }

  async function restart(): Promise<void> {
    restarts += 1
    await start()
  }

  return {
    start,
    stop,
    restart,
    client: function (): GooseAcpClient | null {
      return client
    },
    snapshot
  }
}

export { createGooseSupervisor, readGooseEnv }
export type { GooseSnapshot, GooseState, GooseSupervisor, GooseSupervisorOptions }
