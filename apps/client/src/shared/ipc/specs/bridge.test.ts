import { describe, expect, it } from 'vitest'

import { BridgeInfoSchema } from './bridge'

describe('BridgeInfoSchema（S2：令牌不出进程）', () => {
  it('接受 url / tokenFile / sessionHeader / mcpPath', () => {
    const parsed = BridgeInfoSchema.parse({
      url: 'http://127.0.0.1:51234',
      tokenFile: 'C:\\Users\\me\\AppData\\Local\\com.cogito.client\\bridge\\token',
      sessionHeader: 'x-cogito-session',
      mcpPath: 'C:\\app\\cogito-mcp.exe'
    })
    expect(parsed.tokenFile).toContain('bridge')
    expect(parsed).not.toHaveProperty('token')
  })

  it('拒绝旧契约（只有明文 token、没有 tokenFile）', () => {
    const result = BridgeInfoSchema.safeParse({
      url: 'http://127.0.0.1:51234',
      token: 'plain-secret',
      mcpPath: 'C:\\app\\cogito-mcp.exe'
    })
    expect(result.success).toBe(false)
  })
})
