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
} from '@i-thinking/chat/ports'

import { runThreadPrompt, respondToApproval, respondToElicitation } from '@/features/agent/acp/session'
import { parseAcpStreamEvent, type AcpStreamContext } from '@/features/agent/acp/stream'
import { parseModels } from '@/features/agent/model/providers'
import { useProviderStore, type AgentProvider } from '@/stores/provider'

/** 宿主扩展：本轮运行要用哪个会话（thread = 本地会话行） */
interface AgentRunHost {
  threadID: string
  workspaceID: string | null
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

function findProviderByID(providerID: string): AgentProvider | null {
  return (
    useProviderStore
      .getState()
      .providers.find(function (provider) {
        return provider.id === providerID
      }) ?? null
  )
}

/** 本轮要发的文本：最后一条用户消息；system 走 goose 的 system-prompt 扩展位 */
function parseRunMessages(messages: readonly ChatRunMessage[]): { text: string; systemText?: string } {
  let text = ''
  let systemText: string | undefined
  for (const message of messages) {
    if (message.role === 'system' && !systemText && message.content.trim()) {
      systemText = message.content
      continue
    }
    if (message.role === 'user' && message.content.trim()) text = message.content
  }
  return systemText ? { text, systemText } : { text }
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
function createBlockIDFinder(): AcpStreamContext['blockID'] {
  return function (messageId, kind) {
    return messageId ? `${kind}:${messageId}` : `${kind}:run`
  }
}

/**
 * 用量账本随 `agent_usage` 落地（PR4 最后一刀）。这里**不编造数字**：
 * ACP 的 `usage_update` 报的是上下文窗口占用，不是本次运行的 token 账。
 */
const RUN_USAGE: ChatUsage = {}

function createModelPort(): ChatModelPort {
  return {
    async findTarget(): Promise<ChatTarget | null> {
      const provider = findActiveProvider()
      if (!provider) return null
      const model = findActiveModel(provider)
      if (!model) return null
      // providerID 用**本地行 id**：`agent_session.providerID` 存的就是它（会话归属要能在
      // 本地库里对上），goose 的 providerId（`kind`）在发起运行时再换算
      return { providerID: provider.id, model }
    },

    async *run(input, signal): AsyncIterable<ChatStreamEvent> {
      const host = findHost(input)
      const provider = findProviderByID(input.providerID)
      if (!provider) throw new Error('[agent/port] 选中的 provider 已不存在，请在设置里重新选择')
      if (!provider.enabled) throw new Error('[agent/port] 选中的 provider 已被停用，请在设置里启用')

      const parsed = parseRunMessages(input.messages)
      const text = appendImages(parsed.text, input.messages.at(-1)?.images)
      if (!text.trim()) {
        yield { kind: 'finish', finishReason: 'end_turn', usage: RUN_USAGE }
        return
      }

      const context: AcpStreamContext = { blockID: createBlockIDFinder() }

      try {
        for await (const item of runThreadPrompt(host.threadID, {
          text,
          systemText: parsed.systemText,
          // goose 的会话配置项认 providerId（行里的 `kind`），不是本地行 id
          providerID: provider.kind,
          modelID: input.model,
          signal
        })) {
          switch (item.kind) {
            case 'update': {
              const event = parseAcpStreamEvent(item.update, context)
              if (event) yield event
              break
            }
            case 'approval':
            case 'elicitation':
              // 停下来等人：事件交给 UI，回执走 `respondToApproval` / `respondToElicitation`
              yield item.event
              break
            case 'stop':
              // 每轮**只发一个终态**：取消不是错误（但也不是「说完」），其余按正常收尾
              yield item.stopReason === 'cancelled'
                ? { kind: 'aborted', usage: RUN_USAGE }
                : { kind: 'finish', finishReason: item.stopReason, usage: RUN_USAGE }
              return
          }
        }
      } catch (error) {
        // 异常也要走事件流（适配器要先交一份快照再抛，否则界面只剩 status 变了）；
        // 事件流之外再留一条带堆栈的控制台记录 —— 界面只拿得到一句话，排查得靠它
        console.error('[agent/port] 运行失败:', error)
        yield {
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
          usage: RUN_USAGE
        }
      }
    },

    /**
     * 回执：返回 `false` 表示这次审批已经不在等待中（跑完了 / 工具已跑过）。
     * 如实上报而不是假报成功 —— UI 要据此把卡片收敛并提示用户重发。
     */
    respondToApproval(input: ChatToolApproval): boolean {
      return respondToApproval(input)
    },

    respondToElicitation(input: ChatElicitationResponse): boolean {
      return respondToElicitation(input)
    }
  }
}

export { createModelPort }
