/**
 * 模型端口（扩展实现）：一轮 prompt 经本机 client 的代理打到 agentd。
 *
 * ## 与 client 那条链的关系
 *
 * 协议层完全共用（`@cogito/agent-runtime`）：路由表、SSE 读帧、游标去重、审批派生、
 * ACP 事件映射都是同一份代码。这里只实现「一轮运行」这个状态机。
 *
 * ## 三个必须与 client 对齐的细节（都踩过）
 *
 * 1. **先订阅再提交**：先开事件流、再 POST `/runs`，否则首帧（`status/running`、
 *    第一批正文）可能在订阅建立前就发完，界面全程空白。
 * 2. **停止要通知 agentd**：只 abort 本地 SSE 是不够的 —— agentd 的图还在跑、goose 还在
 *    执行工具、checkpoint 还在写。UI 说「已停止」而进程还在动（甚至在写文件），是最难查的
 *    那类不一致。`POST /threads/:id/cancel` 是唯一能真正收住长工具的信号。
 * 3. **审批结论要立刻回注事件流**：只把回执发给 agentd，消息要等到 `tool-result` 才离开
 *    `requires-action`，而工具可能跑几分钟 —— 用户看到的就是「点了审批没反应」。
 *
 * ## 与 client 刻意的差异
 *
 * 游标只在收尾写一次（逐帧写 Dexie 是每轮几十次写放大，而游标只用于「刷新后接着看」）；
 * `cwd` / `mcpServers` / `systemText` 一律省略 —— 那是桌面端的上下文，扩展没有也不该伪造。
 */

import type {
  CreateElicitationRequest,
  CreateElicitationResponse,
  RequestPermissionRequest
} from '@agentclientprotocol/sdk'
import {
  parseAcpApprovalRequest,
  parseAcpElicitationRequest,
  parseAcpElicitationResponse,
  parseAcpStreamEvent
} from '@cogito/agent-runtime/acp'
import {
  createApprovalLedger,
  postApproval,
  postElicitation
} from '@cogito/agent-runtime/agentd/approvals'
import { AGENTD_ROUTES, createRunCursor, parseRunFrame } from '@cogito/agent-runtime/agentd/runs'
import { readSse } from '@cogito/agent-runtime/agentd/sse'
import { decideApproval, findGooseMode } from '@cogito/agent-runtime/policy'
import type {
  ChatElicitationResponse,
  ChatModelPort,
  ChatRunInput,
  ChatRunMessage,
  ChatStreamEvent,
  ChatTarget,
  ChatToolApproval
} from '@cogito/chat/ports'

import { database } from '@/database/database.ts'
import { agentdTransport, callBridge, callBridgeJson } from '@/features/bridge/client-bridge.ts'
import { findPref } from '@/features/platform/prefs.ts'

/** 一轮的兜底上限：真跑一小时也该有 settled，这里只防「事件流永久不闭嘴」 */
const RUN_IDLE_TIMEOUT_MS = 60 * 60_000

interface AgentRunHost {
  threadID: string
}

/** 正在跑的那一轮（本地侧只需要「能取消」与「能往流里塞事件」） */
interface LiveRun {
  controller: AbortController
  inject: (event: ChatStreamEvent) => void
}

/** 本地注入队列：审批结论走它跟 SSE 帧抢同一个消费循环 */
interface InjectQueue {
  push: (event: ChatStreamEvent) => void
  take: () => Promise<ChatStreamEvent>
}

/** 审批票据（与 client 共用同一份账本实现） */
const approvalLedger = createApprovalLedger()/** 追问票据：`elicitationId → 发起它的会话`（回执只有 elicitationId，要靠它定位线程） */
const pendingElicitations = new Map<string, { threadID: string; requestId: string }>()
/** 活跃轮：审批回执要注入**票据所属**那一轮，而不是「当前」那一轮 */
const liveRuns = new Map<string, LiveRun>()

