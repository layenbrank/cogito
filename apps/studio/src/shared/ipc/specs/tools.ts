import { z } from 'zod'

import { ONLINE_TOOL_KEYS } from '@cogito/sidecar'

import type { ChannelOfDomain } from '@/shared/ipc/channels'
import { CHANNELS } from '@/shared/ipc/channels'
import type { ChannelSpec, PushChannelSpec } from '@/shared/ipc/spec'

/**
 * 可以在线下载的工具。
 *
 * 取值域来自契约包 `@cogito/sidecar`（= `tools.lock.json` 里标 `onDemand` 的那批
 * = `sidecar/manifest.json` 的 keys），不再在这里抄一份。它同时是**入参的取值域**
 * （install / remove 只认这几个），`z.enum` 才能把「拼错 key」在 IPC 边界上拦住
 * （以前只写 min(1)，错 key 要到主进程才报）。三处一致由 `catalog.test.ts` 守着。
 */
const TOOL_KEYS = ONLINE_TOOL_KEYS

const ToolKeySchema = z.enum(TOOL_KEYS)

type ToolKey = z.infer<typeof ToolKeySchema>

/**
 * 在线工具的契约（pandoc / ffmpeg / opencode）。
 *
 * `state` 把「有没有」分成四档，界面按它决定给什么按钮：
 * - `installed` 运行时下载的那份（用户自己下的，优先）
 * - `bundled`   随包内置（完整版；精简版不会出现）
 * - `missing`   当前平台有源但没装 —— 该显示「下载」
 * - `unsupported` 当前平台没有在线包（如 macOS）—— 只能说明，不给按钮
 */
const ToolStatusSchema = z.object({
  key: ToolKeySchema,
  label: z.string(),
  summary: z.string(),
  version: z.string(),
  state: z.enum(['installed', 'bundled', 'missing', 'unsupported']),
  /** 这份占多少字节；没装为 0 */
  bytes: z.number().int().nonnegative(),
  /** 落在哪；没装为空串 */
  path: z.string()
})

const ToolProgressSchema = z.object({
  key: ToolKeySchema,
  phase: z.enum(['download', 'extract']),
  received: z.number().nonnegative(),
  /** 服务端报的总长；没有（chunked）时为 0 */
  total: z.number().nonnegative()
})

export const toolsSpecs = {
  [CHANNELS.TOOL.READ]: { in: z.void(), out: z.array(ToolStatusSchema) },
  [CHANNELS.TOOL.INSTALL]: { in: z.object({ key: ToolKeySchema }), out: z.void() },
  [CHANNELS.TOOL.REMOVE]: { in: z.object({ key: ToolKeySchema }), out: z.void() }
} as const satisfies Record<
  Exclude<ChannelOfDomain<'tool'>, typeof CHANNELS.TOOL.PROGRESS>,
  ChannelSpec
>

export const toolsPushSpec = {
  [CHANNELS.TOOL.PROGRESS]: { out: ToolProgressSchema }
} as const satisfies Record<typeof CHANNELS.TOOL.PROGRESS, PushChannelSpec>

export { TOOL_KEYS, ToolKeySchema }
export type { ToolKey }
