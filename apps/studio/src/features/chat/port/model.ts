import type {
  ChatModelPort,
  ChatPortEvent,
  ChatPortRequest,
  ChatStreamEvent,
  ChatTarget
} from '@cogito/chat/ports'
import { toast } from 'sonner'

/**
 * 模型端口（渲染进程实现）：走 `itc.assistant` 的 MessagePort 到主进程。
 *
 * 主进程持有 provider 的 apiKey 并真正发请求，这里只负责：
 * 建连（端口异步到达，先排队）→ 发 `start` → 收事件 → `finish`/`error`/`aborted` 收束。
 */

import { prepareImages } from '@/features/agent/images.ts'
import {
  dropStalePlatformRow,
  ensurePlatformProvider,
  findPlatformRow,
  isPlatformTarget,
  PLATFORM_PROVIDER_ID
} from '@/features/chat/platform.ts'
import { findDefaultModel, findSourceLabel } from '@/features/chat/provider/row.ts'
import { findSendBlocker, isGatewayTarget } from '@/features/quota/gate.ts'
import { syncActiveTenant } from '@/features/quota/tenant.ts'
import { findProviderSource, GATEWAY_PROVIDER_KIND } from '@cogito/agent/provider'

import { subscribeAssistantPort } from './assistant-port.ts'

interface EventQueue<T> {
  push: (item: T) => void
  close: () => void
  drain: () => AsyncGenerator<T>
}

/** 把推消息转成可 `for await` 的序列（队列 + 等待者） */
function buildEventQueue<T>(): EventQueue<T> {
  const items: T[] = []
  const waiters: Array<(value: IteratorResult<T>) => void> = []
  let closed = false

  function push(item: T): void {
    if (closed) return

    const waiter = waiters.shift()
    if (waiter) waiter({ value: item, done: false })
    else items.push(item)
  }

  function close(): void {
    closed = true
    waiters.splice(0).forEach(function (waiter) {
      waiter({ value: undefined as never, done: true })
    })
  }

  function next(): Promise<IteratorResult<T>> {
    const item = items.shift()
    if (item !== undefined) return Promise.resolve({ value: item, done: false })
    if (closed) return Promise.resolve({ value: undefined as never, done: true })

    return new Promise(function (resolve) {
      waiters.push(resolve)
    })
  }

  async function* drain(): AsyncGenerator<T> {
    while (true) {
      const result = await next()
      if (result.done) return
      yield result.value
    }
  }

  return { push, close, drain }
}

/** 端口会话：懒建连，端口到达前的调用先排队 */
function createPortSession() {
  let channel: MessagePort | null = null
  const waiting: Array<(value: MessagePort) => void> = []
  let listening = false

  function listen(): void {
    if (listening) return
    listening = true

    subscribeAssistantPort(function (next) {
      channel = next
      waiting.splice(0).forEach(function (resolve) {
        resolve(next)
      })
    })
  }

  async function findPort(): Promise<MessagePort> {
    if (channel) return channel

    listen()
    const pending = new Promise<MessagePort>(function (resolve) {
      waiting.push(resolve)
    })
    await itc.assistant.connect()
    return pending
  }

  return { findPort }
}

/** 端口事件带 `runID`（一个端口可跑多个运行）；对外只暴露共享事件形状 */
function toStreamEvent(event: ChatPortEvent): ChatStreamEvent {
  const { runID, ...rest } = event
  void runID
  return rest
}

function isFinal(event: ChatStreamEvent): boolean {
  return event.kind === 'finish' || event.kind === 'error' || event.kind === 'aborted'
}

/** 渲染进程看到的 provider 行 */
import type { ProviderModel, ProviderRow } from '@/features/chat/provider/row.ts'

/** 设置里的选择：providerID 显式指定，model 覆盖 provider 默认 */
export type ModelSelection = {
  providerID: string | null
  model: string
}

/** 可选 provider：启用且有可用模型（默认模型或模型列表） */
export function findUsableProviders(providers: ProviderRow[]): ProviderRow[] {
  return providers.filter(function (provider) {
    return provider.enabled && Boolean(provider.model || provider.models?.length)
  })
}

/**
 * 没有显式选择（或选中的那行已经没了）时用哪一行：**组织模型优先**。
 *
 * 组织模型由平台统一供给，配额与计费都记在账号上；个人 BYOK 是用户自担成本。
 * 两者都在时按「组织优先」兜底，与模型菜单里的分组顺序一致（组内保持 IPC 给的顺序，
 * 那已经是按名称稳定排过的）。没有组织行就取第一个可用的本地行。
 */
