/**
 * 模型端口（客户端实现）：一次运行接到 goose ACP 的那条会话上。
 *
 * 这里只做三件事：把「共享层的一次运行」翻译成控制器的一轮 prompt、把 ACP 通知翻译成共享事件、
 * 把回执翻译回票据。凭据不进渲染进程 —— goose 自己拿着 provider 配置，我们只给会话配置项。
 */
import type {
  ChatElicitationResponse,
  ChatImage,
  ChatModelPort,
  ChatRunInput,
  ChatRunMessage,
  ChatStreamEvent,
  ChatTarget,
  ChatToolApproval,
  ChatUsage
} from '@cogito/chat/ports'
import { toast } from 'sonner'

import { consumeBackgroundTurn } from '@/features/agent/acp/background-turn'
import { ensureCogitoProvider, isCogitoSoftFailure } from '@/features/agent/acp/cogito-provider'
import {
  findApprovalState as findSessionApprovalState,
  respondToApproval,
  respondToElicitation,
  runThreadPrompt
} from '@/features/agent/acp/session'
import { parseAcpStreamEvent, type AcpStreamContext } from '@/features/agent/acp/stream'
import { captureDirectiveDraft } from '@/features/agent/directive-draft'
import { rememberGoalTurnContext } from '@/features/agent/goal-continue'
import {
  beginGoalTurn,
  readGoalRun,
  readNextGoalBudget,
  startGoalRun
} from '@/features/agent/goal-run'
import { appendModeGuidance, resolveRunMode } from '@/features/agent/mode'
import { findActiveScenario } from '@/features/agent/model/active-scenario'
import { buildPromptContext } from '@/features/agent/model/prompt-context'
import { buildSystemPrompt } from '@/features/agent/model/prompt-project'
import { parseModels } from '@/features/agent/model/providers'
import {
  isLocalKind,
  noteRunFailure,
  pickProvider,
  planRoute,
  readRouteTier
} from '@/features/agent/model/route'
import type { ScenarioKey } from '@/features/agent/model/scenarios'
import { notifyApproval } from '@/features/agent/notify'
import { parseSchedulePlan } from '@/features/agent/schedule-plan'
import { findProviderSecret } from '@/features/persist'
import { findSendBlocker, isGatewayTarget } from '@/features/quota/gate'
import { useProviderStore, type AgentProvider } from '@/stores/provider'
import { useScheduleDraftStore } from '@/stores/schedule-draft'
import { reportCaught } from '@/utils/exception-report'

/** 宿主扩展：本轮运行要用哪个会话（thread = 本地会话行） */
interface AgentRunHost {
  threadID: string
  workspaceID: string | null
}

/**
 * 端口覆盖：给「另一个宿主」（磁贴内 dock）用。
 *
 * dock 的会话不挂在聊天页上，所以不能读全局场景；系统提示与收尾副作用都改由调用方给。
 */
interface ModelPortOverrides {
  /** 覆盖系统提示（不传则按当前场景 + 能力地图） */
  findSystemText?: (input: ChatRunInput) => string
  /**
   * 覆盖本轮要发的话：把「可见消息」与「发给模型的组合提示词」解耦。
   * 一键动作只在输入框里显示一句短标签，真正带全文/选区/定义的提示词走这里。
   * 不传则直接用最后一条用户消息的文本（`visibleText`）。
   */
  findUserText?: (input: ChatRunInput, visibleText: string) => string
  /** 回合正常收尾（未取消）时的钩子；传了就不再走 directive / plan 的全局副作用 */
  onFinish?: (capturedText: string, host: AgentRunHost) => void
}

function findHost(input: ChatRunInput): AgentRunHost {
  const host = input.host as Partial<AgentRunHost> | undefined
  const threadID = typeof host?.threadID === 'string' ? host.threadID : ''
  if (!threadID) {
    // 没有会话 id 的运行是**有害的成功**：历史写不回去、审批也无从定位到票据
    throw new Error('[agent/port] 会话身份未就绪，已拒绝发起运行')
  }
  return { threadID, workspaceID: typeof host?.workspaceID === 'string' ? host.workspaceID : null }
}

/** 当前启用的 provider：优先显式选中的那个，否则取第一个启用的 */
function findActiveProvider(): AgentProvider | null {
  const state = useProviderStore.getState()
  const active = state.providers.find(function (provider) {
    return provider.id === state.activeProviderID && provider.enabled
  })
  if (active) return active
  return (
    state.providers.find(function (provider) {
      return provider.enabled
    }) ?? null
  )
}

