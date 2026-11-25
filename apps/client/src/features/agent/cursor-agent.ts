/**
 * 本机 Cursor Agent CLI 供应商身份判定。
 *
 * 状态读取（`cursor-agent:status`）在 `@/apis/agent-runtime`，这里只保留「这条 provider 是不是
 * cursor-agent」这一条业务判断。
 */

/** goose 声明里两种写法都出现过：`cursor-agent` / `cursor_agent` */
function isCursorAgentProviderId(providerId: string): boolean {
  const id = providerId.trim().toLowerCase()
  return id === 'cursor-agent' || id === 'cursor_agent'
}

export { isCursorAgentProviderId }
