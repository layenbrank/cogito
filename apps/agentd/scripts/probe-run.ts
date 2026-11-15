/**
 * agentd 真机探针：跑一轮真实 goose 对话，可选自动放行工具审批。
 *
 * 为什么需要它：会话层与审批闸门最难的是时序（prompt 挂起 → 审批 → 继续），
 * 单测只能盖住「零件」，盖不住「串起来对不对」。这个脚本用真 goose + 真模型跑一遍，
 * 把事件流原样打出来，出问题时一眼能看出断在哪一步。
 *
 * 用法（先按 README 起一个 agentd，再）：
 *
 *   AGENTD_BASE=http://127.0.0.1:<port> AGENTD_TOKEN=<token> \
 *     node scripts/probe-run.ts --prompt "Reply with exactly: hello"
 *
 *   # 触发并自动放行工具审批（会真的执行工具）
 *   node scripts/probe-run.ts --approve --mode smart_approve \
 *     --prompt "Create a file /tmp/probe.txt containing ok"
 *
 * 注意：审批能不能触发取决于 goose 的 `permission.yaml`。若 `user.always_allow`
 * 里已经包含该工具，goose 会直接放行、**不会**发审批请求。
 */

interface PermissionOption {
  optionId: string
  kind: string
}

interface ApprovalPayload {
  requestId: string
  toolCall: unknown
  options?: PermissionOption[]
}

interface RunEvent {
  seq: number
  kind: string
  payload: any
}

const base = process.env.AGENTD_BASE
const token = process.env.AGENTD_TOKEN
if (!base || !token) {
  console.error('需要 AGENTD_BASE 与 AGENTD_TOKEN')
  process.exit(2)
}

function readArg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  if (index < 0) return fallback
  const value = process.argv[index + 1]
  return value === undefined || value.startsWith('--') ? fallback : value
}

const prompt = readArg('prompt', 'Reply with exactly: hello from agentd')
const mode = readArg('mode', 'auto')
const cwd = readArg('cwd', process.cwd().replace(/\\/g, '/'))
const autoApprove = process.argv.includes('--approve')
const timeoutMs = Number(readArg('timeout', '120000'))

const headers: Record<string, string> = {
  authorization: `Bearer ${token}`,
  'content-type': 'application/json'
}

function log(line: string): void {
  console.log(line)
}

const created = (await (
  await fetch(`${base}/threads`, { method: 'POST', headers, body: '{}' })
).json()) as { thread_id: string }
const thread = created.thread_id
log(`thread=${thread}`)

const sse = await fetch(`${base}/threads/${thread}/events`, { headers })
if (!sse.ok || !sse.body) {
  console.error(`事件流不可用：${sse.status}`)
  process.exit(1)
}

const runResponse = await fetch(`${base}/threads/${thread}/runs`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ input: { prompt, cwd, mode } })
})
log(`run=${runResponse.status} ${await runResponse.text()}`)

const reader = sse.body.getReader()
const decoder = new TextDecoder()
let buffer = ''
let settled = false
let approvals = 0
const deadline = Date.now() + timeoutMs

function handleApproval(approval: ApprovalPayload): void {
  approvals += 1
  const options = approval.options ?? []
  log(`APPROVAL toolCall=${JSON.stringify(approval.toolCall).slice(0, 200)}`)
  log(
    `APPROVAL options=${options
      .map(function (option) {
        return `${option.kind}:${option.optionId}`
      })
      .join(',')}`
  )
  if (!autoApprove) {
    log('APPROVAL 未带 --approve，保持挂起（可另行 POST /threads/:id/approvals/:requestId）')
    return
  }
  const allow = options.find(function (option) {
    return option.kind === 'allow_once'
  }) ?? options[0]
  if (!allow) {
    log('APPROVAL 没有任何可选 option，跳过')
    return
  }
  void fetch(`${base}/threads/${thread}/approvals/${approval.requestId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ optionId: allow.optionId })
  }).then(function (response) {
    log(`REPLY ${response.status} ${allow.optionId}`)
  })
}

function handleFrame(frame: string): void {
  const eventMatch = /^event: (.+)$/m.exec(frame)
  const dataMatch = /^data: (.+)$/m.exec(frame)
  if (!eventMatch || !dataMatch) return
  let data: RunEvent
  try {
    data = JSON.parse(dataMatch[1]) as RunEvent
  } catch {
    return
  }
  if (eventMatch[1] === 'sync') {
    const sync = data as unknown as { approvals?: unknown[]; lastSeq: number }
    log(`sync approvals=${sync.approvals?.length ?? 0} lastSeq=${sync.lastSeq}`)
    return
  }
  if (data.kind === 'approval') {
    handleApproval(data.payload.approval as ApprovalPayload)
    return
  }
  if (data.kind === 'update') {
    const name = data.payload.sessionUpdate
    if (name === 'agent_message_chunk' && data.payload.content?.type === 'text') {
      process.stdout.write(String(data.payload.content.text))
      return
    }
    if (name === 'tool_call' || name === 'tool_call_update') {
      log(`\nTOOL ${name} ${JSON.stringify(data.payload).slice(0, 300)}`)
    }
    return
  }
  if (data.kind === 'status' && data.payload.phase === 'settled') {
    log(`\nSETTLED status=${data.payload.status} message=${data.payload.message ?? ''}`)
    settled = true
  }
}

while (!settled && Date.now() < deadline) {
  const chunk = await reader.read()
  if (chunk.done) break
  buffer += decoder.decode(chunk.value, { stream: true })
  let index = buffer.indexOf('\n\n')
  while (index >= 0) {
    handleFrame(buffer.slice(0, index))
    buffer = buffer.slice(index + 2)
    index = buffer.indexOf('\n\n')
  }
}
const unsettled = !settled
log(`\ndone settled=${settled} approvals=${approvals}`)
process.exit(unsettled ? 1 : 0)
