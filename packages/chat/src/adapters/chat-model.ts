import type {
  ChatModelAdapter,
  ChatModelRunResult,
  ThreadAssistantMessagePart,
  ThreadMessage,
  ToolCallMessagePartStatus
} from '@assistant-ui/react'

import type {
  ChatElicitationSchema,
  ChatModelPort,
  ChatPlanEntry,
  ChatRunMessage,
  ChatTarget,
  ChatUsage
} from '../ports'

/**
 * 模型适配器：把 `ChatModelPort` 的事件流聚合成 assistant-ui 需要的**快照**。
 *
 * runtime 期望的是"当前完整内容"而不是增量，所以每个事件后推一份累计快照；
 * 中止（`abortSignal`）由端口实现负责打断底层请求。
 *
 * 工具调用（P2）：`tool-call` 变成 content 里的 tool-call part，
 * `tool-approval-request` 把它标成 `requires-action`（UI 拿到 `approval` 后决定放行/拒绝），
 * `tool-result` 回填结果并收束为 `complete`。
 *
 * **part 的次序 = 事件到达的次序**：界面按 part 顺序渲染，所以一轮里的
 * 「思考 → 工具 → 正文」不能按类型归堆 —— 归堆会把工具调用挪到回答下方，
 * 看上去像是"先给了结论才去读文件"（见 `createContentAccumulator`）。
 */

/** 取消息里的纯文本（发给模型的上下文；工具 part 由宿主执行、不参与重放） */
function collectText(message: ThreadMessage): string {
  return message.content
    .filter(function (part) {
      return part.type === 'text'
    })
    .map(function (part) {
      return part.text
    })
    .join('\n')
    .trim()
}
/** 工具调用的累积状态：事件流是增量的，part 是快照，这里负责把前者拼成后者 */
interface ToolAccumulator {
  toolCallId: string
  toolName: string
  args: unknown
  argsText: string
  result?: unknown
  isError?: boolean
  /** 有待用户决定的审批时存在；`approved === undefined` 表示尚未拍板 */
  approval?: NonNullable<Extract<ThreadAssistantMessagePart, { type: 'tool-call' }>['approval']>
}

type ToolPart = Extract<ThreadAssistantMessagePart, { type: 'tool-call' }>

function toToolStatus(tool: ToolAccumulator): ToolCallMessagePartStatus {
  if (tool.approval && tool.approval.approved === undefined) {
    return { type: 'requires-action', reason: 'tool-calls' }
  }
  if (tool.isError) {
    return { type: 'incomplete', reason: 'tool-calls' }
  }
  return tool.result === undefined ? { type: 'running' } : { type: 'complete' }
}

function toToolPart(tool: ToolAccumulator): ToolPart {
  return {
    type: 'tool-call',
    toolCallId: tool.toolCallId,
    toolName: tool.toolName,
    args: tool.args,
    argsText: tool.argsText,
    status: toToolStatus(tool),
    ...(tool.result === undefined ? {} : { result: tool.result }),
    ...(tool.isError === undefined ? {} : { isError: tool.isError }),
    ...(tool.approval === undefined ? {} : { approval: tool.approval })
  } as ToolPart
}

function toRunMessages(messages: readonly ThreadMessage[]): ChatRunMessage[] {
  const runs: ChatRunMessage[] = []

  for (const message of messages) {
    // 正在生成的占位消息不参与下一轮上下文
    if (message.status?.type === 'running') continue

    const content = collectText(message)
    const attachments = collectAttachments(message)
    const images = collectImages(message)
    if (!content && attachments.length === 0 && images.length === 0) continue

    runs.push({
      role: message.role,
      content,
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(images.length > 0 ? { images } : {})
    })
  }
  return runs
}

/**
 * 工作区引用名单：只有 file part（相对路径，内容为空）。
 * 图片不进这份名单，否则文件名会被当成 fs_read 路径。
 */
function collectAttachments(message: ThreadMessage): string[] {
  const names: string[] = []
  for (const part of message.content) {
    if (part.type !== 'file') continue
    if (!part.filename) continue
    if (names.includes(part.filename)) continue
    names.push(part.filename)
  }
  return names
}

function mediaTypeOf(dataUrl: string): string {
  const match = /^data:([^;,]+)/.exec(dataUrl)
  return match?.[1] || 'image/png'
}

/** 用户消息里的图片 data URL。非 data URL（空引用）不算图片内容 */
function collectImages(message: ThreadMessage): { mediaType: string; data: string }[] {
  if (message.role !== 'user') return []

  const images: { mediaType: string; data: string }[] = []
  for (const part of message.content) {
    if (part.type !== 'image') continue
    if (!part.image.startsWith('data:')) continue
    images.push({ mediaType: mediaTypeOf(part.image), data: part.image })
  }
  return images
}

/**
 * 内容块。事件流是增量的，而 part 是快照 —— 块的先后**必须就是事件的先后**：
 * assistant-ui 按 part 的次序分组渲染（`MessagePrimitive.GroupedParts`），
 * 按类型归堆会把工具调用挪到回答下方，用户看到的时序就反了（"先给结论，才跑的工具"）。
 */
