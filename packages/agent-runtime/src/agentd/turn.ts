/**
 * 一轮运行的**唯一**状态机：订阅事件 → 提交 prompt → 泵帧 → 处理审批 → 收终态。
 *
 * ## 为什么必须只有一份
 *
 * 这段逻辑原本有两份（client 的 `port/session.ts` 与扩展的 `port/model.ts`），已经出现
 * 实质分歧：审批「取消」一边优先 `reject_once`、一边直接结束整轮；游标一边只在成功路径
 * 落库、一边在 `finally` 落；错误归因一边拼「哪一层坏了」、一边原样抛。凡是有两份实现
 * 的协议处理，最后一定漂移，而漂移的表现是「同一次故障，桌面端说重发即可、扩展说
 * Failed to fetch」这类没人能复现的说法。
 *
 * ## 三处结构性缺陷在这份实现里必须是对的
 *
 * 1. **不丢帧**：`Promise.race` 里落败的那个 promise 不能扔。旧实现每次循环都新建
 *    `frames.next()`，注入（审批结论）胜出后新的 frame promise 覆盖旧的，其解析值直接
 *    消失 —— 表现是「点了审批没反应 / 正文缺一段」。这里把未消费的 promise **留住**，
 *    下一轮继续 await 它。
 * 2. **超时参与等待**：只在下一次 `await` 之间检查 deadline，半开连接时 `frames.next()`
 *    永不 resolve，60 分钟上限形同虚设。这里把空闲计时器放进 race 本身。
 * 3. **终态唯一且必落游标**：`settled` / `cancelled` / `failed` 三选一、只发一次；
 *    `onCursor` 在 `finally` 里调用，取消与失败同样落游标（否则下次订阅重放旧 `settled`，
 *    把下一轮当场判成结束）。
 *
 * ## 不负责什么
 *
 * 计划 / 目标 / 后台续跑是**产品策略**，留在宿主；渲染成什么事件也由宿主决定。
 * 这里只产出协议级条目（ACP 原始通知、票据、终态），宿主各自映射。
 */

import type { SessionUpdate } from '@agentclientprotocol/sdk'

import type { ApprovalOutcome } from '../policy/approval'
import {
  createElicitationRegistry,
  deriveOption,
  postApproval,
  postElicitation
} from './approvals'
import type { AgentdCaller, ApprovalLedger, ElicitationRegistry } from './approvals'
import { AGENTD_ROUTES, createRunCursor, parseRunFrame } from './runs'
import type {
  AgentdApprovalOption,
  AgentdApprovalTicket,
  AgentdElicitationPayload,
  AgentdRunFrame
} from './runs'
import { annotateRunFailure } from './run-error'
import { toReadSSE } from './sse'
import type { SSEFrame } from './sse'

/** 一轮的兜底上限：真跑一小时也该有 settled，这里只防「事件流永久不闭嘴」。 */
const DEFAULT_IDLE_TIMEOUT_MS = 60 * 60_000

type TurnStopReason = 'end_turn' | 'cancelled'

/** 服务端 `sync` 帧的语义（权威游标，允许回退） */
interface TurnSyncInfo {
  epoch: string | null
  lastSeq: number | null
  minSeq: number | null
  truncated: boolean
  reset: boolean
}

/** 游标快照：`lastSeq` 是已应用到的位置，`epoch` 是它所属的 agentd 进程 */
interface TurnCursor {
  lastSeq: number
  epoch: string | null
}

/**
 * 协议级产出。宿主映射成自己的 UI 事件：
 * `update` → ACP 事件映射表；`approval` → 审批卡；`stop` → finish/aborted。
 */
type TurnItem =
  | { kind: 'update'; update: SessionUpdate }
  /**
   * 补历史的覆盖式更新（`session/load` 重放）：`update` 形状与 `update` 项相同，
   * 但宿主必须把它当「这条消息的完整文本」**替换**，而不是接着追加。
   */
  | { kind: 'replay'; update: SessionUpdate }
  | { kind: 'approval'; ticket: AgentdApprovalTicket }
  | { kind: 'approval_settled'; toolCallId: string; approved: boolean }
  | { kind: 'elicitation'; request: AgentdElicitationPayload['elicitation'] }
  | { kind: 'stop'; stopReason: TurnStopReason }

