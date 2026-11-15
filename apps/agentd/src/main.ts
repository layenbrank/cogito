/**
 * 入口：读配置 → 开库 → 起 HTTP → **stdout 握手行** → 等退出信号。
 *
 * 握手行是 Tauri 唯一可靠的端口来源（`AGENTD_READY {json}`），
 * 不做「先探测空闲端口再传进来」那种有 TOCTOU 的方案。
 */

import { createAgentServer } from './agent-server'
import { createApprovalHub } from './approvals'
import { createSqliteSaver } from './checkpointer'
import { readConfig } from './config'
import { openDb } from './db'
import { createElicitationHub } from './elicitations'
import { createEventHub } from './events'
import { createGooseGraph } from './graph'
import { createGooseSupervisor } from './goose/supervisor'
import { SERVICE_NAME, createApp } from './server'
import type { AgentdStatus } from './server'

const STARTED_AT = Date.now()
const SHUTDOWN_TIMEOUT_MS = 5_000

function log(message: string, extra?: Record<string, unknown>): void {
  const line = extra ? `${message} ${JSON.stringify(extra)}` : message
  console.log(line)
}

/**
 * `--version` / `--help` 早退：**必须在读配置之前**。
 *
 * 打包校验（`agentd-<triple> --version`）跑在没注入 `AGENTD_TOKEN` 的环境里，
 * 而 `readConfig()` 对缺 token 是 fail-closed 直接退出 2 —— 放在后面就永远验不了产物。
 */
function handleCli(): boolean {
  const argv = process.argv.slice(1)
  if (argv.includes('--version') || argv.includes('-v')) {
    // 与握手行的 version 同源（`AGENTD_VERSION` 由打包注入，缺省 dev）
    console.log(process.env.AGENTD_VERSION?.trim() || '0.0.0-dev')
    return true
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(
      [
        'cogito-agentd —— 桌面端 agent 循环宿主（goose ACP + LangGraph + Agent Protocol）',
        '',
        '正常用法：由 Tauri 以 sidecar 拉起，从 stdout 的 AGENTD_READY 行读端口。',
        '',
        '环境变量：',
        '  AGENTD_TOKEN            必填，≥16 字符；HTTP bearer',
        '  AGENTD_DB               必填，SQLite 文件路径',
        '  AGENTD_PORT             监听端口，默认 0（内核挑空闲端口）',
        '  AGENTD_GOOSE_PATH_ROOT  goose 的数据根；不配则不托管内层 goose',
        '  AGENTD_GOOSE_BINARY     goose 可执行文件，默认 `goose`',
        '  AGENTD_VERSION          版本号（打包时注入）',
        '  AGENTD_ISOLATED         非空 = dev 隔离实例',
        '',
        '命令行：',
        '  --version, -v           打印版本后退出',
        '  --help, -h              打印本帮助后退出'
      ].join('\n')
    )
    return true
  }
  return false
}

async function bootstrap(): Promise<void> {
  if (handleCli()) return

  let config
  try {
    config = readConfig()
  } catch (error) {
    // 配置错就是装错/注入错：立即失败，让 Rust 侧看到退出码
    console.error(`AGENTD_FATAL ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
    return
  }

  const db = openDb(config.dbPath)

  // 内层 goose：没配 GOOSE_PATH_ROOT 就不托管（CI / 单测场景）
  const supervisor = createGooseSupervisor({
    binary: config.gooseBinary ?? 'goose',
    pathRoot: config.goosePathRoot,
    baseEnv: process.env,
    onStderr: function (text: string) {
      const trimmed = text.trim()
      if (trimmed) console.error(`[goose] ${trimmed}`)
    }
  })
  if (config.goosePathRoot) {
    await supervisor.start()
  }

  // 工具审批闸门：goose 的 `session/request_permission` 挂在这里等用户回执
  const approvals = createApprovalHub()
  // 结构化追问（`elicitation/create`）：与审批同构，但回执是 `{action, content?}`
  const elicitations = createElicitationHub()
  // 会话事件流：前端靠它渲染正文与工具卡（`/runs/stream` 只吐图状态）
  const events = createEventHub()

  const agentServer = createAgentServer({
    graph: createGooseGraph({
      supervisor,
      checkpointer: createSqliteSaver(db),
      approvals,
      elicitations,
      events
    }),
    approvals,
    elicitations,
    events,
    // goose 查询面（P4-a）：前端把 providers/extensions/diagnostics 这类读操作交给 agentd，
    // 不再自己连 ACP。未托管 goose 时为 null → 这些路由回 503。
    goose: {
      request: function (method: string, params?: unknown) {
        const client = supervisor.client()
        if (!client) return Promise.reject(new Error('goose 未就绪'))
        return client.request(method, params)
      },
      cancel: function (sessionId: string) {
        const client = supervisor.client()
        if (!client) return Promise.reject(new Error('goose 未就绪'))
        return client.cancel(sessionId)
      }
    }
  })

  const status = function (): AgentdStatus {
    const goose = supervisor.snapshot()
    return {
      service: SERVICE_NAME,
      version: config.version,
      uptimeMs: Date.now() - STARTED_AT,
      pid: process.pid,
      graphs: agentServer.graphs(),
      goose: goose.state,
      restarts: goose.restarts
    }
  }

  async function disposeAll(): Promise<void> {
    // 先把待审批/待追问全部结掉，免得有请求挂在半空
    approvals.cancelAll()
    elicitations.cancelAll()
    try {
      await supervisor.stop()
    } catch {
      // 关 goose 失败不该盖住正常退出
    }
    try {
      await agentServer.stop()
    } catch {
      // 关协议运行时失败同理
    }
    try {
      db.close()
    } catch {
      // 关库失败不该盖住正常退出
    }
    process.exit(0)
  }

  let closing = false
  const shutdown = function (reason: string): void {
    if (closing) return
    closing = true
    log('AGENTD_SHUTDOWN', { reason })
    const timer = setTimeout(function () {
      log('AGENTD_SHUTDOWN_TIMEOUT')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)
    timer.unref()
    server.close(function () {
      void disposeAll()
    })
  }

  const app = createApp({
    token: config.token,
    status,
    onShutdown: function () {
      shutdown('admin')
    },
    restartGoose: config.goosePathRoot
      ? function () {
          return supervisor.restart()
        }
      : undefined,
    mount: function (target) {
      agentServer.mount(target)
    }
  })

  const server = app.listen(config.port, '127.0.0.1', function () {
    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : config.port
    log('AGENTD_READY', {
      port,
      pid: process.pid,
      version: config.version,
      service: SERVICE_NAME,
      isolated: config.isolated,
      // 握手行也报真实状态：此时 supervisor.start() 已经 await 过
      goose: supervisor.snapshot().state
    })
  })

  server.on('error', function (error: Error) {
    console.error(`AGENTD_FATAL ${error.message}`)
    process.exit(1)
  })

  process.on('SIGINT', function () {
    shutdown('sigint')
  })
  process.on('SIGTERM', function () {
    shutdown('sigterm')
  })
}

bootstrap().catch(function (error: unknown) {
  console.error(
    `AGENTD_FATAL ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
  )
  process.exit(1)
})
