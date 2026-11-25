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
import { createRunEventStore } from './event-store'
import { createGateStore } from './gate-store'
import { createGooseGraph } from './graph'
import { createGooseSupervisor } from './goose/supervisor'
import { createObservability } from './observability'
import { SERVICE_NAME, createApp } from './server'
import type { AgentdStatus } from './server'
import { createSessionRegistry } from './session-registry'

const STARTED_AT = Date.now()
const SHUTDOWN_TIMEOUT_MS = 5_000
/** 事件日志保留天数：与 agent cache 的 7 天对齐 */
const EVENT_RETENTION_DAYS = 7
const EVENT_PRUNE_INTERVAL_MS = 60 * 60_000

/** 优雅关停入口；bootstrap 完成装配前为空，此时只能直接退出 */
let fatalHandler: ((reason: string) => void) | null = null

function reportFatal(kind: string, error: unknown): void {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error(`AGENTD_FATAL ${kind} ${detail}`)
  if (fatalHandler) {
    fatalHandler(kind)
    return
  }
  process.exit(1)
}

// Node 对未监听的 'error' 与未处理的 rejection 会直接结束进程。
// 先把它们变成「记录 + 优雅关停」，否则一个 EPIPE 就能让整条 agent 链路消失。
process.on('uncaughtException', function (error) {
  reportFatal('uncaughtException', error)
})
process.on('unhandledRejection', function (reason) {
  reportFatal('unhandledRejection', reason)
})

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
        '  AGENTD_ALLOWED_ROOTS    run 的 cwd 允许根（path.delimiter 分隔；空 = 只校验存在性）',
        '  AGENTD_MCP_ALLOWED_COMMANDS  MCP command 白名单（path.delimiter 分隔）',
        '  AGENTD_MCP_ALLOW_BARE_COMMAND=1  允许裸 MCP 命令（默认 false，要求绝对路径）',
        '  AGENTD_MCP_ALLOW_ARBITRARY=1    允许任意绝对路径 MCP（默认只认 corex-mcp / cogito-mcp）',
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

  // 事件日志与 gate 请求都落库：内存只服务实时尾部与当前进程的 waiter
  const eventStore = createRunEventStore(db)
  const gateStore = createGateStore(db)
  // 上一进程残留的 pending 一定无人回执（goose 随之退出），启动时统一作废
  const staleGates = gateStore.cancelPending()

  // 计数器 + 结构化日志：单进程侧车，自己数一会儿就够了，不引 OTel
  const observability = createObservability()

  // 工具审批闸门：goose 的 `session/request_permission` 挂在这里等用户回执
  const approvals = createApprovalHub({
    store: gateStore,
    onTimeout: function () {
      observability.metrics.inc('approvals.timeout')
    }
  })
  // 结构化追问（`elicitation/create`）：与审批同构，但回执是 `{action, content?}`
  const elicitations = createElicitationHub({
    store: gateStore,
    onTimeout: function () {
      observability.metrics.inc('elicitations.timeout')
    }
  })
  // 会话事件流：持久日志 + 内存热尾；前端靠它渲染正文与工具卡
  const events = createEventHub({
    store: eventStore,
    onStoreError: function (error) {
      // 降级为纯内存：继续跑，但明确告警（补发不再完整）
      console.error(`AGENTD_EVENT_STORE_DEGRADED ${String(error)}`)
    }
  })
  const pruned = events.prune(Date.now() - EVENT_RETENTION_DAYS * 24 * 60 * 60_000)
  log('AGENTD_EVENTS_READY', {
    epoch: events.epoch(),
    durable: events.durable(),
    pruned,
    staleGates
  })
  const pruneTimer = setInterval(function () {
    try {
      const removed = events.prune(Date.now() - EVENT_RETENTION_DAYS * 24 * 60 * 60_000)
      if (removed > 0) log('AGENTD_EVENTS_PRUNED', { removed })
    } catch (error) {
      console.warn(`[agentd] 事件日志清理失败：${String(error)}`)
    }
  }, EVENT_PRUNE_INTERVAL_MS)
  pruneTimer.unref()
  // thread → session：首轮取消要在 checkpoint 落盘前拿到 sessionId
  const sessions = createSessionRegistry()

  // 内层 goose：没配 GOOSE_PATH_ROOT 就不托管（CI / 单测场景）
  const supervisor = createGooseSupervisor({
    binary: config.gooseBinary ?? 'goose',
    pathRoot: config.goosePathRoot,
    baseEnv: process.env,
    onStderr: function (text: string) {
      const trimmed = text.trim()
      if (trimmed) console.error(`[goose] ${trimmed}`)
    },
    onExit: function (info) {
      // goose 没了，挂着的审批/追问永远不会有人回执：立即结案，别让 UI 留僵尸卡
      approvals.cancelAll()
      elicitations.cancelAll()
      log('AGENTD_GOOSE_EXIT', { code: info.code, reason: info.reason ?? '' })
    }
  })
  if (config.goosePathRoot) {
    await supervisor.start()
  }

  const agentServer = createAgentServer({
    graph: createGooseGraph({
      supervisor,
      checkpointer: createSqliteSaver(db),
      approvals,
      elicitations,
      events,
      // session 一建立就登记：取消路径不等 checkpoint 落盘
      onSession: function (threadID, sessionID) {
        sessions.remember(threadID, sessionID)
      },
      // 工具调用在 goose 内部跑：不在这里把日志接上，文件里就只剩「这一轮失败了」
      logEvent: observability.event,
      metrics: observability.metrics
    }),
    approvals,
    elicitations,
    events,
    sessions,
    validation: {
      allowedRoots: config.allowedRoots,
      mcpAllowedCommands: config.mcpAllowedCommands,
      allowBareMcpCommand: config.allowBareMcpCommand,
      allowArbitraryMcpCommand: config.allowArbitraryMcpCommand
    },
    metrics: observability.metrics,
    logEvent: observability.event,
    // goose 查询面（P4-a）：前端把 providers/extensions/diagnostics 这类读操作交给 agentd，
    // 不再自己连 ACP。未托管 goose 时为 null → 这些路由回 503。
    goose: {
      request: function (method: string, params?: unknown) {
        const client = supervisor.client()
        if (!client) return Promise.reject(new Error('goose 未就绪'))
        return client.request(method, params)
      },
      cancel: function (sessionID: string) {
        const client = supervisor.client()
        if (!client) return Promise.reject(new Error('goose 未就绪'))
        return client.cancel(sessionID)
      },
      // 补历史要监听重放通知（`session/load` 的历史是通知推来的，没人听就丢）
      onSessionUpdate: function (listener: (sessionID: string, update: unknown) => void) {
        const client = supervisor.client()
        // 没就绪时给一个空取消函数：调用方（`/replay`）自己会按 `goose` 是否可用兜
        if (!client) return function () {}
        return client.onSessionUpdate(listener)
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

  async function disposeAll(exitCode = 0): Promise<void> {
    // 先把待审批/待追问全部结掉，免得有请求挂在半空
    approvals.cancelAll()
    elicitations.cancelAll()
    clearInterval(pruneTimer)
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
    process.exit(exitCode)
  }

  let closing = false
  const shutdown = function (reason: string, exitCode = 0): void {
    if (closing) return
    closing = true
    log('AGENTD_SHUTDOWN', { reason })
    const timer = setTimeout(function () {
      log('AGENTD_SHUTDOWN_TIMEOUT')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)
    timer.unref()

    // SSE 是长驻连接：`server.close()` 只停止接收新连接，等不到它们自然结束。
    // 先主动断开，再给 200ms 让响应收尾，最后强关残留（keep-alive / 卡住的请求）。
    agentServer.closeConnections()
    server.close(function () {
      void disposeAll(exitCode)
    })
    server.closeIdleConnections?.()
    setTimeout(function () {
      server.closeAllConnections?.()
    }, 200).unref()
  }

  const app = createApp({
    token: config.token,
    status,
    onShutdown: function () {
      shutdown('admin')
    },
    // 包一层而不是直接传 `observability.metrics.snapshot`：后者脱离了 metrics 对象，
    // 传引用会触发 unbound-method
    metrics: function () {
      return observability.metrics.snapshot()
    },
    restartGoose: config.goosePathRoot
      ? function () {
          return supervisor.restart().then(function () {
            observability.metrics.inc('goose.restarts')
            // supervisor 自己也数，但那是「本进程内的重启次数」；指标要能跨重启累计
            return undefined
          })
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

  // server 已存在，异常现在可以走优雅关停
  fatalHandler = function (reason: string) {
    shutdown(reason, 1)
  }

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