/**
 * provider 行的模型：`model` 是指定值，缺失时取 `models` 列表首项。
 *
 * 两处都可能为空（行是手填的），空就当作「没配置好」返回 null —— 让上层给出可读的提示，
 * 而不是发一次必然失败的请求。
 */
function findActiveModel(provider: AgentProvider): string | null {
  const picked = provider.model?.trim()
  if (picked) return picked
  return parseModels(provider.models)[0] ?? null
}

/**
 * 云兜底候选：启用的、非本地 kind、且真的配了模型 —— 换过去没模型等于白跑一趟。
 *
 * 排序只认「真的能用」：先组织模型（登录即用），再存过密钥的接入，最后才按表的顺序取第一个。
 * 不这么做的话，兜底会掳到一个用户从没配过的 CLI 接入上，报错更加看不懂。
 */
async function findCloudFallback(
  providers: readonly AgentProvider[],
  excludeID: string
): Promise<AgentProvider | null> {
  const candidates = providers.filter(function (provider) {
    return (
      provider.enabled &&
      provider.id !== excludeID &&
      !isLocalKind(provider.kind) &&
      Boolean(findActiveModel(provider))
    )
  })
  if (candidates.length === 0) return null
  const gateway = candidates.find(function (provider) {
    return isGatewayTarget(provider.kind)
  })
  if (gateway) return gateway
  for (const candidate of candidates) {
    if (await findProviderSecret(candidate.id)) return candidate
  }
  return candidates[0]
}

/**
 * 分层路由（S11）：**用户选中的接入优先**，只有「本轮是系统自动挑的本地 provider」才探测兜底。
 *
 * 四处刻意的克制：
 * ① 显式选择**不探测、不替换**：用户点名 DeepSeek，就不能因为本机装了 Ollama 被换走；
 * ② 探测/判定不可用（IPC 挂了、超时）**不降级**：探不出来不等于本地坏了，
 *    悄悄换云等于把这次对话送出本机；
 * ③ 兜底只挑「有模型」的非本地接入（空壳行挑不出模型，选中它连发送都会被挡）；
 * ④ 拉不到云接入就原地用本地：宁可让用户看到本地报错，也不要静默什么都不发。
 */
async function findRoutedProvider(): Promise<AgentProvider | null> {
  const state = useProviderStore.getState()
  const tier = readRouteTier()
  const picked = pickProvider({
    providers: state.providers,
    activeProviderID: state.activeProviderID,
    tier
  })
  if (!picked) return findActiveProvider()
  const provider =
    state.providers.find(function (item) {
      return item.id === picked.id
    }) ?? null
  if (!provider) return null
  // 用户自己点过（持久化的选择）就照办；只有系统给的默认值时，才允许按档位探测、兜底
  const isAutomatic = !state.activeProviderPicked
  if (!isAutomatic || tier !== 'local' || !isLocalKind(provider.kind)) return provider
  const reply = await planRoute(tier, findActiveModel(provider))
  if (!reply?.plan.degraded) return provider
  const cloud = await findCloudFallback(state.providers, provider.id)
  if (!cloud) {
    console.warn('[agent/route] 本地不可用且没有可用的云 provider：', reply.plan.reason)
    return provider
  }
  // 自动换路必须说出来：界面上还选着本地模型，实际却发给了云端，静默切换等于骗用户
  console.info('[agent/route] 本地不可用，本轮走云兜底：', reply.plan.reason)
  toast.info(`本机模型不可用（${reply.plan.reason || '连接失败'}），本轮改用 ${cloud.name}`)
  return cloud
}

function findProviderByID(providerID: string): AgentProvider | null {
  return (
    useProviderStore.getState().providers.find(function (provider) {
      return provider.id === providerID
    }) ?? null
  )
}

/** 本轮要发的文本：最后一条用户消息；system 走 goose 的 system-prompt 扩展位 */
function parseRunMessages(messages: readonly ChatRunMessage[]): {
  text: string
  systemText?: string
  attachments: readonly string[]
} {
  let text = ''
  let systemText: string | undefined
  let attachments: readonly string[] = []
  for (const message of messages) {
    if (message.role === 'system' && !systemText && message.content.trim()) {
      systemText = message.content
      continue
    }
    if (message.role === 'user') {
      if (message.content.trim()) text = message.content
      if (message.attachments && message.attachments.length > 0) attachments = message.attachments
    }
  }
  return systemText ? { text, systemText, attachments } : { text, attachments }
}

