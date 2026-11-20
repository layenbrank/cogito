import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

/**
 * dev server 上的「墙面中继」：只在 `vite` 里存在，打包产物里没有这个端点。
 *
 * 为什么需要：右栏自载页没有 Tauri IPC（见 `src-tauri/src/browser/mod.rs` 的安全边界），
 * 磁贴又只在 SQLite 里。同源 localStorage 能覆盖「同一实例 + 同一 origin」，
 * 但开发时常见的是**另一个实例的面板打开 `http://localhost:8200`** ——
 * 跨 profile、跨 origin，localStorage 过不去，HTTP 可以。
 *
 * 中继**只搬运主窗发布的快照**（`src/features/window/preview-snapshot.ts` 的
 * `startPublishingMirrorWall`），自己不读库、不做任何数据加工：主窗发上来的是 store 里
 * 的正常逻辑产物（集合成员已剔除、`background` / `backdrop` 已由实体反序列化成对象）。
 * 直读 SQLite 拿到的是裸行，语义与主窗 IPC 读取不一致，自调试时会看到「另一面墙」，
 * 把预览产物误判成真 bug —— 预览只该复述主窗看到的东西。没有主窗在跑时就是空墙。
 *
 * 只认有内容的快照，空墙一律丢弃（旧版前端会把没初始化的 store 发上来）。
 * 只在内存里存，不落盘、不做鉴权 —— 端口本来就是本机 dev server，
 * 内容和「右栏能看到什么」同一级别。
 */
const ROUTE = '/__cogito/preview-wall'

/** 一份墙面快照的上限；正常几十 KB，超过多半是上游写错了 */
const MAX_BODY_BYTES = 2 * 1024 * 1024

function endWithNothing(res: ServerResponse, status: number): void {
  res.statusCode = status
  res.end()
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise(function (settle) {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', function (chunk: Buffer) {
      size += chunk.length
      if (size <= MAX_BODY_BYTES) chunks.push(chunk)
    })
    req.on('end', function () {
      if (size > MAX_BODY_BYTES) {
        settle(null)
        return
      }
      settle(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', function () {
      settle(null)
    })
  })
}

/** POST 上来的是空墙就不要（旧版前端会把没初始化的 store 发上来） */
function hasContent(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as { mirrors?: unknown; magneticTiles?: unknown }
    const mirrors = Array.isArray(parsed.mirrors) ? parsed.mirrors.length : 0
    const tiles = Array.isArray(parsed.magneticTiles) ? parsed.magneticTiles.length : 0
    return mirrors > 0 || tiles > 0
  } catch (error) {
    console.debug('[preview-wall] 快照不是合法 JSON，丢弃', error)
    return false
  }
}

function previewWallRelay(): Plugin {
  /** 主窗 POST 上来的最后一份快照（中继唯一的数据来源） */
  let wall: string | null = null

  return {
    name: 'cogito:preview-wall-relay',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(ROUTE, function (req, res) {
        // 页面可能来自另一个实例，但 origin 仍是这个 dev server；放开 CORS 只为
        // `localhost` 与 `127.0.0.1` 两种写法互认
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

        if (req.method === 'OPTIONS') {
          endWithNothing(res, 204)
          return
        }

        if (req.method === 'POST') {
          void readBody(req).then(function (body) {
            if (body === null) {
              endWithNothing(res, 413)
              return
            }
            if (body.length > 0 && hasContent(body)) wall = body
            endWithNothing(res, 204)
          })
          return
        }

        if (req.method !== 'GET') {
          endWithNothing(res, 405)
          return
        }

        if (!wall) {
          // 204 = 「还没有数据」（没有主窗发布过），客户端据此保持空墙、别当成解析失败
          endWithNothing(res, 204)
          return
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(wall)
      })
    }
  }
}

export { previewWallRelay, ROUTE as PREVIEW_WALL_ROUTE }
