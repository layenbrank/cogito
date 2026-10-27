/**
 * `bridge:info` IPC 契约。
 *
 * app 启动时绑一个 127.0.0.1 的随机端口做本地工具桥（token 每次启动轮换）；
 * 前端把这里的 `url/token/mcpPath` 注入给 goose，让它拉起 `cogito-mcp`。
 *
 * `mcpPath` 为空串 = 没找到侧车（未 stage / 平台不支持），此时不要注入。
 */
import { z } from 'zod'

const BridgeInfoSchema = z.object({
  url: z.string(),
  token: z.string(),
  mcpPath: z.string()
})

type BridgeInfo = z.infer<typeof BridgeInfoSchema>

export { BridgeInfoSchema }
export type { BridgeInfo }
