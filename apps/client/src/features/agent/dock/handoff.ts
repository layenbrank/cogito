/**
 * 升级到完整会话（dock 的逃生口）。
 *
 * 只在用户明确要「去聊天页继续」时才走：dock 本身已经能多轮，这里不做默认路径。
 * 交接方式是**一句话 + 场景**，聊天页按新会话消费一次。
 */
import { toast } from 'sonner'

import { setChatHandoff } from '@/features/agent/model/chat-handoff'
import { reportCaught } from '@/utils/exception-report'

function toFullChat(text: string): void {
  const trimmed = text.trim()
  if (!trimmed) return
  setChatHandoff({ text: trimmed, scenario: 'general' })
  // 动态 import：routers 会拉起整棵页面树，dock 不该在模块初始化时就把它带进来
  void import('@/routers')
    .then(function (module) {
      void module.router.navigate('/agent/chat')
    })
    .catch(function (error) {
      // 跳不成也要说一声：用户点的是「去完整会话」，静默不动等于什么都没发生
      reportCaught('agent.dock.handoff', error, 'warning')
      toast.error('打开完整会话失败，请手动切到聊天页')
    })
}

export { toFullChat }