/** 把 @ 附件名单内联进 prompt，避免静默丢弃（goose ACP 本轮只收文本块） */
function appendAttachments(text: string, attachments: readonly string[]): string {
  if (attachments.length === 0) return text
  const list = attachments
    .map(function (path) {
      return `- ${path}`
    })
    .join('\n')
  const note = `（用户引用了以下文件，请结合工作区读取内容：\n${list}）`
  return text.trim() ? `${text}\n\n${note}` : note
}

/**
 * 图片：goose ACP 的 prompt 只收文本块，图片暂按「附件名单」提示模型去找文件。
 * 这不是最终形态（PR5 会带上真正的多模态块），但比静默丢掉用户贴的图要好。
 */
function appendImages(text: string, images: readonly ChatImage[] | undefined): string {
  if (!images || images.length === 0) return text
  return `${text}\n\n（用户随消息附带了 ${images.length} 张图片，当前链路尚未支持直接读图）`
}

/**
 * 块归组：同一个 `messageId` 的增量归一段；没有 `messageId` 时全轮共用一段 —— ACP 只在
 * 换 `messageId` 时才表示「新的一段」，凭空断开会让一段话被拆成好几块。
 */
function makeBlockIDFinder(): AcpStreamContext['blockID'] {
  return function (messageId, kind) {
    return messageId ? `${kind}:${messageId}` : `${kind}:run`
  }
}

/**
 * 用量账本随 `agent_usage` 落地（PR4 最后一刀）。这里**不编造数字**：
 * ACP 的 `usage_update` 报的是上下文窗口占用，不是本次运行的 token 账。
 */
const RUN_USAGE: ChatUsage = {}

/**
 * 轮次正常结束时的场景副作用：**按场景取值 → 映射表**，不再堆 `if (scenario === 'x')`。
 *
 * 表里只放真有收尾动作的场景；其余场景落空即无副作用。新增场景直接往这里加一行。
 */
const SCENARIO_FINISH: Partial<
  Record<ScenarioKey, (capturedText: string, host: AgentRunHost) => void>
> = {
  /** 指令：把正文里的 JSON 抽成草稿（不落 corex.db） */
  directive(capturedText, host) {
    void captureDirectiveDraft(capturedText, {
      threadID: host.threadID,
      workspaceID: host.workspaceID
    }).catch(function (error) {
      reportCaught('agent.port.captureDirectiveDraft', error, 'warning')
    })
  },
  /** 日程：把 {"events":[...]} 变成预览行（写入要用户点确认） */
  plan(capturedText) {
    const rows = parseSchedulePlan(capturedText)
    if (rows.length > 0) useScheduleDraftStore.getState().writeRows(rows)
  }
}

/** DEV 下的事件摘要（只影响控制台噪音，不进生产包） */
function describeStreamEvent(event: ChatStreamEvent): string {
  if (event.kind === 'text' || event.kind === 'reasoning') {
    return `${event.kind}(+${event.text.length})`
  }
  if (event.kind === 'tool-call') return `tool-call:${event.toolName}`
  if (event.kind === 'tool-result') return `tool-result:${event.toolCallId}`
  return event.kind
}

/** 判别联合穷尽性检查：ACP 新增 item 类型时这里编译报错，而不是静默丢弃 */
function assertNeverRunItem(item: never): never {
  throw new Error(`[agent/port] 未处理的 RunItem 类型: ${JSON.stringify(item)}`)
}

