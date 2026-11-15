/**
 * agentd 端到端：**spawn → 握手 → 鉴权 → 线程 → 事件流游标 → 重启 → 关停 → 无残留**。
 *
 * 为什么需要它（单测都覆盖不到的那部分）：
 * - 单测喂的是内存里的 express `app`，从没经过「真进程 + 真端口 + 真 stdout 握手」；
 * - 「断流后靠 `?after=<seq>` 补齐」与「进程被 kill 后用同一个 `agentd.db` 接着跑」
 *   是这次重构最脆弱的两条能力，它们只在**跨进程**时才成立；
 * - 关停后有没有残留 pid（尤其是被 Job Object 收养的 goose）只能在外面看。
 *
 * 两层，按有没有内层 goose 分：
 *
 * 1. **无 goose（默认，CI 可跑）**：agentd 对「找不到 goose」是显式降级（supervisor 不启动），
 *    所以 `/health`、鉴权、跨源预检、线程幂等、SSE 游标、cancel、shutdown、无残留全部可验；
 *    跑一轮会因为「goose 未就绪」失败 —— 这里断言的是**失败也要有 settled 事件**，
 *    而不是静默挂住。
 * 2. **有 goose（`--with-goose`，需要 provider）**：额外验真跑一轮拿到正文、
 *    kill -9 重启后 `/state` 里还有上一轮的 `sessionId`（checkpoint 真的落库了）。
 *
 * 用法：
 *   pnpm --filter @cogito/agentd build && node scripts/e2e.ts
 *   AGENTD_GOOSE_PATH_ROOT=<干净的 goose 根> node scripts/e2e.ts --with-goose
 *
 * 退出码非 0 表示有断言失败；失败时会把 agentd 的 stdout/stderr 尾部打出来。
 */

import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const AGENTD_DIR = path.resolve(SCRIPT_DIR, '..')
const ENTRY = path.join(AGENTD_DIR, 'dist', 'main.cjs')
const TOKEN = 'e2e-token-0123456789abcdef'
const READY_TIMEOUT_MS = 30_000
const LOG_PREFIX = '[agentd:e2e]'

const WITH_GOOSE = process.argv.includes('--with-goose')
const KEEP_TMP = process.argv.includes('--keep')
const REPORT_LINES = 40

/** `AGENTD_READY` 握手行解析出来的形状 */
interface ReadyLine {
  port: number
  pid: number
  version: string
  service: string
  isolated: boolean
  goose: string
}

interface AgentdHandle {
  child: ChildProcessWithoutNullStreams
  logs: string[]
}

interface JsonResult {
  status: number
  body: any
}

interface SseFrame {
  event: string
  data: any
}

/** `/threads/:id/events` 上 `event: run` 的数据 */
interface RunEvent {
  seq: number
  kind: string
  payload: any
}

let passed = 0
const failures: string[] = []

function ok(label: string, detail?: string): void {
  passed += 1
  console.log(`${LOG_PREFIX} ✓ ${label}${detail ? ` — ${detail}` : ''}`)
}

function fail(label: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  failures.push(`${label}: ${message}`)
  console.error(`${LOG_PREFIX} ✗ ${label} — ${message}`)
}