type StreamBlock =
  | { type: 'text' | 'reasoning'; blockID: string; text: string }
  | { type: 'tool'; tool: ToolAccumulator }
  /** 计划：ACP 每次给全量，所以只占一块、原地替换 */
  | { type: 'plan'; entries: readonly ChatPlanEntry[] }
  /** 结构化追问：一次追问一块，位置固定在它出现那一瞬 */
  | {
      type: 'elicitation'
      elicitationId: string
      schema: ChatElicitationSchema
      prompt?: string
    }

/** data part 名：UI 按名字分派渲染（计划列表 / 追问表单），两端都得从这里取 */
const PLAN_PART_NAME = 'plan'
const ELICITATION_PART_NAME = 'elicitation'

/** 上面两个 data part 的载荷形状（UI 侧用它做类型收窄） */
interface ChatPlanPartData {
  entries: readonly ChatPlanEntry[]
}

interface ChatElicitationPartData {
  elicitationId: string
  schema: ChatElicitationSchema
  prompt?: string
}

/**
 * 累积器：
 * - 文本 / 推理：`blockID` 相同**且紧邻**的增量接在同一块上（换块、或中间插了工具就另起一块）
 * - 工具调用：占它出现那一刻的位置，结果 / 审批回来时**原地**回填，不重新排序
 */
function createContentAccumulator() {
  const blocks: StreamBlock[] = []
  /** 工具调用 id → 在 `blocks` 里的下标：回填要原地改 */
  const toolIndices = new Map<string, number>()
  /** 计划块下标：整份替换，不追加 */
  let planIndex: number | null = null
  /** 追问 id → 下标：同一次追问重复到达就原地更新，不叠卡 */
  const elicitationIndices = new Map<string, number>()

  function appendBlock(kind: 'text' | 'reasoning', blockID: string, text: string): void {
    // 空增量不建块：块的位置就是 part 的位置，建了又不出现在快照里会让后面的下标白挪
    if (!text) return

    const last = blocks[blocks.length - 1]
    if (last && last.type !== 'tool' && last.type === kind && last.blockID === blockID) {
      last.text += text
      return
    }
    blocks.push({ type: kind, blockID, text })
  }

  /** 更新工具块；`build` 返回 null 表示保持原样（没建过就什么都不做） */
  function updateTool(
    toolCallId: string,
    build: (previous: ToolAccumulator | undefined) => ToolAccumulator | null
  ): void {
    const index = toolIndices.get(toolCallId)
    const indexed = index === undefined ? undefined : blocks[index]
    const next = build(indexed?.type === 'tool' ? indexed.tool : undefined)
    if (next === null) return

    if (index === undefined) {
      toolIndices.set(toolCallId, blocks.length)
      blocks.push({ type: 'tool', tool: next })
      return
    }
    blocks[index] = { type: 'tool', tool: next }
  }

  /** 计划：整份替换（位置停在第一次出现处） */
  function setPlan(entries: readonly ChatPlanEntry[]): void {
    const block: StreamBlock = { type: 'plan', entries }
    if (planIndex === null) {
      planIndex = blocks.length
      blocks.push(block)
      return
    }
    blocks[planIndex] = block
  }

  /** 追问：一次一块，占它出现那一刻的位置 */
  function addElicitation(input: ChatElicitationPartData): void {
    const block: StreamBlock = { type: 'elicitation', ...input }
    const index = elicitationIndices.get(input.elicitationId)
    if (index === undefined) {
      elicitationIndices.set(input.elicitationId, blocks.length)
      blocks.push(block)
      return
    }
    blocks[index] = block
  }

  /** 快照：一个字都没吐过的块不进 parts */
  function parts(): ThreadAssistantMessagePart[] {
    const result: ThreadAssistantMessagePart[] = []
    for (const block of blocks) {
      if (block.type === 'tool') {
        result.push(toToolPart(block.tool))
        continue
      }
      if (block.type === 'plan') {
        result.push({
          type: 'data',
          name: PLAN_PART_NAME,
          data: { entries: block.entries } satisfies ChatPlanPartData
        })
        continue
      }
      if (block.type === 'elicitation') {
        result.push({
          type: 'data',
          name: ELICITATION_PART_NAME,
          data: {
            elicitationId: block.elicitationId,
            schema: block.schema,
            ...(block.prompt ? { prompt: block.prompt } : {})
          } satisfies ChatElicitationPartData
        })
        continue
      }
      if (!block.text) continue
      const text = block.text
      result.push(block.type === 'reasoning' ? { type: 'reasoning', text } : { type: 'text', text })
    }
    return result
  }

  return { appendBlock, updateTool, setPlan, addElicitation, parts }
}

function toStatus(finishReason: string): ChatModelRunResult['status'] {
  return finishReason === 'length'
    ? { type: 'incomplete', reason: 'length' }
    : { type: 'complete', reason: 'stop' }
}

/** 用量随消息快照落进 `metadata.custom`（历史适配器按它持久化，界面也读它） */
function toCustom(usage: ChatUsage | undefined): Record<string, unknown> {
  return usage ? { usage } : {}
}