function buildModelPort(overrides: ModelPortOverrides = {}): ChatModelPort {
  return {
    /**
     * 端口契约是 Promise，解析本身是同步的（provider/model 都在本地 store 里）；
     * 唯一的异步点是分层路由的本地探测（S11），本地不可用时这里就换成云 provider。
     */
    async findTarget(): Promise<ChatTarget | null> {
      const provider = await findRoutedProvider()
      if (!provider) return null
      const model = findActiveModel(provider)
      if (!model) return null
      // providerID 用**本地行 id**：`agent_session.providerID` 存的就是它（会话归属要能在
      // 本地库里对上），goose 的 providerId（`kind`）在发起运行时再换算
      return Promise.resolve({ providerID: provider.id, model })
    },

    async *run(input, signal): AsyncIterable<ChatStreamEvent> {
      const host = findHost(input)
      const provider = findProviderByID(input.providerID)
      if (!provider) throw new Error('[agent/port] 选中的 provider 已不存在，请在设置里重新选择')
      if (!provider.enabled)
        throw new Error('[agent/port] 选中的 provider 已被停用，请在设置里启用')

      const parsed = parseRunMessages(input.messages)
      const visibleText = appendImages(
        appendAttachments(parsed.text, parsed.attachments),
        input.messages.at(-1)?.images
      )
      const text = overrides.findUserText ? overrides.findUserText(input, visibleText) : visibleText
      if (!text.trim()) {
        yield { kind: 'finish', finishReason: 'end_turn', usage: RUN_USAGE }
        return
      }

      // 场景系统提示：消息里已有 system 优先；否则按当前工作场景注入
      // Agent「计划」模式与 Scenario「日程 plan」互斥：前者要 Markdown 方案，后者要日历 JSON ——
      // 同时叠加会导致右栏计划常空，故计划模式下把日历场景降级为 general 基座。
      const activeScenario = findActiveScenario()
      // 本轮的模式**认消息快照**：重新生成复现「当初那一次」的选择，而不是现在选中的那个；
      // 老数据（没有快照）才回落会话偏好 —— 顺序由 `resolveRunMode` 固定。
      const runMode = resolveRunMode(input.messages)
      const promptScenario: ScenarioKey =
        runMode === 'plan' && activeScenario === 'plan' ? 'general' : activeScenario
      const baseSystemText =
        overrides.findSystemText?.(input) ??
        (parsed.systemText?.trim() ||
          (await buildSystemPrompt(promptScenario, buildPromptContext())))
      // 会话模式（执行/计划/问答/目标）只追加提示约束，不改审批档
      const systemText = appendModeGuidance(baseSystemText, runMode)

      // 平台网关发送前查一次配额（BYOK 直接放行）；拦到就当成一次「失败」发给 UI，
      // 用户点下发送就能看到原因，不用等半截运行失败。判定失败一律放行 —— 守门的是服务端。
      const isGateway = isGatewayTarget(provider.kind)
      const blocker = await findSendBlocker({
        isGateway,
        modelID: input.model
      })
      if (blocker) {
        yield { kind: 'error', message: blocker, usage: RUN_USAGE }
        return
      }

      // 平台网关走 goose 的自定义 provider：发送前幂等注册；失败则中止并进事件流（不 Uncaught）
      if (isGateway) {
        try {
          await ensureCogitoProvider()
        } catch (error) {
          if (!isCogitoSoftFailure(error)) {
            reportCaught('agent.port.ensureCogitoProvider', error, 'warning')
          }
          // Tauri invoke 常 reject string，不能只认 Error
          const message =
            error instanceof Error
              ? error.message
              : typeof error === 'string' && error.trim()
                ? error
                : '组织模型未就绪，请稍后重试或改用个人模型'
          yield { kind: 'error', message, usage: RUN_USAGE }
          return
        }
      }

      const context: AcpStreamContext = { blockID: makeBlockIDFinder() }
      // directive 场景要把助手正文攒起来，收尾时抽 JSON 落成草稿（不落 corex.db）
      // Agent 计划模式跳过 Scenario plan 的日历 JSON 收尾
      const scenario: ScenarioKey | null = overrides.onFinish
        ? null
        : runMode === 'plan' && activeScenario === 'plan'
          ? null
          : activeScenario
      // 目标推进要在后台起后续轮次：把本轮用的 provider / 模型 / 工作区 / 场景记下来。
      // 场景必须一起记 —— 后台线程不在前台，读全局 `findActiveScenario()` 会拿到别的场景。
      rememberGoalTurnContext(host.threadID, {
        workspaceID: host.workspaceID,
        providerID: provider.kind,
        modelID: input.model,
        scenario: activeScenario
      })
      let capturedText = ''
      const isPlanModeRun = runMode === 'plan'
      // 目标模式发送即建 GoalRun（侧栏「目标推进」可带自定义 budget 覆盖）
      if (runMode === 'goal' && !readGoalRun(host.threadID)) {
        // 轮次是**每次发送**的输入项：取 composer 里当前选的那一档（默认 6）
        // objective 拆 summary（≤120 字，横幅）+ detail（原 prompt，续跑用），不再截断
        startGoalRun(
          host.threadID,
          { summary: text.slice(0, 120), detail: text },
          readNextGoalBudget(),
          text
        )
      }
      // 每轮都拿一次租约：它是「这一轮归谁推进」的唯一凭据（收尾单飞 + 崩溃自愈都据它判断）
      if (runMode === 'goal' && readGoalRun(host.threadID)) {
        beginGoalTurn(host.threadID)
      }

      try {
        // 后台回合：UI detach 不取消 goose；只有用户「停止」才走 cancel signal
        yield* consumeBackgroundTurn(host.threadID, signal, async function* (cancelSignal) {
          try {
            for await (const item of runThreadPrompt(host.threadID, {
              text,
              systemText,
              // cwd 认**本会话**的工作区：后台会话不能跟着全局指针漂
              workspaceID: host.workspaceID,
              // goose 的会话配置项认 providerId（行里的 `kind`），不是本地行 id
              providerID: provider.kind,
              modelID: input.model,
              signal: cancelSignal
            })) {
              switch (item.kind) {
                case 'update': {
                  const event = parseAcpStreamEvent(item.update, context)
                  if (event) {
                    if (event.kind === 'text') capturedText += event.text
                    if (import.meta.env.DEV) {
                      console.debug('[agent/stream]', describeStreamEvent(event))
                    }
                    yield event
                  }
                  break
                }
                case 'approval':
                case 'elicitation':
                  // 停下来等人：事件交给 UI，回执走 `respondToApproval` / `respondToElicitation`
                  void notifyApproval(host.threadID)
                  if (isPlanModeRun) {
                    yield {
                      kind: 'text',
                      blockID: 'plan-mode-hint',
                      text: '\n\n（计划模式禁止写操作：请在审批中拒绝写工具，或切到「执行」模式后再改。）\n'
                    }
                  }
                  yield item.event
                  break
                case 'stop':
                  // 每轮**只发一个终态**：取消不是错误（但也不是「说完」），其余按正常收尾
                  if (item.stopReason !== 'cancelled' && capturedText.trim()) {
                    if (overrides.onFinish) {
                      overrides.onFinish(capturedText, host)
                    } else if (scenario) {
                      SCENARIO_FINISH[scenario]?.(capturedText, host)
                    }
                  }
                  yield item.stopReason === 'cancelled'
                    ? { kind: 'aborted', usage: RUN_USAGE }
                    : { kind: 'finish', finishReason: item.stopReason, usage: RUN_USAGE }
                  return
                default:
                  assertNeverRunItem(item)
              }
            }
          } catch (error) {
            // 异常也要走事件流（适配器要先交一份快照再抛，否则界面只剩 status 变了）；
            // 事件流之外再留一条带堆栈的控制台记录 —— 界面只拿得到一句话，排查得靠它
            reportCaught('agent.port.run', error)
            const message = error instanceof Error ? error.message : String(error)
            // 分层路由（S11）：只有本地 provider 的**可判定失败**才降级，且不阻塞收尾
            if (isLocalKind(provider.kind)) {
              void noteRunFailure({
                from: readRouteTier(),
                message,
                sessionID: host.threadID
              })
            }
            yield { kind: 'error', message, usage: RUN_USAGE }
          }
        })
      } catch (error) {
        reportCaught('agent.port.run.background', error)
        const message = error instanceof Error ? error.message : String(error)
        if (isLocalKind(provider.kind)) {
          void noteRunFailure({
            from: readRouteTier(),
            message,
            sessionID: host.threadID
          })
        }
        yield { kind: 'error', message, usage: RUN_USAGE }
      }
    },

    /**
     * 回执：返回 `false` 表示这次审批已经不在等待中（跑完了 / 工具已跑过）。
     * 如实上报而不是假报成功 —— UI 要据此把卡片收敛并提示用户重发。
     */
    respondToApproval(input: ChatToolApproval): boolean {
      return respondToApproval(input)
    },

    /**
     * 审批卡的实时状态：`'pending'` 等答复、`boolean` 已拍板、`null` 历史旧卡（已失效）。
     * 卡片靠它决定「还能不能点」，不依赖消息快照里那个可能过期的 `approved`。
     */
    findApprovalState(toolCallId: string): 'pending' | boolean | null {
      return findSessionApprovalState(toolCallId)
    },

    respondToElicitation(input: ChatElicitationResponse): boolean {
      return respondToElicitation(input)
    }
  }
}

export { buildModelPort }
export type { AgentRunHost, ModelPortOverrides }