type TurnFailureCode =
  | 'subscribe_failed'
  | 'run_rejected'
  /** 同 thread 的另一个客户端正在跑（agentd 409 `writer_lease_held`） */
  | 'writer_busy'
  | 'stream_closed'
  | 'idle_timeout'
  | 'run_failed'

/**
 * 一轮失败的**结构化**原因。
 *
 * 带 `code` 而不是只有消息：宿主需要区分「超时」与「被网关拒了」来决定要不要提示重发，
 * 靠匹配中文文案判断是会随后续改文案而失效的耦合。
 */
class TurnFailure extends Error {
  readonly code: TurnFailureCode

  constructor(message: string, code: TurnFailureCode, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'TurnFailure'
    this.code = code
  }
}

/** 审批/追问的判定上下文：账本、注册表与业务规则都由宿主注入（这里不写业务规则） */
interface TurnGates {
  transport: AgentdCaller
  ledger: ApprovalLedger
  elicitations: ElicitationRegistry
  /** 业务规则：只读档 / 计划模式 / 自动档由宿主决定 */
  policy: (toolName: string, options: AgentdApprovalOption[]) => ApprovalOutcome
  /** 回执投递失败时的诊断通道（打包后 console.warn 看不到） */
  onSettleError?: (channel: 'approval' | 'elicitation', requestId: string) => void
}

interface TurnPumpInput {
  threadID: string
  /** 已应用到哪条事件之后（`record.lastSeq`） */
  after: number
  /** 上次所在 agentd 进程；换进程必须回退游标 */
  epoch?: string | null
  gates: TurnGates
  signal: AbortSignal
  idleTimeoutMs?: number
  /**
   * 本地注入出口：宿主把「已拍板」立刻塞回这条流，否则卡片要等到 `tool-result`
   * 才离开 requires-action（工具可能跑几分钟）。
   */
  injectRef?: { current: ((item: TurnItem) => void) | null }
  /** 订阅建立后、开始泵帧前的前置动作：`runTurn` 用它来 POST `/runs`（先订阅再提交） */
  onSubscribed?: () => Promise<void>
  onSync?: (info: TurnSyncInfo) => void
  /** 每应用一帧就报一次已应用位置（宿主据此更新内存游标） */
  onProgress?: (cursor: TurnCursor) => void
  /** 终态必调一次（成功、取消、失败都算） */
  onCursor?: (cursor: TurnCursor) => void
  /** 宿主能不能渲染这张追问表单；不能就 fail-closed 直接 decline，别让 goose 干等 */
  canRenderElicitation?: (request: AgentdElicitationPayload['elicitation']) => boolean
}

interface TurnRunInput {
  threadID: string
  prompt: string
  /** agentd 的 goose 模式（`approve` / `smart_approve` / `chat`） */
  mode: string
  cwd?: string | null
  mcpServers?: readonly unknown[]
  systemText?: string
  /**
   * 显式接管同一个 thread 上**另一个客户端**正在跑的那一轮。
   *
   * 默认 `false`：agentd 会回 409 `writer_lease_held`，因为「两个窗口同时写一个会话」
   * 的结果是两个界面各显示一半、审批互相抢。只有用户明确选择接管时才置真。
   */
  takeover?: boolean
}

interface TurnRunDeps extends TurnPumpInput {
  /** 幂等建线程（宿主实现：Tauri 桥 / 本机 client 的桥） */
  ensureThread?: () => Promise<void>
}

function createInjectQueue(): {
  push: (item: TurnItem) => void
  take: () => Promise<TurnItem>
} {
  const items: TurnItem[] = []
  let wake: (() => void) | null = null
  return {
    push: function (item: TurnItem) {
      items.push(item)
      const resume = wake
      wake = null
      resume?.()
    },
    take: function () {
      if (items.length > 0) return Promise.resolve(items.shift() as TurnItem)
      return new Promise<TurnItem>(function (resolve) {
        wake = function () {
          resolve(items.shift() as TurnItem)
        }
      })
    }
  }
}

/** 票据里的工具调用（agentd 原样透传 goose 的 `ToolCall`） */
interface TicketToolCall {
  toolCallId: string
  name?: string
  title?: string
}

function readToolCallId(ticket: AgentdApprovalTicket | undefined): string {
  if (!ticket) return ''
  const toolCall = ticket.toolCall as Partial<TicketToolCall> | null
  return typeof toolCall?.toolCallId === 'string' ? toolCall.toolCallId : ''
}

