/**
 * 子 agent（S10）：Rust 只做调度，真正跑一轮的在这里。
 *
 * 分工是刻意的：
 * - Rust 的任务板（`cogito_core::tools::agents`）负责**限流与边界** —— 同时最多 2 个、
 *   深度 ≤ 2、摘要 ≤ 2KB，模型改不了这些数；
 * - 渲染进程负责**跑**：ACP 连接在渲染侧，只有这儿能起会话、发 prompt、收流式更新。
 *
 * 收到 `agent://subagent-spawn` 之后做三件事：
 * 1) 用**父会话**的 provider / workspace 开一个可见的新会话（左栏能看到，跑完能点进去看）；
 * 2) 走后台回合泵跑一轮，工具审批**一律拒绝** —— 子任务不提权（没人盯着它点「同意」）；
 * 3) 把摘要回填给任务板（Rust 再截 2KB，这里不重复截）。
 *
 * 失败一律回填 `ok: false` + 原因：宁可让父 agent 看到「子任务失败」，
 * 也不要让一个任务永远停在 `queued` 让父 agent 干等。
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { v4 as UUIDV4 } from 'uuid'
import { z } from 'zod'

import {
  ensureBackgroundTurn,
  followBackgroundTurn
} from '@/features/agent/acp/background-turn'
import {
  respondToApproval,
  respondToElicitation,
  runThreadPrompt
} from '@/features/agent/acp/session'
import { parseAcpStreamEvent, type AcpStreamContext } from '@/features/agent/acp/stream'
import { buildPromptContext } from '@/features/agent/model/prompt-context'
import { buildSystemPrompt } from '@/features/agent/model/prompt-project'
import { CHANNELS, EVENTS } from '@/shared/ipc/channels'
import { useAgentStore } from '@/stores/agent'
import { useProviderStore } from '@/stores/provider'

/** 与 Rust `agents::MAX_DEPTH` 对齐：渲染侧再挡一次（第二道闸）。 */
export const MAX_DEPTH = 2

export const SubagentSpawnSchema = z.object({
  jobID: z.string().min(1),
  depth: z.number().int().nonnegative(),
  title: z.string(),
  prompt: z.string().min(1),
  cwd: z.string().nullish(),
  parentSession: z.string().nullish()
})

export type SubagentSpawn = z.infer<typeof SubagentSpawnSchema>

export interface SubagentReport {
  jobId: string
  ok: boolean
  summary?: string
  error?: string
  sessionId?: string
  cancelled?: boolean
}

/**
 * 三个外部依赖：测试里换掉就能验「成功 / 失败 / 越界」三条路，
 * 不用把 zustand store 和 ACP 连接一起拖进来。
 */
