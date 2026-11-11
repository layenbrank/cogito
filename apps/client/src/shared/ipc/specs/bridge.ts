/**
 * `bridge:info` IPC 契约。
 *
 * app 启动时绑一个 127.0.0.1 的随机端口做本地工具桥；令牌**不再交给渲染进程**，
 * 而是由 Rust 进程写到 `<appLocalData>/bridge/token`（仅当前用户可读），
 * 前端把 `url / tokenFile / sessionHeader` 注入给 goose，让它拉起 `cogito-mcp`，
 * MCP 自己读文件取令牌。
 *
 * 调用时带上 `sessionID` 即完成会话登记（桥侧校验 `x-cogito-session`）。
 * `mcpPath` 为空串 = 没找到侧车（未 stage / 平台不支持），此时不要注入。
 */
import { z } from 'zod'

const BridgeInfoSchema = z.object({
  url: z.string(),
  tokenFile: z.string(),
  sessionHeader: z.string(),
  mcpPath: z.string()
})

type BridgeInfo = z.infer<typeof BridgeInfoSchema>

export { BridgeInfoSchema }
export type { BridgeInfo }