function readToolName(ticket: AgentdApprovalTicket): string {
  const toolCall = ticket.toolCall as Partial<TicketToolCall> | null
  const name = toolCall?.name?.trim()
  if (name) return name
  return toolCall?.title?.trim() ?? ''
}

/**
 * 唯一的事件泵。`runTurn`（发起一轮）与「恢复订阅」（刷新后接着看）共用它 ——
 * 两者帧处理必须一致，否则又是两份真源。
 */
async function* pumpTurn(input: TurnPumpInput): AsyncGenerator<TurnItem> {
  const { threadID, gates, signal } = input
  const idleTimeoutMs = input.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
  const cursor = createRunCursor(input.after)
  let epoch = input.epoch ?? null
  let stopReason: TurnStopReason = 'end_turn'

  // 注入出口要在**订阅之前**就挂好：宿主随时可能收到用户的审批回执，
  // 排在 `await call(...)` 之后会让那段窗口里的注入无处可去。
  const queue = createInjectQueue()
  if (input.injectRef) input.injectRef.current = queue.push

  const response = await gates.transport.call(
    AGENTD_ROUTES.events(threadID, input.after, epoch ?? undefined),
    { signal }
  )
  if (!response.ok) {
    throw new TurnFailure(`订阅会话事件失败：${response.status}`, 'subscribe_failed')
  }

  if (input.onSubscribed) await input.onSubscribed()

  const frames = toReadSSE(response, signal)

  /** 未消费的帧：注入胜出时**留住**它，下一轮继续 await（F-008） */
  let frameWait: Promise<{ type: 'frame'; result: IteratorResult<SSEFrame> }> | null = null
  /** 未消费的注入：帧胜出时同理留住，不能丢「已拍板」 */
  let injectWait: Promise<{ type: 'inject'; item: TurnItem }> | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  /** abort 监听要在 finally 里摘掉：不摘的话每轮都往同一个 signal 上挂一份 */
  let onAbortSignal: () => void = function () {}

  function awaitFrame(): Promise<{ type: 'frame'; result: IteratorResult<SSEFrame> }> {
    if (!frameWait) {
      frameWait = frames.next().then(function (result) {
        return { type: 'frame' as const, result }
      })
      // 泵提前退出（取消）时这条 promise 可能无人 await，别让它的 rejection 变成未捕获异常
      void frameWait.catch(function () {
        // 交给 race 的 await 处理
      })
    }
    return frameWait
  }

  function awaitInject(): Promise<{ type: 'inject'; item: TurnItem }> {
    if (!injectWait) {
      injectWait = queue.take().then(function (item) {
        return { type: 'inject' as const, item }
      })
    }
    return injectWait
  }

  /** 空闲计时器放进 race 本身：只在两次 await 之间检查 deadline 是防不住半开连接的（F-009） */
  function awaitIdle(): Promise<{ type: 'idle' }> {
    return new Promise<{ type: 'idle' }>(function (resolve) {
      idleTimer = setTimeout(function () {
        resolve({ type: 'idle' })
      }, idleTimeoutMs)
    })
  }

  const abortWait = new Promise<{ type: 'abort' }>(function (resolve) {
    onAbortSignal = function () {
      resolve({ type: 'abort' })
    }
    if (signal.aborted) {
      onAbortSignal()
      return
    }
    signal.addEventListener('abort', onAbortSignal, { once: true })
  })

  function reportProgress(): void {
    input.onProgress?.({ lastSeq: cursor.read(), epoch })
  }

  /**
   * 审批票据 → 自动回执或推给 UI。
   *
   * 实时帧与 `sync` 快照共用这一条路径，避免「刷新后补发的审批绕过只读/计划模式」
   * 直接弹给用户（F-019）。
   */
  function resolveApproval(ticket: AgentdApprovalTicket): TurnItem | null {
    const toolCallId = readToolCallId(ticket)
    // 同一客户端已经见过这张票（补发重叠 / 重连）：不重复推卡，也不重复自动回执
    if (gates.ledger.findState(toolCallId) !== null) return null
    const outcome = gates.policy(readToolName(ticket), ticket.options)
    if (outcome.kind === 'cancel') {
      // 要拦但拿不到合适的拒绝选项：fail-closed 取消整轮，绝不退化成放行
      void settleApproval(ticket, deriveOption(optionIds(ticket.options), false))
      gates.ledger.markSettled(toolCallId, false)
      return null
    }
    if (outcome.kind !== 'ask') {
      // 规则替用户拍板：立刻回执，且不推给 UI（推了会闪一下审批卡）
      void settleApproval(ticket, outcome.optionId)
      gates.ledger.markSettled(toolCallId, outcome.kind === 'allow')
      return null
    }
    gates.ledger.remember(toolCallId, {
      threadID,
      requestId: ticket.requestId,
      options: optionIds(ticket.options)
    })
    return { kind: 'approval', ticket }
  }

  async function settleApproval(
    ticket: AgentdApprovalTicket,
    optionId: string | null
  ): Promise<void> {
    const ok = await postApproval(gates.transport, threadID, ticket.requestId, optionId)
    if (!ok) gates.onSettleError?.('approval', ticket.requestId)
  }

  /** 追问票据：能渲染就推给 UI 并登记（回执只带 requestId），不能渲染就直接 decline */
  function resolveElicitation(
    request: AgentdElicitationPayload['elicitation']
  ): TurnItem | null {
    if (gates.elicitations.findTicket(request.requestId)) return null
    if (input.canRenderElicitation && !input.canRenderElicitation(request)) {
      void postElicitation(gates.transport, threadID, request.requestId, { action: 'decline' })
      return null
    }
    gates.elicitations.remember(request.requestId, { threadID, requestId: request.requestId })
    return { kind: 'elicitation', request }
  }

  function applyFrame(decoded: AgentdRunFrame): TurnItem[] {
    const items: TurnItem[] = []

    if (decoded.kind === 'sync') {
      if (decoded.epoch) epoch = decoded.epoch
      // 服务端报的是「已经写到这条连接上」的位置，它就是权威游标；
      // 不能只抬高：agentd 重启后 seq 从 0 重来，不回退会把新一轮的事件全当旧帧丢掉
      if (decoded.lastSeq !== null) cursor.reset(decoded.lastSeq)
      reportProgress()
      input.onSync?.({
        epoch,
        lastSeq: decoded.lastSeq,
        minSeq: decoded.minSeq,
        truncated: decoded.truncated,
        reset: decoded.reset
      })
      for (const ticket of decoded.approvals) {
        const item = resolveApproval(ticket)
        if (item) items.push(item)
      }
      for (const request of decoded.elicitations) {
        const item = resolveElicitation(request)
        if (item) items.push(item)
      }
      return items
    }

    if (decoded.kind === 'ignored') return items

    if (decoded.seq !== null) {
      // 补发与实时尾部会重叠：同一条事件只应用一次，否则正文会出现「用用」这类叠字
      if (!cursor.accept(decoded.seq)) return items
      reportProgress()
    }

    switch (decoded.kind) {
      case 'update':
        items.push({ kind: 'update', update: decoded.update })
        return items
      case 'replay':
        items.push({ kind: 'replay', update: decoded.update })
        return items
      case 'approval': {
        const item = resolveApproval(decoded.payload.approval)
        if (item) items.push(item)
        return items
      }
      case 'approval_settled': {
        // 任一客户端结案后的广播：另一边只更新卡片状态，不再回执
        const toolCallId = readToolCallId(decoded.payload.approval)
        if (!toolCallId) return items
        const state = gates.ledger.findState(toolCallId)
        if (state === true || state === false) return items
        const approved = typeof decoded.payload.optionId === 'string'
        gates.ledger.markSettled(toolCallId, approved)
        items.push({ kind: 'approval_settled', toolCallId, approved })
        return items
      }
      case 'elicitation': {
        const item = resolveElicitation(decoded.payload.elicitation)
        if (item) items.push(item)
        return items
      }
      case 'elicitation_settled':
        // 追问表单的结案由发起它的客户端自己收尾，其他客户端无需额外 UI
        return items
      case 'status': {
        if (decoded.payload.phase !== 'settled') return items
        const message = typeof decoded.payload.message === 'string' ? decoded.payload.message : ''
        if (decoded.payload.status === 'error' && !/abort/i.test(message)) {
          // 归因（模型/网关、工具、授权、连接）在这里拼进消息：两端说法必须一致
          throw new TurnFailure(
            annotateRunFailure(message, decoded.payload.errorKind),
            'run_failed'
          )
        }
        stopReason = signal.aborted || /abort/i.test(message) ? 'cancelled' : 'end_turn'
        items.push({ kind: 'stop', stopReason })
        return items
      }
      default:
        return items
    }
  }

  try {
    while (true) {
      const raced = await Promise.race([awaitFrame(), awaitInject(), awaitIdle(), abortWait])
      if (idleTimer !== null) {
        clearTimeout(idleTimer)
        idleTimer = null
      }

      if (raced.type === 'abort') {
        stopReason = 'cancelled'
        break
      }
      if (raced.type === 'idle') {
        throw new TurnFailure(
          `这一轮超过 ${Math.round(idleTimeoutMs / 60_000)} 分钟没有任何事件，已放弃等待`,
          'idle_timeout'
        )
      }
      if (raced.type === 'inject') {
        injectWait = null
        yield raced.item
        continue
      }

      frameWait = null
      if (raced.result.done) break

      const items = applyFrame(parseRunFrame(raced.result.value))
      for (const item of items) yield item
      if (items.some(isStopItem)) return
    }

    if (signal.aborted) {
      // 事件流会因为 abort 而直接结束（`toReadSSE` 不抛错）；那是「用户停了」，
      // 不是「流意外断了」，不能报成失败
      stopReason = 'cancelled'
    }
    if (stopReason === 'cancelled') {
      yield { kind: 'stop', stopReason }
      return
    }
    // 事件流自己断了（agentd 重启 / 网络抖动）：如实报错，别假装说完
    throw new TurnFailure('会话事件流意外结束，这一轮没有收到结束信号', 'stream_closed')
  } finally {
    if (idleTimer !== null) clearTimeout(idleTimer)
    signal.removeEventListener('abort', onAbortSignal)
    // 主动关闭 SSE 迭代器：只 abort signal 不够 —— `toReadSSE` 的 `finally`（cancel reader）
    // 只有迭代器被 return/耗尽时才跑，否则连接会挂到 agentd 自己发现断连为止
    void frames.return(undefined).catch(function () {
      // 已经关了
    })
    if (input.injectRef) input.injectRef.current = null
    input.onCursor?.({ lastSeq: cursor.read(), epoch })
  }
}