export interface SubagentPorts {
  createSession: (job: SubagentSpawn) => Promise<string>
  runTurn: (input: { threadID: string; job: SubagentSpawn }) => Promise<string>
  report: (report: SubagentReport) => Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 本地 provider 行 id → goose 认的 `kind`（与 `port/model` / 自动化 runner 同口径：
 * 会话里存 id，发起运行再换成 kind）。父会话没选过就落到当前默认供应商。
 */
function resolveProviderKind(localProviderID: string | null): string {
  const store = useProviderStore.getState()
  const target = localProviderID
    ? store.providers.find(function (item) {
        return item.id === localProviderID
      })
    : (store.providers.find(function (item) {
        return item.id === store.activeProviderID
      }) ?? store.providers[0])
  if (!target) throw new Error('没有可用的模型供应商，子任务无法启动')
  return target.kind
}

function threadTitle(job: SubagentSpawn): string {
  const title = job.title.trim()
  if (title) return title
  return job.prompt.trim().slice(0, 24) || '子任务'
}

/** 新会话挂在父会话的工作区下：左栏归拢一致，跑完用户能直接点进去看 */
async function createSubagentSession(job: SubagentSpawn): Promise<string> {
  const store = useAgentStore.getState()
  const parent = job.parentSession
    ? store.sessions.find(function (session) {
        return session.id === job.parentSession
      })
    : undefined
  const now = Date.now()
  const id = UUIDV4()
  await store.toWriteSession([
    {
      id,
      title: threadTitle(job),
      pinned: false,
      providerID: parent?.providerID ?? null,
      workspaceID: parent?.workspaceID ?? store.activeWorkspaceID,
      createdAt: now,
      updatedAt: now,
      unread: false
    }
  ])
  return id
}

/** 跑一轮子任务：复用后台回合泵（与自动化的无头回合同源） */
async function runSubagentTurn(input: {
  threadID: string
  job: SubagentSpawn
}): Promise<string> {
  const { threadID, job } = input
  const store = useAgentStore.getState()
  const parent = job.parentSession
    ? store.sessions.find(function (session) {
        return session.id === job.parentSession
      })
    : undefined
  const workspaceID = parent?.workspaceID ?? store.activeWorkspaceID
  const cwd = job.cwd ?? null
  const providerID = resolveProviderKind(parent?.providerID ?? null)
  const systemText = await buildSystemPrompt('general', buildPromptContext(), { cwd })
  const streamContext: AcpStreamContext = {
    blockID: function (messageId, kind) {
      return messageId ? `${kind}:${messageId}` : `${kind}:subagent`
    }
  }

  async function* start(signal: AbortSignal) {
    for await (const item of runThreadPrompt(threadID, {
      text: job.prompt,
      systemText,
      workspaceID,
      cwd,
      providerID,
      signal
    })) {
      if (item.kind === 'update') {
        const event = parseAcpStreamEvent(item.update, streamContext)
        if (event) yield event
        continue
      }
      // 子任务没人盯着：审批一律拒绝，追问一律取消 —— 这就是「不提权」的落点
      if (item.kind === 'approval') {
        if (item.event.kind === 'tool-approval-request') {
          respondToApproval({ toolCallId: item.event.toolCallId, approved: false })
        }
        continue
      }
      if (item.kind === 'elicitation') {
        if (item.event.kind === 'elicitation-request') {
          respondToElicitation({ elicitationId: item.event.elicitationId, action: 'cancel' })
        }
        continue
      }
      if (item.kind === 'stop') {
        yield item.stopReason === 'cancelled'
          ? { kind: 'aborted' as const, usage: {} }
          : { kind: 'finish' as const, finishReason: item.stopReason, usage: {} }
        return
      }
    }
  }

  await ensureBackgroundTurn(threadID, start)
  let content = ''
  for await (const event of followBackgroundTurn(threadID, undefined)) {
    if (event.kind === 'text') content += event.text
    if (event.kind === 'error') throw new Error(event.message)
  }
  return content
}

/** 默认依赖：真实会话、真实回合、真实回填 */
export const defaultPorts: SubagentPorts = {
  createSession: createSubagentSession,
  runTurn: runSubagentTurn,
  report: function (report) {
    return invoke(CHANNELS.AGENT_SUBAGENT.RESULT, {
      report: {
        jobId: report.jobId,
        ok: report.ok,
        summary: report.summary,
        error: report.error,
        sessionId: report.sessionId,
        cancelled: report.cancelled ?? false
      }
    }).then(function () {
      return undefined
    })
  }
}

/**
 * 处理一条派发事件。返回是否有任务被接手（便于测试与日志）。
 *
 * 注意 `report` 自身失败只 warn：任务板那边超时会兜底，这里再抛只会丢掉错误现场。
 */
export async function handleSpawn(
  payload: unknown,
  ports: SubagentPorts = defaultPorts
): Promise<boolean> {
  const parsed = SubagentSpawnSchema.safeParse(payload)
  if (!parsed.success) {
    console.warn('[agent/subagent] 派发事件不合法，忽略:', parsed.error.message)
    return false
  }
  const job = parsed.data
  if (job.depth > MAX_DEPTH) {
    // Rust 已经挡过；这里再挡一次是因为「少一层保护就少一条边界」
    await ports
      .report({
        jobId: job.jobID,
        ok: false,
        error: `子任务最多 ${MAX_DEPTH} 层（收到 depth=${job.depth}）`
      })
      .catch(function (error: unknown) {
        console.warn('[agent/subagent] 回填越界失败:', error)
      })
    return true
  }
  let sessionId: string | undefined
  try {
    sessionId = await ports.createSession(job)
    const summary = await ports.runTurn({ threadID: sessionId, job })
    await ports.report({ jobId: job.jobID, ok: true, summary, sessionId })
    return true
  } catch (error) {
    console.warn('[agent/subagent] 子任务失败:', job.jobID, error)
    await ports
      .report({ jobId: job.jobID, ok: false, error: errorMessage(error), sessionId })
      .catch(function (reportError: unknown) {
        console.warn('[agent/subagent] 回填失败:', reportError)
      })
    return true
  }
}

/** 启动时挂上事件监听（幂等：重复调用返回同一个 unlisten 语义）。 */
export async function installSubagentRunner(
  ports: SubagentPorts = defaultPorts
): Promise<UnlistenFn> {
  return listen(EVENTS.AGENT_SUBAGENT_SPAWN, function (event) {
    void handleSpawn(event.payload, ports)
  })
}