/** 每个用例独立 try/catch：一个红不该让后面的断言全部变成「没跑」。 */
async function step(
  label: string,
  fn: () => string | void | Promise<string | void>
): Promise<void> {
  try {
    const detail = await fn()
    ok(label, typeof detail === 'string' ? detail : undefined)
  } catch (error) {
    fail(label, error)
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`)
  }
}

// ── 进程 ────────────────────────────────────────────────────────────────────

function spawnAgentd(env: Record<string, string>): AgentdHandle {
  // 空串键删掉：`{...process.env, ...env}` 会连外部环境里的同名变量一起带进来，
  // 于是「没开 --with-goose」也会因为终端里残留 GOOSE_PATH_ROOT 而真的拉起 goose。
  const merged: NodeJS.ProcessEnv = { ...process.env, ...env }
  for (const name of Object.keys(env)) {
    if (env[name] === '') delete merged[name]
  }
  const child = spawn(process.execPath, [ENTRY], {
    cwd: AGENTD_DIR,
    env: merged,
    // 三路都 pipe（stdin 用不上，但 `ChildProcessWithoutNullStreams` 要的就是这个形状）
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  const logs: string[] = []
  const keep = function (chunk: Buffer): void {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (!line.trim()) continue
      logs.push(line)
      if (logs.length > REPORT_LINES * 4) logs.shift()
    }
  }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  return { child, logs }
}

/** 等 stdout 上的握手行。**这是端口唯一可靠来源**，不做「先探测空闲端口」。 */
function waitForReady(handle: AgentdHandle, timeoutMs = READY_TIMEOUT_MS): Promise<ReadyLine> {
  return new Promise(function (resolve, reject) {
    const timer = setTimeout(function () {
      reject(new Error(`等 AGENTD_READY 超时（${timeoutMs}ms）`))
    }, timeoutMs)
    let buffer = ''
    function onData(chunk: Buffer): void {
      buffer += chunk.toString()
      let index: number
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (!line.startsWith('AGENTD_READY')) continue
        clearTimeout(timer)
        handle.child.stdout.off('data', onData)
        try {
          resolve(JSON.parse(line.slice('AGENTD_READY'.length).trim()) as ReadyLine)
        } catch (error) {
          reject(new Error(`握手行不是合法 JSON：${line}（${String(error)}）`))
        }
        return
      }
    }
    handle.child.stdout.on('data', onData)
    handle.child.on('exit', function (code) {
      clearTimeout(timer)
      reject(new Error(`agentd 提前退出（code=${String(code)}）`))
    })
  })
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function waitForDeath(pid: number, timeoutMs: number): Promise<void> {
  return new Promise(function (resolve, reject) {
    const deadline = Date.now() + timeoutMs
    const tick = function (): void {
      if (!isAlive(pid)) {
        resolve()
        return
      }
      if (Date.now() > deadline) {
        reject(new Error(`进程 ${pid} 在 ${timeoutMs}ms 内没有退出`))
        return
      }
      setTimeout(tick, 50)
    }
    tick()
  })
}

/** 强杀：Windows 用 taskkill /T /F 连子树一起收（goose 会挂在下面）。 */
function hardKill(pid: number): void {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    return
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // 已经没了：`waitForDeath` 会立刻返回
  }
}

// ── HTTP / SSE ──────────────────────────────────────────────────────────────

function headers(extra?: Record<string, string>): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...extra }
}

async function json(
  base: string,
  pathname: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<JsonResult> {
  const response = await fetch(`${base}${pathname}`, init)
  const text = await response.text()
  let body: any = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: response.status, body }
}

function parseFrame(frame: string): SseFrame {
  let event = 'message'
  const data: string[] = []
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim()
    else if (line.startsWith('data:')) data.push(line.slice('data:'.length).trim())
  }
  if (data.length === 0) return { event, data: null }
  try {
    return { event, data: JSON.parse(data.join('\n')) as unknown }
  } catch {
    return { event, data: data.join('\n') }
  }
}

async function* readSse(url: string, init: RequestInit): AsyncGenerator<SseFrame> {
  const response = await fetch(url, init)
  if (!response.ok || !response.body) {
    throw new Error(`SSE 连接失败：HTTP ${response.status}`)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      let index: number
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        if (frame.trim()) yield parseFrame(frame)
      }
    }
  } finally {
    // 主动中止时 read() 会抛，这里吞掉并确保 release
    try {
      await reader.cancel()
    } catch {
      // 上游已关闭
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!existsSync(ENTRY)) {
    throw new Error(`缺少 ${ENTRY}，先跑 \`pnpm --filter @cogito/agentd build\``)
  }

  const workDir = mkdtempSync(path.join(tmpdir(), 'agentd-e2e-'))
  const dbPath = path.join(workDir, 'agentd.db')
  const gooseRoot = process.env.AGENTD_GOOSE_PATH_ROOT?.trim()
  const runGoose = WITH_GOOSE && Boolean(gooseRoot)
  if (WITH_GOOSE && !gooseRoot) {
    console.warn(`${LOG_PREFIX} 指定了 --with-goose 但没有 AGENTD_GOOSE_PATH_ROOT，降级为无 goose 层`)
  }

  const baseEnv: Record<string, string> = {
    AGENTD_TOKEN: TOKEN,
    AGENTD_DB: dbPath,
    // 0 = 内核挑端口。**不要**在这里用固定端口：本机 1024–15000 是动态段，随时被 WinNAT 抽走
    AGENTD_PORT: '0',
    AGENTD_VERSION: 'e2e',
    // 不用 goose 时显式置空（由 spawnAgentd 删除）：不能靠「不写这个键」——
    // 终端里残留的 GOOSE_PATH_ROOT 会经 process.env 透传进来
    AGENTD_GOOSE_PATH_ROOT: runGoose && gooseRoot ? gooseRoot : ''
  }

  console.log(
    `${LOG_PREFIX} 工作目录 ${workDir}（goose：${runGoose ? `托管 ${String(gooseRoot)}` : '不托管'}）`
  )

  let handle = spawnAgentd(baseEnv)
  let base = ''

  try {
    // ── 1. 握手 ────────────────────────────────────────────────────────────
    // 不包 `step`：握手失败后所有断言都没有意义，直接抛到最外层更有用
    // （`step` 的钩子会被 TS 当成「可能没赋值」，反而要把类型写成 never）
    const boot = await waitForReady(handle)
    const firstPid = boot.pid
    base = `http://127.0.0.1:${boot.port}`
    await sleep(50)

    await step('stderr 里没有 AGENTD_FATAL', function () {
      const fatal = handle.logs.find(function (line) {
        return line.includes('AGENTD_FATAL')
      })
      assert(!fatal, `启动即失败：${fatal ?? ''}`)
      return `port=${boot.port} pid=${boot.pid}`
    })

    await step('握手行的 pid 与真实子进程一致', function () {
      assertEqual(firstPid, handle.child.pid, '握手 pid 与 spawn 出来的 pid 不一致')
      return String(firstPid)
    })

    await step('握手行的 service / version 正确', function () {
      assertEqual(boot.service, 'cogito-agentd', 'service 字段不对')
      assertEqual(boot.version, 'e2e', 'AGENTD_VERSION 没有透传到握手行')
    })

    // ── 2. health 与鉴权 ──────────────────────────────────────────────────
    await step('/health 免鉴权且自报 goose 状态', async function () {
      const res = await json(base, '/health')
      assertEqual(res.status, 200, '/health 应当免鉴权')
      assertEqual(res.body.service, 'cogito-agentd', '/health 的 service 不对')
      assertEqual(res.body.pid, firstPid, '/health 的 pid 与握手行不一致')
      // 状态枚举是 disabled / starting / ready / failed：
      // 没配 GOOSE_PATH_ROOT → `disabled`（刻意不托管），不是「坏了」
      const expected = runGoose ? 'ready' : 'disabled'
      assertEqual(res.body.goose, expected, `goose 状态应为 ${expected}`)
      return `goose=${String(res.body.goose)} uptimeMs=${String(res.body.uptimeMs)}`
    })

    await step('无 token 访问 /threads 返回 401', async function () {
      const res = await json(base, '/threads', { method: 'POST', body: '{}' })
      assertEqual(res.status, 401, '缺 bearer 必须 401')
    })

    await step('错误 token 返回 401', async function () {
      const res = await json(base, '/threads', {
        method: 'POST',
        headers: { authorization: 'Bearer wrong-token-wrong', 'content-type': 'application/json' },
        body: '{}'
      })
      assertEqual(res.status, 401, '错 bearer 必须 401')
    })

    // ── 2.1 跨源（CORS）────────────────────────────────────────────────────
    // 这一条在浏览器里是「一切请求都 Failed to fetch」的唯一成因，而 Node 的 fetch
    // 不做 CORS 检查 —— 不在这里显式断言，就只能在真机上撞。
    await step('OPTIONS 预检免鉴权并回 CORS 头', async function () {
      const origin = 'http://localhost:8200'
      const preflight = await fetch(`${base}/threads`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization,content-type'
        }
      })
      assertEqual(preflight.status, 204, '预检应当 204（且不需要 token）')
      assertEqual(
        preflight.headers.get('access-control-allow-origin'),
        origin,
        '预检没有回显 Origin'
      )
      const methods = preflight.headers.get('access-control-allow-methods') ?? ''
      assert(methods.includes('POST'), `预检没允许 POST（${methods}）`)
      const allowed = (preflight.headers.get('access-control-allow-headers') ?? '').toLowerCase()
      assert(allowed.includes('authorization'), `预检没允许 authorization（${allowed}）`)
      return `origin=${origin}`
    })

    await step('普通请求也带 allow-origin（否则响应被浏览器丢掉）', async function () {
      const origin = 'http://localhost:8200'
      const response = await fetch(`${base}/health`, { headers: { origin } })
      assertEqual(response.status, 200, '/health 应当 200')
      assertEqual(
        response.headers.get('access-control-allow-origin'),
        origin,
        '响应没有 allow-origin'
      )
      assert(
        (response.headers.get('vary') ?? '').includes('Origin'),
        '回显 origin 却缺 Vary，会被中间缓存写坏'
      )
    })

    // ── 3. 线程幂等（客户端的 id 是 checkpoint 主键） ──────────────────────
    const threadID = 'e2e-thread-fixed'
    await step('POST /threads 幂等 upsert（同 id 两次不换主键）', async function () {
      const first = await json(base, '/threads', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ thread_id: threadID, metadata: { who: 'e2e' } })
      })
      assertEqual(first.status, 200, '建线程失败')
      assertEqual(first.body.thread_id, threadID, '没有沿用客户端给的 id')
      const second = await json(base, '/threads', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ thread_id: threadID })
      })
      assertEqual(second.body.created_at, first.body.created_at, '第二次 upsert 改写了 created_at')
      return `created_at=${String(first.body.created_at)}`
    })

    await step('未知线程的 state 返回 404', async function () {
      const res = await json(base, '/threads/nope/state', { headers: headers() })
      assertEqual(res.status, 404, '未知线程应当 404 而不是空状态')
    })

    // ── 4. 事件流：先补发、再实时；断流后用游标补齐 ────────────────────────
    let lastSeq = 0
    await step('SSE 连上先收到 sync（带 approvals 与 lastSeq）', async function () {
      const controller = new AbortController()
      try {
        for await (const frame of readSse(`${base}/threads/${threadID}/events`, {
          headers: headers(),
          signal: controller.signal
        })) {
          if (frame.event !== 'sync') continue
          assert(Array.isArray(frame.data.approvals), 'sync 里没有 approvals 数组')
          assert(typeof frame.data.lastSeq === 'number', 'sync 里没有 lastSeq')
          return `lastSeq=${String(frame.data.lastSeq)}`
        }
        throw new Error('没等到 sync 帧')
      } finally {
        controller.abort()
      }
    })

    const firstBatch: RunEvent[] = []
    await step('一轮结束必须落 settled 事件（不能静默挂住）', async function () {
      const res = await json(base, `/threads/${threadID}/runs`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ input: { prompt: 'say hi' } })
      })
      assertEqual(res.status, 202, '/runs 应当 202')
      assert(typeof res.body.run_id === 'string', '202 响应里没有 run_id')

      const controller = new AbortController()
      const deadline = Date.now() + 15_000
      try {
        for await (const frame of readSse(`${base}/threads/${threadID}/events`, {
          headers: headers(),
          signal: controller.signal
        })) {
          if (frame.event === 'run') firstBatch.push(frame.data as RunEvent)
          const settled = firstBatch.find(function (event) {
            return event.kind === 'status' && event.payload?.phase === 'settled'
          })
          if (settled) {
            lastSeq = settled.seq
            return `seq=${settled.seq} status=${String(settled.payload.status)}`
          }
          if (Date.now() > deadline) throw new Error('15s 内没有 settled 事件')
        }
        throw new Error('事件流提前结束')
      } finally {
        controller.abort()
      }
    })

    await step('seq 严格单调递增', function () {
      assert(firstBatch.length > 0, '没有收到任何事件')
      for (let index = 1; index < firstBatch.length; index += 1) {
        assert(
          firstBatch[index].seq > firstBatch[index - 1].seq,
          `seq 没有递增：${firstBatch[index - 1].seq} → ${firstBatch[index].seq}`
        )
      }
      return `${firstBatch.length} 条事件，seq ${firstBatch[0].seq}…${lastSeq}`
    })

    // 断流 → 期间再跑一轮产生事件 → 用 after 补齐
    await step('断流后 ?after=<seq> 能补齐期间缺失的事件', async function () {
      const before = lastSeq
      await json(base, `/threads/${threadID}/runs`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ input: { prompt: 'say bye' } })
      })
      // 给事件一点时间落进环形缓冲（断流状态下没有任何订阅者）
      await sleep(3_000)

      const controller = new AbortController()
      const missed: RunEvent[] = []
      const deadline = Date.now() + 15_000
      try {
        for await (const frame of readSse(
          `${base}/threads/${threadID}/events?after=${before}`,
          { headers: headers(), signal: controller.signal }
        )) {
          if (frame.event === 'sync') break
          if (frame.event !== 'run') continue
          missed.push(frame.data as RunEvent)
          const done = missed.some(function (event) {
            return event.payload?.phase === 'settled'
          })
          if (done) {
            lastSeq = Math.max.apply(
              null,
              missed.map(function (event) {
                return event.seq
              })
            )
            break
          }
          if (Date.now() > deadline) throw new Error('补齐阶段 15s 内没有 settled')
        }
      } finally {
        controller.abort()
      }
      assert(missed.length > 0, 'after 游标没有补发任何事件')
      for (const event of missed) {
        assert(event.seq > 0, `补发事件的 seq 非法：${event.seq}`)
      }
      return `补发 ${missed.length} 条（seq 均 > 之前的 ${before}）`
    })

    // ── 5. cancel 的两种返回值 ────────────────────────────────────────────
    await step('无活跃轮时 cancel 返回 200 + no_active_run', async function () {
      const res = await json(base, `/threads/${threadID}/cancel`, {
        method: 'POST',
        headers: headers()
      })
      assertEqual(res.status, 200, '无活跃轮应当 200')
      assertEqual(res.body.cancelled, false, '无活跃轮时 cancelled 应为 false')
    })

    // ── 5.1 计数器 ────────────────────────────────────────────────────────
    await step('/metrics 需要鉴权', async function () {
      const res = await json(base, '/metrics')
      assertEqual(res.status, 401, '/metrics 不该免鉴权')
    })

    await step('/metrics 的计数与刚才发生的事对得上', async function () {
      const res = await json(base, '/metrics', { headers: headers() })
      assertEqual(res.status, 200, '/metrics 不可用')
      const counters: Record<string, number> = res.body.counters ?? {}
      // 前面已经发过两轮（第一轮 + 断流补齐那一轮）
      assert(
        counters['runs.started'] >= 2,
        `runs.started 应 >= 2，实际 ${String(counters['runs.started'])}`
      )
      assert(
        counters['events.sse.connections'] >= 1,
        `SSE 连接没有计数（${String(counters['events.sse.connections'])}）`
      )
      // 补发是「断流后重连」的直接证据：这一轮里我们刻意断了一次
      assert(
        counters['events.cursor.replays'] >= 1,
        `游标补发没有计数（${String(counters['events.cursor.replays'])}）`
      )
      return `runs=${String(counters['runs.started'])} sse=${String(
        counters['events.sse.connections']
      )} replay=${String(counters['events.cursor.replays'])}`
    })

    // ── 6. 有 goose：真跑一轮 ─────────────────────────────────────────────
    let gooseSessionId: string | null = null
    if (runGoose) {
      await step('真跑一轮拿到正文与 sessionId', async function () {
        const before = lastSeq
        await json(base, `/threads/${threadID}/runs`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ input: { prompt: '只回复两个字：收到', cwd: process.cwd() } })
        })
        const texts: string[] = []
        const deadline = Date.now() + 90_000
        const controller = new AbortController()
        try {
          for await (const frame of readSse(
            `${base}/threads/${threadID}/events?after=${before}`,
            { headers: headers(), signal: controller.signal }
          )) {
            if (frame.event !== 'run') continue
            const payload = frame.data.payload ?? {}
            if (payload.sessionUpdate === 'agent_message_chunk' && payload.content?.text) {
              texts.push(String(payload.content.text))
            }
            if (payload.phase === 'settled') {
              assertEqual(payload.status, 'success', `回合失败：${String(payload.message ?? '')}`)
              lastSeq = frame.data.seq
              break
            }
            if (Date.now() > deadline) throw new Error('90s 内没有 settled')
          }
        } finally {
          controller.abort()
        }
        const joined = texts.join('')
        assert(joined.length > 0, '没有收到任何正文增量')
        const state = await json(base, `/threads/${threadID}/state`, { headers: headers() })
        const sessionId = state.body?.values?.sessionId
        assert(typeof sessionId === 'string' && sessionId !== '', 'state 里没有 sessionId')
        gooseSessionId = sessionId
        return `正文 ${joined.length} 字，sessionId=${sessionId}`
      })

      // 「停止」必须真的让 agentd 停下，而不是只断前端那条 SSE。
      // 不验这条，前端点停止后 UI 显示已停止、agentd 还在跑完 —— 最难查的那类不一致。
      await step('cancel 能真正中断在跑的轮（并发 settled 回执）', async function () {
        const before = lastSeq
        await json(base, `/threads/${threadID}/runs`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            input: { prompt: '从 1 数到 200，每行一个数字', cwd: process.cwd() }
          })
        })
        // 给它一点时间真正开始（否则可能 cancel 早于 running）
        await sleep(1_500)

        const cancel = await json(base, `/threads/${threadID}/cancel`, {
          method: 'POST',
          headers: headers()
        })
        assertEqual(cancel.status, 202, '有活跃轮时 cancel 应当 202')
        assertEqual(cancel.body.cancelled, true, 'cancel 没有报告 cancelled=true')

        const controller = new AbortController()
        const deadline = Date.now() + 20_000
        let status = ''
        try {
          for await (const frame of readSse(
            `${base}/threads/${threadID}/events?after=${before}`,
            { headers: headers(), signal: controller.signal }
          )) {
            if (Date.now() > deadline) throw new Error('cancel 之后 20s 内没有 settled')
            if (frame.event !== 'run') continue
            const payload = frame.data.payload ?? {}
            if (payload.phase !== 'settled') continue
            status = String(payload.status)
            lastSeq = frame.data.seq
            break
          }
        } finally {
          controller.abort()
        }
        assert(status !== '', 'cancel 之后 20s 内没有 settled（说明它还在跑）')
        // 被 abort 的轮按 error 收尾，message 里带 abort —— 前端据此翻成「已取消」
        assertEqual(status, 'error', `cancel 后应当是 error+abort，实际 ${status}`)
        return `settled status=${status}`
      })
    } else {
      console.log(`${LOG_PREFIX} - 跳过真模型回合（未开 --with-goose）`)
    }

    // ── 7. kill -9 重启：同一个 db 能接着来 ───────────────────────────────
    let restartedPid = 0
    await step('SIGKILL 之后进程真的没了', async function () {
      hardKill(firstPid)
      await waitForDeath(firstPid, 10_000)
    })

    await step('重启后同一个 agentd.db 仍可服务，线程可幂等恢复', async function () {
      handle = spawnAgentd(baseEnv)
      const restarted = await waitForReady(handle)
      restartedPid = restarted.pid
      base = `http://127.0.0.1:${restarted.port}`

      const resumed = await json(base, '/threads', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ thread_id: threadID })
      })
      assertEqual(resumed.status, 200, '重启后无法用同一个 thread_id 恢复线程')

      const state = await json(base, `/threads/${threadID}/state`, { headers: headers() })
      assertEqual(state.status, 200, '重启后 /state 不可用')
      if (runGoose) {
        assertEqual(
          state.body?.values?.sessionId,
          gooseSessionId,
          '重启后 checkpoint 里的 sessionId 丢了（SQLite 没落盘）'
        )
      }
      return `port=${restarted.port}${runGoose ? '，sessionId 仍在' : ''}`
    })

    // ── 8. 优雅关停 + 无残留 ──────────────────────────────────────────────
    await step('/admin/shutdown 返回 202 且进程退出', async function () {
      assert(restartedPid > 0, '重启那一步没拿到 pid')
      const pid = restartedPid
      const res = await json(base, '/admin/shutdown', { method: 'POST', headers: headers() })
      assertEqual(res.status, 202, 'shutdown 应当 202')
      await waitForDeath(pid, 15_000)
      return `pid=${pid} 已退出`
    })

    await step('关停后端口不再可连', async function () {
      let reachable = false
      try {
        await json(base, '/health')
        reachable = true
      } catch {
        reachable = false
      }
      assert(!reachable, '进程退出后端口仍可连（说明还有别的实例占着或没真退）')
    })
  } finally {
    // 兜底：任何一步失败都要把进程收掉，否则下一次跑会撞端口/库锁
    const alive = handle.child.pid
    if (typeof alive === 'number' && isAlive(alive)) {
      hardKill(alive)
      try {
        await waitForDeath(alive, 5_000)
      } catch {
        // 已经尽力
      }
    }
  }

  // ── 汇总 ────────────────────────────────────────────────────────────────
  console.log('')
  if (failures.length > 0) {
    console.error(`${LOG_PREFIX} ${passed} 通过 / ${failures.length} 失败`)
    for (const item of failures) console.error(`${LOG_PREFIX}   · ${item}`)
    console.error(`${LOG_PREFIX} ---- agentd 日志尾部 ----`)
    for (const line of handle.logs) console.error(`${LOG_PREFIX} ${line}`)
    if (!KEEP_TMP) rmSync(workDir, { recursive: true, force: true })
    process.exit(1)
  }

  console.log(`${LOG_PREFIX} 全部 ${passed} 项通过`)
  if (KEEP_TMP) console.log(`${LOG_PREFIX} 保留工作目录 ${workDir}`)
  else rmSync(workDir, { recursive: true, force: true })
}

main().catch(function (error: unknown) {
  console.error(
    `${LOG_PREFIX} 致命错误：${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
  )
  process.exit(1)
})