function isStopItem(item: TurnItem): boolean {
  return item.kind === 'stop'
}

function optionIds(options: readonly AgentdApprovalOption[]): string[] {
  return options.map(function (option) {
    return option.optionId
  })
}

/**
 * 发起一轮：幂等建线程 → **先订阅** → 再 POST `/runs` → 泵帧。
 *
 * 「先订阅再提交」是硬约束：反过来的话，首帧（`status/running` 与第一批正文）可能在
 * 订阅建立之前就发完，界面全程空白。
 */
async function* runTurn(request: TurnRunInput, deps: TurnRunDeps): AsyncGenerator<TurnItem> {
  if (deps.ensureThread) await deps.ensureThread()

  const body = {
    ...(request.takeover === true ? { takeover: true } : {}),
    input: {
      prompt: request.prompt,
      mode: request.mode,
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
      ...(request.mcpServers === undefined ? {} : { mcpServers: request.mcpServers }),
      ...(request.systemText === undefined ? {} : { systemText: request.systemText })
    }
  }

  yield* pumpTurn({
    ...deps,
    onSubscribed: async function () {
      const response = await deps.gates.transport.call(AGENTD_ROUTES.runs(request.threadID), {
        method: 'POST',
        body: JSON.stringify(body),
        signal: deps.signal
      })
      if (response.ok) return
      const detail = await response.text().catch(function () {
        return ''
      })
      // 写者租约冲突单独一条：这不是「参数不对」，而是「另一个窗口在跑」
      if (response.status === 409 && detail.includes('writer_lease_held')) {
        throw new TurnFailure(
          '这个会话正在被另一个窗口执行；等那一轮结束（或在那个窗口点停止）后再发',
          'writer_busy'
        )
      }
      throw new TurnFailure(
        `发起运行失败：${response.status}${detail ? `：${detail}` : ''}`,
        'run_rejected'
      )
    }
  })
}

export { DEFAULT_IDLE_TIMEOUT_MS, TurnFailure, createElicitationRegistry, pumpTurn, runTurn }
export type {
  TurnCursor,
  TurnFailureCode,
  TurnGates,
  TurnItem,
  TurnPumpInput,
  TurnRunDeps,
  TurnRunInput,
  TurnStopReason,
  TurnSyncInfo
}