function findHost(input: ChatRunInput): AgentRunHost {
  const host = input.host as Partial<AgentRunHost> | undefined
  const threadID = typeof host?.threadID === 'string' ? host.threadID : ''
  if (!threadID) {
    // 没有会话 id 的运行是**有害的成功**：历史写不回去、审批也无从定位到票据
    throw new Error('[agent/port] 会话身份未就绪，已拒绝发起运行')
  }
  return { threadID }
}

/** 本轮要发的文本：最后一条用户消息（agentd 侧持有会话上下文，只发增量） */
function findRunPrompt(messages: readonly ChatRunMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user') continue
    const text = message.content.trim()
    if (text) return text
  }
  return ''
}

/**
 * 可注入的单消费者队列：审批结论与 SSE 事件要进同一条流。
 *
 * 没有它，「点了审批没反应」是必然：审批卡的 `requires-action` 只有等到 `tool-result`
 * 才会消失，而工具可能跑几分钟。
 */
function makeInjectQueue(): InjectQueue {
  const events: ChatStreamEvent[] = []
  let wake: (() => void) | null = null
  return {
    push(event: ChatStreamEvent) {
      events.push(event)
      const resume = wake
      wake = null
      resume?.()
    },
    take() {
      if (events.length > 0) return Promise.resolve(events.shift() as ChatStreamEvent)
      return new Promise<ChatStreamEvent>(function (resolve) {
        wake = function () {
          resolve(events.shift() as ChatStreamEvent)
        }
      })
    }
  }
}

/** 让 agentd 停掉这个线程上正在跑的那一轮（幂等：没有活跃轮时 agentd 回 200） */
function requestThreadCancel(threadID: string): void {
  void agentdTransport
    .call(AGENTD_ROUTES.cancel(threadID), { method: 'POST' })
    .catch(function (error: unknown) {
      console.warn('[agent/port] 取消请求失败:', error)
    })
}

/** 收尾时把游标与会话 id 落库：刷新后再订阅才不会重放旧 `settled` */
async function persistCursor(
  threadID: string,
  lastSeq: number,
  acpSessionID: string | null
): Promise<void> {
  const patch: { lastSeq: number; acpSessionID?: string } = { lastSeq }
  if (acpSessionID) patch.acpSessionID = acpSessionID
  await database.agentThread.update(threadID, patch)
}

async function findAcpSessionID(threadID: string): Promise<string | null> {
  try {
    const state = await callBridgeJson<{ values?: { sessionId?: unknown } }>(
      AGENTD_ROUTES.state(threadID)
    )
    const value = state.values?.sessionId
    return typeof value === 'string' && value ? value : null
  } catch (error) {
    // 读不到就沿用本地记录：首轮刚建时 state 可能还是空的
    console.warn('[agent/port] 读取会话状态失败:', error)
    return null
  }
}

