/**
 * 升级到完整会话（dock 的逃生口）。
 *
 * 只在用户明确要「去聊天页继续」时才走：dock 本身已经能多轮，这里不做默认路径。
 * 交接方式是**一句话 + 场景**，聊天页按新会话消费一次（与「新建会话」同一条路）。
 */
import { setNextPrompt } from '@/features/agent/model/pending-prompt'

function toFullChat(text: string): void {
  const trimmed = text.trim()
  if (!trimmed) return
  setNextPrompt({ text: trimmed, scenario: 'general' })
  // 动态 import：routers 会拉起整棵页面树，dock 不该在模块初始化时就把它带进来
  void import('@/routers').then(function (module) {
    void module.router.navigate('/agent/chat')
  })
}

export { toFullChat }
