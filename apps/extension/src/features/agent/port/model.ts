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
  createElicitationRegistry,
  postApproval,
  postElicitation
} from '@cogito/agent-runtime/agentd/approvals'
import { AGENTD_ROUTES } from '@cogito/agent-runtime/agentd/runs'
import type {
  AgentdApprovalTicket,
  AgentdElicitationPayload
} from '@cogito/agent-runtime/agentd/runs'
import { runTurn } from '@cogito/agent-runtime/agentd/turn'
import type { TurnCursor, TurnItem } from '@cogito/agent-runtime/agentd/turn'
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
import { agentdTransport, callBridgeJson } from '@/features/bridge/client-bridge.ts'
import { findPref } from '@/features/platform/prefs.ts'

interface AgentRunHost {
  threadID: string
}

/** 正在跑的那一轮（本地侧只需要「能取消」与「能往流里塞事件」） */
interface LiveRun {
  controller: AbortController
  inject: (item: TurnItem) => void
}

/** 审批票据（与 client 共用同一份账本实现） */
const approvalLedger = createApprovalLedger()
/** 追问票据：回执只有 elicitationId，要靠它定位线程（与审批账本同生命周期） */
const pendingElicitations = createElicitationRegistry()
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
  acpSessionID: string | null,
  lastEpoch: string | null
): Promise<void> {
  const patch: { lastSeq: number; lastEpoch: string | null; acpSessionID?: string } = {
    lastSeq,
    lastEpoch
  }
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

/** 协议层的追问票据 → UI 事件（能不能渲染已经由状态机的谓词判过） */
function toElicitationEvent(request: AgentdElicitationPayload['elicitation']): ChatStreamEvent {
  const parsed = parseAcpElicitationRequest({
    mode: 'form',
    sessionId: request.sessionId,
    requestedSchema: request.requestedSchema
  } as CreateElicitationRequest)
  if (!parsed) throw new Error('追问表单无法渲染，已拒绝')
  return {
    kind: 'elicitation-request',
    elicitationId: request.requestId,
    schema: parsed.schema,
    ...(parsed.prompt ? { prompt: parsed.prompt } : {})
  }
}

function buildBridgeModelPort(): ChatModelPort {
  async function* run(
    input: ChatRunInput & ChatTarget,
    signal: AbortSignal
  ): AsyncGenerator<ChatStreamEvent> {
    // 首帧之前**不抛错**：抛出去时适配器只拿到一个失败的 Promise，界面会永远转圈（F-011）。
    let host: AgentRunHost
    try {
      host = findHost(input)
    } catch (error) {
      yield {
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
        usage: {}
      }
      return
    }
    const prompt = findRunPrompt(input.messages)
    if (!prompt) {
      yield { kind: 'finish', finishReason: 'end_turn', usage: {} }
      return
    }

    const thread = await database.agentThread.get(host.threadID)
    if (!thread) {
      yield { kind: 'error', message: `会话不存在：${host.threadID}`, usage: {} }
      return
    }

    /**
     * 本轮的审批档：开跑时取一次。
     *
     * 扩展没有计划/问答/目标档（那是桌面端的产品形态），所以 goose 会话档与审批判定
     * 本来就同源；但判定原来每次重新读偏好 —— 用户运行中改了审批档，就会出现
     * 「goose 按旧档、我们按新档」的分裂（与 F-013 同一类问题）。固定为一次取值。
     */
    const approvalMode = findPref('agent').approvalMode

    const controller = new AbortController()
    /**
     * 状态机的注入出口：审批回执要能立刻插进这一轮的事件流（否则卡片要等到
     * `tool-result` 才离开 requires-action，而工具可能跑几分钟）。
     */
    const injectRef: { current: ((item: TurnItem) => void) | null } = { current: null }
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

    liveRuns.set(host.threadID, {
      controller,
      inject: function (item: TurnItem) {
        injectRef.current?.(item)
      }
    })

    /**
     * 最新拿到的 agentd 会话 id。
     *
     * 不能直接用最上面读到的 `thread.acpSessionID` 去落库：首轮它是 null（不写，还好），
     * 但从第二轮起它是**上一轮的旧值** —— 结案时刚把新值落库，收尾会拿旧值把它盖回去。
     */
    let acpSessionID = thread.acpSessionID

    /** 收尾时把游标与会话 id 落库：刷新后再订阅才不会重放旧 `settled` */
    async function persist(cursor: TurnCursor): Promise<void> {
      const latest = (await findAcpSessionID(host.threadID)) ?? acpSessionID
      if (latest) acpSessionID = latest
      await persistCursor(host.threadID, cursor.lastSeq, latest, cursor.epoch)
    }

    const context = {
      /** 有 messageId 就按它分段，没有就整轮一段 */
      blockID: function (messageId: string | null | undefined, kind: 'text' | 'reasoning') {
        return messageId ? `${kind}:${messageId}` : `${kind}:run`
      }
    }

    try {
      for await (const item of runTurn(
        {
          threadID: host.threadID,
          prompt,
          mode: findGooseMode(approvalMode)
        },
        {
          threadID: host.threadID,
          after: thread.lastSeq,
          epoch: thread.lastEpoch ?? null,
          gates: {
            transport: agentdTransport,
            ledger: approvalLedger,
            elicitations: pendingElicitations,
            policy: function (toolName, options) {
              // 扩展没有计划模式与目标推进：两者都是桌面端的产品形态
              return decideApproval({
                toolName,
                approvalMode,
                planning: false,
                goalActive: false,
                options
              })
            },
            onSettleError: function (channel, requestId) {
              console.warn(`[agent/port] ${channel} 回执投递失败:`, requestId)
            }
          },
          signal: controller.signal,
          injectRef,
          canRenderElicitation: function (request) {
            // 我们只有 form 模式的渲染面：其余模式状态机会代发 decline
            return (
              parseAcpElicitationRequest({
                mode: 'form',
                sessionId: request.sessionId,
                requestedSchema: request.requestedSchema
              } as CreateElicitationRequest) !== null
            )
          },
          onCursor: function (cursor) {
            // 失败 / 中止也要把游标落库：否则下次订阅会把这一轮的事件整段重放
            void persist(cursor).catch(function (error: unknown) {
              console.warn('[agent/port] 游标落库失败:', error)
            })
          },
          // 幂等建线程：`thread_id` 就是本地会话 id，agentd 重启后仍能对上 checkpoint
          ensureThread: async function () {
            await callBridgeJson<unknown>(AGENTD_ROUTES.threads, {
              method: 'POST',
              body: JSON.stringify({ thread_id: host.threadID })
            })
          }
        }
      )) {
        if (item.kind === 'update') {
          const event = parseAcpStreamEvent(item.update, context)
          if (event) yield event
          continue
        }
        if (item.kind === 'replay') {
          // 补历史（另一个客户端触发的 `/replay` 也会广播到这条流）：正文是完整文本，
          // 必须走覆盖语义，否则与已渲染部分重叠
          const event = parseAcpStreamEvent(item.update, { ...context, replace: true })
          if (event) yield event
          continue
        }
        if (item.kind === 'approval') {
          const ticket: AgentdApprovalTicket = item.ticket
          const event = parseAcpApprovalRequest({
            sessionId: ticket.sessionId,
            toolCall: ticket.toolCall,
            options: ticket.options
          } as unknown as RequestPermissionRequest)
          if (event) yield event
          continue
        }
        if (item.kind === 'approval_settled') {
          yield {
            kind: 'tool-approval-settled',
            toolCallId: item.toolCallId,
            approved: item.approved
          }
          continue
        }
        if (item.kind === 'elicitation') {
          yield toElicitationEvent(item.request)
          continue
        }
        yield item.stopReason === 'cancelled'
          ? { kind: 'aborted', usage: {} }
          : { kind: 'finish', finishReason: 'end_turn', usage: {} }
        return
      }
    } catch (error) {
      if (controller.signal.aborted) {
        yield { kind: 'aborted', usage: {} }
        return
      }
      // 消息已经在状态机里带过归因（模型/网关、工具、授权、连接），两端说法一致
      throw error instanceof Error ? error : new Error(String(error))
    } finally {
      // 正常结束的回合不摘监听的话，之后 signal 被 abort 会再发一次 cancel，可能误杀别人那一轮
      signal.removeEventListener('abort', onAbort)
      liveRuns.delete(host.threadID)
      controller.abort()
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
        kind: 'approval_settled',
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
      const ticket = pendingElicitations.findTicket(input.elicitationId)
      if (!ticket) return false
      pendingElicitations.forget(input.elicitationId)
      const decision: CreateElicitationResponse = parseAcpElicitationResponse(input)
      void postElicitation(agentdTransport, ticket.threadID, ticket.requestId, decision)
      return true
    }
  }
}

export { buildBridgeModelPort, findRunPrompt }
export type { AgentRunHost }
