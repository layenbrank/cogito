/**
 * `session/load` 重放探针：goose 的「历史重放」到底给什么。
 *
 * 为什么需要它：事件日志缺段（`sync.truncated`）后要重建正文与工具卡，唯一正确的来源是
 * goose 自己的会话历史。但重放能不能用来**合并**，取决于三个事实，猜不出来只能实测：
 *
 *  1. 重放的 `session/update` 是否带 `messageId`（客户端要按它把内容并进已有消息）
 *  2. 是否包含工具调用与**工具结果**（否则只能补正文，卡片补不了）
 *  3. 通知与 response 谁先到（决定客户端什么时候算「补完」）
 *
 * 2026-11-23 实测（goose 1.48.0）：
 *  - `initialize` 报 `loadSession=true`，`sessionCapabilities={list,delete,close}`（**无 resume**）；
 *  - `messageId` 跨重放**稳定**（与实时流一致），工具 `toolCallId` 也一致；
 *  - 工具调用 + `tool_call_update`（含 completed 结果）都会重放；
 *  - 粒度是**按消息聚合**：实时 373 条 chunk → 重放 22 条（每条消息一段完整文本）；
 *  - 重放通知在 `session/load` 的 response **之前**到齐。
 *
 * 用法（PowerShell）：
 *   $env:GOOSE_PATH_ROOT="$env:APPDATA\com.cogito.client\goose"
 *   node --experimental-strip-types apps\agentd\scripts\probe-replay.ts
 *   node --experimental-strip-types apps\agentd\scripts\probe-replay.ts --tools
 *
 * 需要本机已装 goose 且 `GOOSE_PATH_ROOT` 指向一份可用的 provider 配置（会用真模型跑一轮）。
 */

import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface SessionUpdate {
  sessionUpdate?: string
  messageId?: string
  toolCallId?: string
  title?: string
  status?: string
  content?: unknown
}

interface InitializeResult {
  protocolVersion?: number
  agentCapabilities?: {
    loadSession?: boolean
    sessionCapabilities?: Record<string, unknown>
  }
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
  method: string
}

interface Stats {
  count: number
  ids: string[]
  noId: number
  kinds: string
  completedTools: number
}

const BINARY = process.env.GOOSE_BINARY ?? 'goose'
const withTools = process.argv.includes('--tools')
const cwd = mkdtempSync(join(tmpdir(), 'acp-replay-'))
const pathRoot = process.env.GOOSE_PATH_ROOT

if (!pathRoot) {
  console.error('缺少 GOOSE_PATH_ROOT（应指向一份可用的 goose 配置根）')
  process.exit(2)
}

const child = spawn(BINARY, ['acp', '--with-builtin', 'developer'], {
  cwd,
  env: { ...process.env, GOOSE_PATH_ROOT: pathRoot },
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe']
})

let nextId = 1
const pending = new Map<number, Pending>()
/** 阶段：第一轮实时（live）/ `session/load` 重放（replay） */
let phase: 'live' | 'replay' = 'live'
const captured: { live: SessionUpdate[]; replay: SessionUpdate[] } = { live: [], replay: [] }

function send(payload: unknown): void {
  child.stdin.write(`${JSON.stringify(payload)}\n`)
}

function request(method: string, params: unknown, timeoutMs = 120_000): Promise<unknown> {
  const id = nextId++
  return new Promise(function (resolve, reject) {
    const timer = setTimeout(function () {
      pending.delete(id)
      reject(new Error(`ACP ${method} 超时`))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer, method })
    send({ jsonrpc: '2.0', id, method, params })
  })
}

function textOf(update: SessionUpdate): string {
  const content = update.content as { type?: string; text?: string } | undefined
  if (content?.type === 'text' && typeof content.text === 'string') return content.text
  return JSON.stringify(update.content ?? null)
}

function summarize(update: SessionUpdate): string {
  const kind = String(update.sessionUpdate ?? '?')
  const parts = [kind, typeof update.messageId === 'string' ? `messageId=${update.messageId}` : 'messageId=<none>']
  if (kind.endsWith('_chunk')) parts.push(`text=${JSON.stringify(textOf(update)).slice(0, 80)}`)
  if (kind === 'tool_call') parts.push(`toolCallId=${update.toolCallId} title=${JSON.stringify(update.title ?? '').slice(0, 40)}`)
  if (kind === 'tool_call_update') {
    parts.push(
      `toolCallId=${update.toolCallId} status=${update.status ?? '-'} content=${JSON.stringify(update.content ?? null).slice(0, 120)}`
    )
  }
  return parts.join(' | ')
}