function findFallbackProvider(usable: ProviderRow[]): ProviderRow | null {
  const platform = usable.find(function (provider) {
    return findProviderSource(provider.kind) === 'platform'
  })

  return platform ?? usable[0] ?? null
}

/** 选中 provider：显式选择优先，否则按兜底规则（见 `findFallbackProvider`） */
export function findSelectedProvider(
  providers: ProviderRow[],
  selection: ModelSelection
): ProviderRow | null {
  const usable = findUsableProviders(providers)

  if (!selection.providerID) return findFallbackProvider(usable)

  const picked = usable.find(function (provider) {
    return provider.id === selection.providerID
  })
  return picked ?? findFallbackProvider(usable)
}

/**
 * 实际模型：设置覆盖 → provider 默认 → 模型列表首项。
 *
 * 覆盖得先过「这行认不认它」：服务端目录随时会变（下架、改名），BYOK 的清单也会被编辑，
 * 一个已经不在清单里的 id 发出去必然是失败运行 —— 主进程按名字查目录，查不到就报错。
 */
export function resolveTarget(
  providers: ProviderRow[],
  selection: ModelSelection
): ChatTarget | null {
  const provider = findSelectedProvider(providers, selection)
  if (!provider) return null

  const model = findEffectiveModel(provider, selection.model)
  return model ? { providerID: provider.id, model } : null
}

/** 这行认不认这个模型 id；清单为空（手填模型的行）时无从校验，一律放行 */
function isModelDeclared(provider: ProviderRow, model: string): boolean {
  if (!provider.models?.length) return true
  return Boolean(findModelEntry(provider, model))
}

/** 真正发给引擎的模型：设置里的覆盖只在**该行认得它**时才算数，否则退回该行默认模型 */
function findEffectiveModel(provider: ProviderRow, override: string): string {
  const wanted = override.trim()
  if (wanted && isModelDeclared(provider, wanted)) return wanted
  return findDefaultModel(provider)
}

/**
 * 设置里存的选择已经没人认了时的**有效替代**；不需要修就返回 null。
 *
 * 两种情况都来自「用户存的 id 过期了」：
 * - 选中的那行不在表里了（BYOK 行被删）→ 回到「自动」，交给兜底规则（组织模型优先）；
 * - 模型覆盖不在该行的声明清单里（目录下架、清单被编辑）→ 清掉覆盖，用该行默认模型。
 *
 * 「行还在不在」必须拿**未过滤**的清单判：平台行在未登录时会被 `dropStalePlatformRow`
 * 滤掉，那只是暂时不给用。按它自愈会把用户「用组织模型」的选择永久改写成自动。
 */
function findSelectionRepair(
  rows: ProviderRow[],
  providers: ProviderRow[],
  selection: ModelSelection
): ModelSelection | null {
  const picked = selection.providerID
  const isRowMissing =
    Boolean(picked) &&
    !rows.some(function (row) {
      return row.id === picked
    })
  if (isRowMissing) return { providerID: null, model: '' }

  const model = selection.model.trim()
  if (!model) return null

  // 覆盖属于「选中的那一行」；自动模式下才退而看兜底选中的那一行
  const owner = picked
    ? rows.find(function (row) {
        return row.id === picked
      })
    : findSelectedProvider(providers, selection)
  if (owner && !isModelDeclared(owner, model)) {
    return { providerID: picked, model: '' }
  }
  return null
}

/**
 * 当前选择是不是「自动」（没有钉住具体 provider）。
 *
 * 界面靠它区分「用户选的」与「兜底选的」：兜底时生效的模型会随后续 provider 变化而变，
 * 必须标出来，否则用户会以为是自己选的。
 */
export function isAutoSelection(selection: ModelSelection): boolean {
  return !selection.providerID
}

/** 生效模型的展示文案：模型名 + 来源，没有可用模型时为 null */
export function findTargetLabel(
  providers: ProviderRow[],
  selection: ModelSelection
): { model: string; source: string; isAuto: boolean } | null {
  const target = resolveTarget(providers, selection)
  if (!target) return null

  const provider = providers.find(function (row) {
    return row.id === target.providerID
  })
  const source = provider ? findSourceText(provider) : ''

  return { model: target.model, source, isAuto: isAutoSelection(selection) }
}

/** 来源文案：平台行的展示名就是来源名，别写成「组织模型 · 组织模型」 */
function findSourceText(provider: ProviderRow): string {
  const label = findSourceLabel(provider)
  return label === provider.name ? label : `${label} · ${provider.name}`
}

