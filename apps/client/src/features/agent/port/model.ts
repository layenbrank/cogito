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

import { ensureCogitoProvider } from '@/features/agent/acp/cogito-provider'
import { runThreadPrompt, respondToApproval, respondToElicitation } from '@/features/agent/acp/session'
import { parseAcpStreamEvent, type AcpStreamContext } from '@/features/agent/acp/stream'
import { parseModels } from '@/features/agent/model/providers'
import { findSendBlocker, isGatewayTarget } from '@/features/quota/gate'
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
    /** 端口契约是 Promise，但解析本身是同步的（provider/model 都在本地 store 里） */
    findTarget(): Promise<ChatTarget | null> {
      const provider = findActiveProvider()
      if (!provider) return Promise.resolve(null)
      const model = findActiveModel(provider)
      if (!model) return Promise.resolve(null)
      // providerID 用**本地行 id**：`agent_session.providerID` 存的就是它（会话归属要能在
      // 本地库里对上），goose 的 providerId（`kind`）在发起运行时再换算
      return Promise.resolve({ providerID: provider.id, model })
    },

    async *run(input, signal): AsyncIterable<ChatStreamEvent> {
      const host = findHost(input)
      const provider = findProviderByID(input.providerID)
      if (!provider) throw new Error('[agent/port] 选中的 provider 已不存在，请在设置里重新选择')
      if (!provider.enabled) throw new Error('[agent/port] 选中的 provider 已被停用，请在设置里启用')

      const parsed = parseRunMessages(input.messages)
      const text = appendImages(
        appendAttachments(parsed.text, parsed.attachments),
        input.messages.at(-1)?.images
      )
      if (!text.trim()) {
        yield { kind: 'finish', finishReason: 'end_turn', usage: RUN_USAGE }
        return
      }

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

      // 平台网关走 goose 的自定义 provider：发送前幂等注册；失败则中止，避免「找不到 provider」难排查
      if (isGateway) {
        try {
          await ensureCogitoProvider()
        } catch (error) {
          console.warn('[agent/port] 注册网关 provider 失败:', error)
          yield {
            kind: 'error',
            message: error instanceof Error ? error.message : '网关 provider 未就绪，请稍后重试',
            usage: RUN_USAGE
          }
          return
        }
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