/** 反向请求（审批 / 追问）：探针只要求流程走得下去，一律放行一次 / decline */
function answerIncoming(id: number, method: string, params: unknown): void {
  if (method === 'session/request_permission') {
    const record = (typeof params === 'object' && params !== null ? params : {}) as {
      options?: Array<{ optionId?: string; kind?: string }>
    }
    const allow = (record.options ?? []).find(function (option) {
      return option.kind === 'allow_once'
    })
    console.log(`[反向请求] 审批 → ${allow ? 'allow_once' : 'cancelled'}`)
    send({
      jsonrpc: '2.0',
      id,
      result: allow
        ? { outcome: { outcome: 'selected', optionId: allow.optionId } }
        : { outcome: { outcome: 'cancelled' } }
    })
    return
  }
  send({ jsonrpc: '2.0', id, result: { action: 'decline' } })
}

function handleLine(line: string): void {
  if (!line) return
  let message: {
    id?: number
    method?: string
    params?: { update?: SessionUpdate }
    result?: unknown
    error?: { code: number; message: string }
  }
  try {
    message = JSON.parse(line) as typeof message
  } catch {
    return
  }

  // 反向请求：`method` + `id`
  if (typeof message.method === 'string' && typeof message.id === 'number') {
    answerIncoming(message.id, message.method, message.params)
    return
  }
  if (message.method === 'session/update') {
    const update = message.params?.update ?? {}
    captured[phase].push(update)
    console.log(`[${phase}] ${summarize(update)}`)
    return
  }

  if (typeof message.id !== 'number') return
  const waiter = pending.get(message.id)
  if (!waiter) return
  pending.delete(message.id)
  clearTimeout(waiter.timer)
  if (message.error) {
    waiter.reject(new Error(`ACP ${waiter.method} ${message.error.code}: ${message.error.message}`))
    return
  }
  waiter.resolve(message.result)
}

let buffer = ''
child.stdout.setEncoding('utf8')
child.stdout.on('data', function (chunk: string) {
  buffer += chunk
  let index = buffer.indexOf('\n')
  while (index >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    index = buffer.indexOf('\n')
    handleLine(line)
  }
})

child.stderr.setEncoding('utf8')
child.stderr.on('data', function (chunk: string) {
  const text = String(chunk).trim()
  if (text) console.log(`[stderr] ${text.slice(0, 200)}`)
})

function stats(list: readonly SessionUpdate[], label: string): Stats {
  const ids = new Set<string>()
  const kinds = new Map<string, number>()
  let noId = 0
  let completedTools = 0
  for (const update of list) {
    const kind = String(update.sessionUpdate ?? '?')
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
    if (typeof update.messageId === 'string') ids.add(update.messageId)
    else noId += 1
    if (kind === 'tool_call_update' && update.status === 'completed') completedTools += 1
  }
  console.log(`\n== ${label} ==`)
  console.log(`条数=${list.length}，messageId 去重=${ids.size}，无 messageId=${noId}，工具结果 completed=${completedTools}`)
  console.log(
    `类型分布=${[...kinds]
      .map(function (entry) {
        return `${entry[0]}x${entry[1]}`
      })
      .join(', ')}`
  )
  return { count: list.length, ids: [...ids], noId, kinds: `${kinds.size} 类`, completedTools }
}

async function main(): Promise<void> {
  const init = (await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
    clientInfo: { name: 'cogito-probe-replay', version: '0.0.0' }
  })) as InitializeResult
  console.log(
    `[init] protocolVersion=${init.protocolVersion} loadSession=${init.agentCapabilities?.loadSession} ` +
      `sessionCapabilities=${JSON.stringify(init.agentCapabilities?.sessionCapabilities ?? {})}`
  )

  const created = (await request('session/new', { cwd, mcpServers: [] })) as { sessionId: string }
  const sessionId = created.sessionId
  console.log(`[new] sessionId=${sessionId} cwd=${cwd}`)

  const prompt = withTools
    ? `Create a file named probe.txt in this directory with the exact content "ok", then reply done. cwd=${cwd}`
    : 'Reply with exactly: pong'
  const started = Date.now()
  const result = (await request(
    'session/prompt',
    { sessionId, prompt: [{ type: 'text', text: prompt }] },
    10 * 60_000
  )) as { stopReason?: string }
  console.log(`[prompt] 用时=${Date.now() - started}ms stopReason=${result?.stopReason ?? '?'}`)

  phase = 'replay'
  const loadStarted = Date.now()
  await request('session/load', { sessionId, cwd, mcpServers: [] })
  console.log(`[load] 用时=${Date.now() - loadStarted}ms`)

  const live = stats(captured.live, '第一轮实时（live）')
  const replay = stats(captured.replay, 'session/load 重放（replay）')
  const sameIds = replay.ids.every(function (id) {
    return id.startsWith('msg_') || live.ids.includes(id)
  })
  console.log('\n结论：')
  console.log(`- 重放 messageId 是否都能对上实时（或为用户消息）：${sameIds ? '是' : '否'}`)
  console.log(`- 重放是否含工具结果：${replay.completedTools} 条（实时 ${live.completedTools} 条）`)
  console.log(`- 粒度：重放 ${replay.count} 条 vs 实时 ${live.count} 条（按消息聚合则为前者明显更少）`)
}

await main()
child.kill()