/**
 * 已解析过的 provider / 模型条目，按**运行目标**（providerID + 模型 id）键控。
 *
 * 宿主扩展（工具集、平台令牌）要在发送前现读「这次到底跑在哪个模型上」，而
 * `createChatModelAdapter` 的顺序是 `findTarget()` → `findHost(target)`：前者把结果记下，
 * 后者只同步读一次缓存（它的 `async` 是因为会话 id 要先 `ensure()`，与模型无关）。
 *
 * 键控而不是「上一次」：两个会话并发跑时，后发的 `findTarget()` 会覆盖单槽，
 * 先跑的那个于是读到别人的模型 —— 工具能力、平台令牌、沙箱全跟着错。
 */
const resolvedTargets = new Map<string, { provider: ProviderRow; model: ProviderModel | null }>()

/**
 * 目标的键。**没有目标时给 null**：这两个查询是「现读宿主扩展」的兜底路径，调用方可能
 * 一次都不带目标地进来（老契约是 `findHost?: () => …`，热更期间新旧模块并存时就会这样）。
 * 那种情况与「键不存在」是同一个结论 —— 按「这条目标还没解析过」处理，而不是让
 * `undefined.providerID` 把整轮运行打断在发送按钮上。
 */
function toTargetKey(target: ChatTarget | undefined): string | null {
  if (!target || typeof target !== 'object') return null
  return `${target.providerID}\u0000${target.model}`
}

function findResolved(
  target: ChatTarget | undefined
): { provider: ProviderRow; model: ProviderModel | null } | null {
  const key = toTargetKey(target)
  if (key === null) return null
  return resolvedTargets.get(key) ?? null
}

/** 运行目标对应的 provider 行；这条目标还没解析过时为 null */
export function findTargetProvider(target: ChatTarget | undefined): ProviderRow | null {
  return findResolved(target)?.provider ?? null
}

/** 运行目标对应的模型条目；provider 没声明清单时为 null（能力按兜底处理） */
export function findTargetModel(target: ChatTarget | undefined): ProviderModel | null {
  return findResolved(target)?.model ?? null
}

/** 记下这次解析出的目标（写入口只有这里，读侧是 `findResolved`） */
function rememberTarget(target: ChatTarget, provider: ProviderRow): void {
  const key = toTargetKey(target)
  if (key === null) return

  resolvedTargets.set(key, { provider, model: findModelEntry(provider, target.model) })
}

function findModelEntry(provider: ProviderRow, model: string): ProviderModel | null {
  return (
    provider.models?.find(function (item) {
      return item.id === model
    }) ?? null
  )
}