/** 适配器可选项：宿主扩展（模型能力 / 审批策略 / 沙箱根）由 app 提供，每次运行现读 */
interface ChatModelAdapterOptions {
  /**
   * 现读本次运行的宿主扩展。入参是刚解析出的运行目标 —— 实现方不必再去猜「当前用的是哪个
   * 模型」：两个会话并发跑时，「当前」这种写法必然把后一个的模型读给前一个。
   *
   * 允许异步：会话 id 要落库后才存在（新建线程要先 initialize），同步读可能拿到旧快照，
   * 而运行必须带着权威会话 id —— 主进程按它记 `studio 线程 → opencode 会话` 的映射。
   */
  findHost?: (target: ChatTarget) => Record<string, unknown> | Promise<Record<string, unknown>>
}

function createChatModelAdapter(
  port: ChatModelPort,
  options: ChatModelAdapterOptions = {}
): ChatModelAdapter {
  return {
    async *run(runOptions) {
      const target = await port.findTarget()
      if (!target) throw new Error('[CHAT] 没有可用的模型：请先在设置里添加或启用一个 provider')

      const messages = toRunMessages(runOptions.messages)
      if (messages.length === 0) throw new Error('[CHAT] 没有可发送的消息')

      const host = (await options.findHost?.(target)) ?? {}
      const extras = Object.keys(host).length > 0 ? { host } : {}
      const input = { ...target, messages, ...extras }

      const content = createContentAccumulator()

      for await (const event of port.run(input, runOptions.abortSignal)) {
        switch (event.kind) {
          case 'text':
            content.appendBlock('text', event.blockID, event.text)
            break
          case 'reasoning':
            content.appendBlock('reasoning', event.blockID, event.text)
            break
          case 'tool-call':
            content.updateTool(event.toolCallId, function () {
              return {
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args: event.input,
                argsText: JSON.stringify(event.input ?? {})
              }
            })
            break
          case 'tool-approval-request':
            content.updateTool(event.toolCallId, function (previous) {
              return {
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args: event.input,
                argsText: JSON.stringify(event.input ?? {}),
                ...previous,
                approval: {
                  id: event.toolCallId,
                  ...(event.prompt ? { prompt: event.prompt } : {}),
                  // 选项形状与 assistant-ui 的一致（id / kind / label），直接透传
                  ...(event.options && event.options.length > 0 ? { options: event.options } : {})
                }
              }
            })
            break
          case 'plan':
            content.setPlan(event.entries)
            break
          case 'elicitation-request':
            content.addElicitation({
              elicitationId: event.elicitationId,
              schema: event.schema,
              ...(event.prompt ? { prompt: event.prompt } : {})
            })
            break
          case 'mode-update':
          case 'commands-update':
            // 会话级状态（当前模式 / 命令名单）不属于消息内容，由会话控制器消费，
            // 不必刷新消息快照
            continue
          case 'tool-result':
            content.updateTool(event.toolCallId, function (previous) {
              return {
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args: previous?.args ?? null,
                argsText: previous?.argsText ?? '',
                ...previous,
                result: event.output,
                isError: event.isError === true,
                approval: previous?.approval
                  ? { ...previous.approval, approved: event.isError ? false : true }
                  : undefined
              }
            })
            break
          case 'tool-approval-failed':
            content.updateTool(event.toolCallId, function (previous) {
              // 回执没被受理（发起它的那次运行已经不在等待）：把这一项按失败收敛。
              // 不收敛的话卡片会永远停在「待审批」，用户以为点了没反应
              if (!previous) return null
              return { ...previous, result: event.message, isError: true, approval: undefined }
            })
            break
          case 'finish':
            yield {
              content: content.parts(),
              status: toStatus(event.finishReason),
              metadata: { custom: toCustom(event.usage) }
            }
            return
          case 'aborted':
            // 取消（或被新一轮取代）不是错误，但这一轮**已经烧掉的 token 是真的**。
            //
            // 局限说明（别把它当成可靠来源）：用户手动点停时 runtime 会在取到这一份快照之后
            // 先判 `abortSignal.aborted` 再把它丢掉（见 @assistant-ui/core 的
            // local-thread-runtime-core）；被服务端「取代」那种取消则会正常收下。
            // 真正的账在主进程的用量账本里（`engine.settle` 先记账再发终态）。
            yield {
              content: content.parts(),
              status: { type: 'incomplete', reason: 'cancelled' },
              metadata: { custom: toCustom(event.usage) }
            }
            return
          case 'error':
            // 报错前先交一份带用量的快照：runtime 的 catch 只改 status，不动这份 metadata。
            yield {
              content: content.parts(),
              metadata: { custom: toCustom(event.usage) }
            }
            throw new Error(event.message)
        }

        yield { content: content.parts() }
      }
    }
  }
}

export { createChatModelAdapter, ELICITATION_PART_NAME, PLAN_PART_NAME }
export type { ChatElicitationPartData, ChatModelAdapterOptions, ChatPlanPartData }
