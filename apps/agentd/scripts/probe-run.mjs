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
 *     node scripts/probe-run.mjs --prompt "Reply with exactly: hello" 
 *
 *   # 触发并自动放行工具审批（会真的执行工具）
 *   node scripts/probe-run.mjs --approve --mode smart_approve \
 *     --prompt "Create a file /tmp/probe.txt containing ok"
 *
 * 注意：审批能不能触发取决于 goose 的 `permission.yaml`。若 `user.always_allow`
 * 里已经包含该工具，goose 会直接放行、**不会**发审批请求。
 */

const base = process.env.AGENTD_BASE
const token = process.env.AGENTD_TOKEN
if (!base || !token) {
  console.error('需要 AGENTD_BASE 与 AGENTD_TOKEN')
  process.exit(2)
}

function readArg(name, fallback) {
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

const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }

function log(line) {
  console.log(line)
}

const created = await (
  await fetch(`${base}/threads`, { method: 'POST', headers, body: '{}' })
).json()
const thread = created.thread_id
log(`thread=${thread}`)

const sse = await fetch(`${base}/threads/${thread}/events`, { headers })
if (!sse.ok) {
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
let unsettled = false
const deadline = Date.now() + timeoutMs

function handleApproval(approval) {
  approvals += 1
  const options = approval.options ?? []
  log(`APPROVAL toolCall=${JSON.stringify(approval.toolCall).slice(0, 200)}`)
  log(`APPROVAL options=${options.map(function (o) { return `${o.kind}:${o.optionId}` }).join(',')}`)
  if (!autoApprove) {
    log('APPROVAL 未带 --approve，保持挂起（可另行 POST /threads/:id/approvals/:requestId）')
    return
  }
  const allow = options.find(function (o) { return o.kind === 'allow_once' }) ?? options[0]
  void fetch(`${base}/threads/${thread}/approvals/${approval.requestId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ optionId: allow.optionId })
  }).then(function (response) {
    log(`REPLY ${response.status} ${allow.optionId}`)
  })
}

function handleFrame(frame) {
  const eventMatch = /^event: (.+)$/m.exec(frame)
  const dataMatch = /^data: (.+)$/m.exec(frame)
  if (!eventMatch || !dataMatch) return
  let data
  try {
    data = JSON.parse(dataMatch[1])
  } catch {
    return
  }
  if (eventMatch[1] === 'sync') {
    log(`sync approvals=${data.approvals?.length ?? 0} lastSeq=${data.lastSeq}`)
    return
  }
  if (data.kind === 'approval') {
    handleApproval(data.payload.approval)
    return
  }
  if (data.kind === 'update') {
    const name = data.payload.sessionUpdate
    if (name === 'agent_message_chunk' && data.payload.content?.type === 'text') {
      process.stdout.write(data.payload.content.text)
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
unsettled = !settled
log(`\ndone settled=${settled} approvals=${approvals}`)
process.exit(unsettled ? 1 : 0)