function createModelPort(
  findSelection: () => ModelSelection,
  repairSelection: (selection: ModelSelection) => Promise<void> = async function () {}
): ChatModelPort {
  const session = createPortSession()
  /**
   * 等待回执的审批：工具调用 id → 回执该投到哪个端口、哪一次运行。
   *
   * 不能用「当前运行」这种单槽记：每个线程各有一份端口实现，用户在会话 A 跑着的时候
   * 去会话 B 点审批按钮时，单槽指向的是 B 的运行 —— 回执要么投错人，要么投空。
   * 键用工具调用 id：事件流里每个审批请求都带它，界面原样回传。
   */
  const approvals = new Map<string, { channel: MessagePort; runID: string }>()

  return {
    /**
     * 当前选中的 provider/模型（同时记下这次的选择，供宿主扩展现读）。
     *
     * 选中平台行但它还没落库时（首次使用、或库被清过）先补一行 —— 不然 provider 列里
     * 没有它，`findSelectedProvider` 会回落到兜底的那一行，就跑到别的模型上去了。
     * 目录同步只在 picker 里做（那里才关心模型清单），这里只保证行存在。
     *
     * 选择过期（行被删 / 模型下架）时按 `findSelectionRepair` 的结论跑，并把结论写回设置：
     * 不写回去，界面一直显示那个已经没了的模型，运行却落在别的模型上 —— 两边永远对不上，
     * 用户还会以为是自己选的那个在跑。
     */
    async findTarget(): Promise<ChatTarget | null> {
      const selection = findSelection()
      // 未过滤的清单：平台行只是未登录时被滤掉，不代表这行没了
      let rows = await itc.chat.provider.toRead()

      if (
        selection.providerID === PLATFORM_PROVIDER_ID &&
        !findPlatformRow(dropStalePlatformRow(rows))
      ) {
        await ensurePlatformProvider()
        rows = await itc.chat.provider.toRead()
      }

      const providers = dropStalePlatformRow(rows)
      const repaired = findSelectionRepair(rows, providers, selection)
      if (repaired) {
        await repairSelection(repaired).catch(function (error) {
          // 落库失败只影响「下次还按旧选择算」，这次运行已经按修好的目标走了
          console.warn('把修好的模型选择写回设置失败', error)
        })
        toast.warning(
          repaired.providerID === null
            ? '原来选中的模型提供方已被删除，已切回「自动」。'
            : `模型 ${selection.model} 已不在目录中，已改用该行默认模型。`
        )
      }

      const effective = repaired ?? selection
      const target = resolveTarget(providers, effective)
      const provider = findSelectedProvider(providers, effective)

      if (provider && target) {
        rememberTarget(target, provider)
      }

      // 租户 id 要写进主进程的 provider 配置（`X-Tenant-ID`），而配置是同步拼的：
      // 这里是发送链路上唯一的异步点，顺手把它刷新到缓存里（换租户/换账号都会重新解析）
      if (provider?.kind === GATEWAY_PROVIDER_KIND) await syncActiveTenant()

      return target
    },

    /**
     * 回答一次工具审批。只有**还在等回执**的那次审批才算数：运行已经结束、或工具已经
     * 跑完（结果都回来了）时返回 false，界面据此提示「这次审批已失效」，而不是假报成功。
     */
    respondToApproval(input) {
      const target = approvals.get(input.toolCallId)
      if (!target) return false

      target.channel.postMessage({
        kind: 'tool-approval',
        runID: target.runID,
        toolCallId: input.toolCallId,
        approved: input.approved
      })
      return true
    },

    async *run(input, signal) {
      // 配额已尽就别去拉 opencode 了（冷启动要几秒），直接把原因回给界面；
      // 判不准时 `findSendBlocker` 一律放行，最终守门的还是服务端
      const blocked = await findSendBlocker({
        // 平台行按固定 id 兜底：缓存没命中时也得认得出它，否则这道闸门会静默跳过
        isGateway: isGatewayTarget(findTargetProvider(input)?.kind) || isPlatformTarget(input),
        modelID: input.model
      })
      if (blocked) {
        yield { kind: 'error', message: blocked }
        return
      }

      const channel = await session.findPort()
      const runID = crypto.randomUUID()
      const queue = buildEventQueue<ChatStreamEvent>()
      /** 本 run 登记过的审批 id：收尾时只清自己这些，别清掉并发那一次运行的 */
      const opened: string[] = []

      /** 记下「这个工具调用在等谁的回执」；工具跑完或回执作废就销账，再点按钮就没有意义了 */
      function rememberApproval(event: ChatStreamEvent): void {
        if (event.kind === 'tool-approval-request') {
          approvals.set(event.toolCallId, { channel, runID })
          opened.push(event.toolCallId)
          return
        }
        if (event.kind === 'tool-result' || event.kind === 'tool-approval-failed') {
          approvals.delete(event.toolCallId)
        }
      }

      function listener(event: MessageEvent) {
        const data = event.data as ChatPortEvent
        if (data.runID !== runID) return

        const streamEvent = toStreamEvent(data)
        rememberApproval(streamEvent)
        queue.push(streamEvent)
        if (isFinal(streamEvent)) queue.close()
      }

      function abort() {
        const request: ChatPortRequest = { kind: 'abort', runID }
        channel.postMessage(request)
      }

      channel.addEventListener('message', listener)
      signal.addEventListener('abort', abort)

      try {
        const prepared = prepareImages(input.messages, input.model)
        if (prepared.notice) toast.warning(prepared.notice)

        const request: ChatPortRequest = {
          kind: 'start',
          runID,
          ...input,
          messages: prepared.messages
        }
        channel.postMessage(request)
        // 注册监听之前就已经取消（用户在上一条还没跑完时点了停止）：那次 abort 事件早已过去，
        // 只挂监听等于把取消丢掉，这一轮会一直跑到上限。端口消息保序，宿主先建 run 再收到它。
        if (signal.aborted) abort()

        for await (const streamEvent of queue.drain()) {
          yield streamEvent
        }
      } finally {
        for (const toolCallId of opened) {
          if (approvals.get(toolCallId)?.runID === runID) approvals.delete(toolCallId)
        }
        channel.removeEventListener('message', listener)
        signal.removeEventListener('abort', abort)
      }
    }
  }
}

export { createModelPort, findSelectionRepair }
