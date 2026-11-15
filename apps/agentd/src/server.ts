/**
 * HTTP 面：**自有 Express + （后续）`skeinRouter`**，不用 skein 的 `createExpressServer`。
 *
 * why：`createExpressServer` 只挂 Agent Protocol，没有 `/health`、没有鉴权，
 * CORS 也受 `langgraph.json` 约束；而我们需要
 * `/health`（Tauri 认领进程用）、bearer 鉴权、`/admin/*` 管理面与精确 CORS。
 *
 * 约定：
 * - `/health` **免鉴权**（Tauri 在拿到 token 之前就要探活），但必须回 `service: cogito-agentd`，
 *   Rust 端以此为身份校验，避免连到恰好占用同端口的别的服务。
 * - 其余端点一律 `Authorization: Bearer <token>`，比较用常量时间。
 */

import { timingSafeEqual } from 'node:crypto'

import express from 'express'
import type { Express, NextFunction, Request, Response } from 'express'

const SERVICE_NAME = 'cogito-agentd'

type GooseState = 'disabled' | 'starting' | 'ready' | 'failed'

interface AgentdStatus {
  service: typeof SERVICE_NAME
  version: string
  uptimeMs: number
  pid: number
  graphs: readonly string[]
  goose: GooseState
  restarts: number
}

interface ServerDeps {
  token: string
  status: () => AgentdStatus
  onShutdown: () => void
  /** 重启内层 goose（`/admin/goose/restart`）；未托管 goose 时不挂该路由 */
  restartGoose?: () => Promise<void>
  /** 计数器快照（`GET /metrics`）；为 null 时不挂该路由 */
  metrics?: () => unknown
  /** 管理面之后挂 Agent Protocol 路由（skeinRouter 等） */
  mount?: (app: Express) => void
}

function sameSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * 跳源（CORS）。**没有这一层，浏览器里所有请求都是 `TypeError: Failed to fetch`。**
 *
 * 坑在：前端页面是 `http://localhost:<vite 端口>`，agentd 在 `http://127.0.0.1:<内核端口>` ——
 * `localhost` 与 `127.0.0.1` 是**不同 origin**；再加上带 `Authorization` 属于非简单请求，
 * 浏览器会先发一个**不带 token** 的 `OPTIONS` 预检。预检如果落到 `bearerAuth` 上就是 401，
 * 浏览器直接判为跳源失败，前端只看到一句 `Failed to fetch`。
 *
 * 更阴的是：**Node 侧的单测与 e2e 都复现不出来** —— Node 的 `fetch` 不做 CORS 检查。
 * 所以 e2e 里必须显式断言预检的响应头（见 `scripts/e2e.mjs`）。
 *
 * 回显 `Origin` 而不是写死名单：agentd 的端口是内核挑的，dev 的 vite 端口也不固定，
 * 再加上 Tauri 生产环境的 origin 是 `tauri://localhost` / `http://tauri.localhost`。
 * 安全性靠 bearer：任何网页都能发请求，但没有 token 就是 401。
 */
function cors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.get('origin')
  if (origin) {
    res.setHeader('access-control-allow-origin', origin)
    // 回显 origin 后必须声明 Vary，否则中间缓存会把一个源的响应给另一个源
    res.setHeader('vary', 'Origin')
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS')
    // 回显预检要的 header：`authorization` 与 `content-type` 都靠它放行
    res.setHeader(
      'access-control-allow-headers',
      req.get('access-control-request-headers') ?? 'authorization, content-type'
    )
    res.setHeader('access-control-max-age', '600')
    // Chrome 的 Private Network Access：`localhost` → `127.0.0.1` 目前不触发，
    // 但一旦前端从 https 页或公网段访问就会要这个头，提前回上省一次排查
    if (req.get('access-control-request-private-network') === 'true') {
      res.setHeader('access-control-allow-private-network', 'true')
    }
    // 预检不带 Authorization，必须在这里就地结束
    res.status(204).end()
    return
  }

  next()
}

function bearerAuth(token: string) {
  const expected = `Bearer ${token}`
  return function (req: Request, res: Response, next: NextFunction): void {
    const header = req.get('authorization') ?? ''
    if (!sameSecret(header, expected)) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    next()
  }
}

function createApp(deps: ServerDeps): Express {
  const app = express()
  app.disable('x-powered-by')
  // CORS 必须在鉴权**之前**：预检请求不带 token
  app.use(cors)
  app.use(express.json({ limit: '4mb' }))

  // 探活：免鉴权，但带身份标记（Rust 侧校验 service 字段 + pid 存活）
  app.get('/health', function (_req: Request, res: Response) {
    res.json(deps.status())
  })

  app.use(bearerAuth(deps.token))

  // 计数快照：形状故意是扁平 JSON（`{counters:{…},lastAt:{…},uptimeMs}`），
  // 不做 Prometheus 文本一一 agentd 是单进程侧车，读它的只有本机的诊断页与 e2e。
  if (deps.metrics) {
    const metrics = deps.metrics
    app.get('/metrics', function (_req: Request, res: Response) {
      res.json(metrics())
    })
  }

  app.post('/admin/shutdown', function (_req: Request, res: Response) {
    res.status(202).json({ ok: true })
    // 先回包再退，避免客户端看到连接被重置
    setImmediate(deps.onShutdown)
  })

  if (deps.restartGoose) {
    const restartGoose = deps.restartGoose
    app.post('/admin/goose/restart', function (_req: Request, res: Response) {
      restartGoose().then(
        function () {
          res.status(202).json({ ok: true })
        },
        function (error: unknown) {
          res.status(500).json({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      )
    })
  }

  // Agent Protocol（skeinRouter）必须在鉴权之后、404 之前
  deps.mount?.(app)

  app.use(function (_req: Request, res: Response) {
    res.status(404).json({ error: 'not_found' })
  })

  return app
}

export { SERVICE_NAME, bearerAuth, cors, createApp, sameSecret }
export type { AgentdStatus, GooseState, ServerDeps }
