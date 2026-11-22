/**
 * 对话页（整页 tab）：左会话栏 + 右对话区。
 *
 * 首版刻意只做**单栏**：client 的三栏（工作区 / 对话 / 右栏工作台）里，后两者依赖
 * 终端、内嵌浏览器、文件预览这些桌面能力，扩展里没有对应物。留白比摆一个永远空着的
 * 右栏更诚实。
 *
 * 页面还负责把「本机代理不可用」讲清楚：那是首版最常见的失败，必须给出可照做的下一步，
 * 而不是一句「连接失败」。
 */
import { Thread } from '@cogito/design/assistant/thread.aui'
import { ThreadList } from '@cogito/design/assistant/thread-list.aui'
import { Button } from '@cogito/design/components/button'
import { useAui } from '@assistant-ui/react'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import { findExecutor } from '@/features/agent/port/router.ts'
import { takePendingContext } from '@/features/page-context/pending.ts'

import { AgentChatRuntime } from './runtime.tsx'

/**
 * 执行者状态条。
 *
 * 三种状态三种话：桥可用（不提示）、云端兜底（**必须提示无工具**）、都不通（给出原因）。
 * 以前只在桥不可用时说「本机代理不可用」，而实际对话正靠云端正常工作 —— 那是在骗人。
 */
function BridgeBanner() {
  const query = useQuery({
    queryKey: ['agent-executor'],
    queryFn: function () {
      return findExecutor()
    },
    refetchInterval: 30_000
  })

  if (query.isPending || !query.data) return null
  const executor = query.data
  if (executor.kind === 'bridge') return null

  const isCloud = executor.kind === 'cloud'
  return (
    <div
      className={
        isCloud
          ? 'flex items-center gap-3 border-b border-sky-300/40 bg-sky-50 px-4 py-2 text-xs text-sky-900'
          : 'flex items-center gap-3 border-b border-amber-300/40 bg-amber-50 px-4 py-2 text-xs text-amber-900'
      }>
      <span className="min-w-0 flex-1">
        {isCloud ? `当前走${executor.detail}` : executor.detail}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-7 shrink-0 text-xs"
        onClick={function () {
          void query.refetch()
        }}>
        重新检测
      </Button>
    </div>
  )
}

/**
 * 把「右键问 Cogito」交接过来的选区填进输入框。
 *
 * 只填不自动发：由用户确认后再按发送 —— 右键一个手滑就替用户发了消息，是越界。
 */
function PendingContextBridge() {
  const aui = useAui()
  useEffect(
    function () {
      void takePendingContext().then(function (context) {
        if (!context) return
        aui.composer.setText(context.prompt, { origin: 'user' })
      })
    },
    [aui]
  )
  return null
}

function AgentChatView() {
  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <BridgeBanner />
      <AgentChatRuntime>
        <PendingContextBridge />
        <div className="flex min-h-0 flex-1">
          <aside className="w-60 shrink-0 border-r border-border">
            <ThreadList />
          </aside>
          <main className="min-w-0 flex-1">
            <Thread />
          </main>
        </div>
      </AgentChatRuntime>
    </div>
  )
}

export default AgentChatView
