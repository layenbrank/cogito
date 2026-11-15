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
  /** 管理面之后挂 Agent Protocol 路由（skeinRouter 等） */
  mount?: (app: Express) => void
}

function sameSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
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
  app.use(express.json({ limit: '4mb' }))

  // 探活：免鉴权，但带身份标记（Rust 侧校验 service 字段 + pid 存活）
  app.get('/health', function (_req: Request, res: Response) {
    res.json(deps.status())
  })

  app.use(bearerAuth(deps.token))

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

export { SERVICE_NAME, bearerAuth, createApp, sameSecret }
export type { AgentdStatus, GooseState, ServerDeps }