function buildBridgeModelPort(): ChatModelPort {
  async function* run(
    input: ChatRunInput & ChatTarget,
    signal: AbortSignal
  ): AsyncGenerator<ChatStreamEvent> {
    const host = findHost(input)
    const prompt = findRunPrompt(input.messages)
    if (!prompt) {
      yield { kind: 'finish', finishReason: 'end_turn', usage: {} }
      return
    }

    const thread = await database.agentThread.get(host.threadID)
    if (!thread) throw new Error(`会话不存在：${host.threadID}`)
    const after = thread.lastSeq

    // 幂等建线程：`thread_id` 就是本地会话 id，agentd 重启后仍能对上 checkpoint
    await callBridgeJson<unknown>(AGENTD_ROUTES.threads, {
      method: 'POST',
      body: JSON.stringify({ thread_id: host.threadID })
    })

    const controller = new AbortController()
    const queue = makeInjectQueue()
    /**
     * 外部取消（用户点「停止」）要**同时**做两件事：让 agentd 停，再断本地 SSE。
     * 只断本地 SSE 的话，UI 显示「已停止」而工具还在跑 —— 它可能在写文件。
     */
    const onAbort = function (): void {
      requestThreadCancel(host.threadID)
      controller.abort()
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })

    liveRuns.set(host.threadID, { controller, inject: queue.push })

    const cursor = createRunCursor(after)
    let isSettled = false
    /**
     * 最新拿到的 agentd 会话 id。
     *
     * 不能直接用最上面读到的 `thread.acpSessionID` 去写 finally：首轮它是 null（不写，还好），
     * 但从第二轮起它是**上一轮的旧值** —— settled 分支刚把新值落库，finally 会拿旧值把它盖回去。
     */
    let acpSessionID = thread.acpSessionID

    try {
      // ① 先订阅
      const eventsResponse = await callBridge(AGENTD_ROUTES.events(host.threadID, after), {
        signal: controller.signal
      })
      if (!eventsResponse.ok) {
        throw new Error(`订阅会话事件失败：${eventsResponse.status}`)
      }

      // ② 再提交这一轮
      const mode = findGooseMode(findPref('agent').approvalMode)
      const runResponse = await callBridge(AGENTD_ROUTES.runs(host.threadID), {
        method: 'POST',
        body: JSON.stringify({ input: { prompt, mode } }),
        signal: controller.signal
      })
      if (!runResponse.ok) {
        const detail = await runResponse.text().catch(function () {
          return ''
        })
        throw new Error(`发起运行失败：${runResponse.status}${detail ? `：${detail}` : ''}`)
      }

      const context = {
        /** 有 messageId 就按它分段，没有就整轮一段 */
        blockID: function (messageId: string | null | undefined, kind: 'text' | 'reasoning') {
          return messageId ? `${kind}:${messageId}` : `${kind}:run`
        }
      }
      const frames = readSse(eventsResponse, controller.signal)
      const deadline = Date.now() + RUN_IDLE_TIMEOUT_MS

      while (!isSettled && Date.now() < deadline) {
        // 两个来源抢同一个循环：SSE 帧 与 本地注入（审批结论）
        const raced = await Promise.race([
          frames.next().then(function (result) {
            return { type: 'frame' as const, result }
          }),
          queue.take().then(function (event) {
            return { type: 'inject' as const, event }
          })
        ])

        if (raced.type === 'inject') {
          yield raced.event
          continue
        }
        if (raced.result.done) break

        const decoded = parseRunFrame(raced.result.value)
        if (decoded.kind === 'sync') {
          if (decoded.lastSeq !== null) cursor.reset(decoded.lastSeq)
          continue
        }
        if (decoded.kind === 'ignored') continue
        if (decoded.seq !== null && !cursor.accept(decoded.seq)) continue

        if (decoded.kind === 'update') {
          const event = parseAcpStreamEvent(decoded.update, context)
          if (event) yield event
          continue
        }

        if (decoded.kind === 'approval') {
          const ticket = decoded.payload.approval
          const toolCall = ticket.toolCall as { name?: string; title?: string; toolCallId: string }
          const toolName = toolCall.name?.trim() || toolCall.title?.trim() || ''
          const outcome = decideApproval({
            toolName,
            approvalMode: findPref('agent').approvalMode,
            // 扩展没有计划模式与目标推进：两者都是桌面端的产品形态
            planning: false,
            goalActive: false,
            options: ticket.options
          })
          if (outcome.kind === 'cancel') {
            // 规则要拦但拿不到合适选项：宁可按取消结案，也不能让用户把它放行
            void postApproval(agentdTransport, host.threadID, ticket.requestId, null)
            approvalLedger.markSettled(toolCall.toolCallId, false)
            continue
          }
          if (outcome.kind !== 'ask') {
            // 规则替用户拍板：立刻回执，且**不推给 UI**（推了会闪一下审批卡）
            void postApproval(agentdTransport, host.threadID, ticket.requestId, outcome.optionId)
            approvalLedger.markSettled(toolCall.toolCallId, outcome.kind === 'allow')
            continue
          }
          approvalLedger.remember(toolCall.toolCallId, {
            threadID: host.threadID,
            requestId: ticket.requestId,
            options: ticket.options.map(function (option) {
              return option.optionId
            })
          })
          const params = {
            sessionId: ticket.sessionId,
            toolCall: ticket.toolCall,
            options: ticket.options
          } as unknown as RequestPermissionRequest
          yield parseAcpApprovalRequest(params)
          continue
        }

        if (decoded.kind === 'elicitation') {
          const request = decoded.payload.elicitation
          const parsed = parseAcpElicitationRequest({
            mode: 'form',
            sessionId: request.sessionId,
            requestedSchema: request.requestedSchema
          } as CreateElicitationRequest)
          if (!parsed) {
            // 我们只有 form 模式的渲染面：其余模式直接 decline，别让 goose 干等
            void postElicitation(agentdTransport, host.threadID, request.requestId, {
              action: 'decline'
            })
            continue
          }
          pendingElicitations.set(request.requestId, {
            threadID: host.threadID,
            requestId: request.requestId
          })
          yield {
            kind: 'elicitation-request',
            elicitationId: request.requestId,
            schema: parsed.schema,
            ...(parsed.prompt ? { prompt: parsed.prompt } : {})
          }
          continue
        }

        if (decoded.kind === 'status') {
          const payload = decoded.payload
          if (payload.phase !== 'settled') continue
          isSettled = true
          const message = typeof payload.message === 'string' ? payload.message : ''
          if (payload.status === 'error' && !/abort/i.test(message)) {
            throw new Error(message || '这一轮以错误结束')
          }
          if (controller.signal.aborted) {
            yield { kind: 'aborted', usage: {} }
            return
          }
          const latest = (await findAcpSessionID(host.threadID)) ?? acpSessionID
          acpSessionID = latest
          await persistCursor(host.threadID, cursor.read(), latest)
          yield { kind: 'finish', finishReason: 'end_turn', usage: {} }
          return
        }
      }

      if (!isSettled) {
        // 事件流自己断了（客户端退出 / 网络抖动）：如实报错，别假装说完
        throw new Error('会话事件流意外结束，这一轮没有收到结束信号')
      }
    } catch (error) {
      if (controller.signal.aborted) {
        yield { kind: 'aborted', usage: {} }
        return
      }
      throw error instanceof Error ? error : new Error(String(error))
    } finally {
      // 正常结束的回合不摘监听的话，之后 signal 被 abort 会再发一次 cancel，可能误杀别人那一轮
      signal.removeEventListener('abort', onAbort)
      liveRuns.delete(host.threadID)
      controller.abort()
      if (cursor.read() > after) {
        // 失败 / 中止也要把游标落库：否则下次订阅会把这一轮的事件整段重放
        await persistCursor(host.threadID, cursor.read(), acpSessionID).catch(function (
          error: unknown
        ) {
          console.warn('[agent/port] 游标落库失败:', error)
        })
      }
    }
  }

  return {
    findTarget(): Promise<ChatTarget | null> {
      const agent = findPref('agent')
      // 走本机代理时，真正用哪个模型由桌面端的 goose 配置决定；这里只用于界面标注
      return Promise.resolve({
        providerID: agent.providerID ?? 'cogito_bridge',
        model: agent.model ?? 'desktop'
      })
    },

    run,

    respondToApproval(input: ChatToolApproval): boolean {
      const taken = approvalLedger.take(input.toolCallId, {
        approved: input.approved,
        optionId: input.optionId ?? null
      })
      if (!taken) return false
      // 立刻把「已拍板」推回事件流：否则卡片要等到 `tool-result` 才离开 requires-action
      liveRuns.get(taken.ticket.threadID)?.inject({
        kind: 'tool-approval-settled',
        toolCallId: input.toolCallId,
        approved: taken.approved
      })
      void postApproval(
        agentdTransport,
        taken.ticket.threadID,
        taken.ticket.requestId,
        taken.optionId
      )
      return true
    },

    findApprovalState(toolCallId: string): 'pending' | boolean | null {
      return approvalLedger.findState(toolCallId)
    },

    respondToElicitation(input: ChatElicitationResponse): boolean {
      const ticket = pendingElicitations.get(input.elicitationId)
      if (!ticket) return false
      pendingElicitations.delete(input.elicitationId)
      const decision: CreateElicitationResponse = parseAcpElicitationResponse(input)
      void postElicitation(agentdTransport, ticket.threadID, ticket.requestId, decision)
      return true
    }
  }
}

export { buildBridgeModelPort, findRunPrompt }
export type { AgentRunHost }
