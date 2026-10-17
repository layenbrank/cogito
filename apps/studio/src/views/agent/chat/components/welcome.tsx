import { useAui } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'

import { useActiveWorkspace } from '@/features/agent/workspace/client.ts'
import { useSessionID } from '@/features/chat/session.ts'

/**
 * 新会话欢迎页 —— 对齐 Qoder / client：只有标题与提示卡，不放「添加目录」主按钮。
 * 建工作区入口在左栏 `+`；输入框由 Thread 固定在底部。
 */

const SUGGESTIONS = [
  {
    icon: 'lucide:book-open',
    title: '读懂这个仓库',
    prompt: '概览一下当前工作区：主要模块、技术栈，以及程序的入口文件在哪。'
  },
  {
    icon: 'lucide:puzzle',
    title: '解释目录结构',
    prompt: '解释一下当前工作区的目录结构，每个顶层目录各自负责什么。'
  },
  {
    icon: 'lucide:list-todo',
    title: '收拢待办',
    prompt: '在当前工作区里找出所有 TODO 注释，按所在模块归类列出来。'
  }
]

/**
 * 打开一个老会话却没有消息可读时，别摆欢迎页 —— 那会让人以为这是个新会话，
 * 用户看到的就是「点了会话什么都没有」。成因是早期版本的会话身份缺失，
 * 历史写入被静默丢弃（见 `packages/chat/src/adapters/thread-history.ts` 的 `requireThreadID`），
 * 那批消息没能落库，且已无法找回。
 */
function NoHistoryNotice() {
  return (
    <div className="mb-2 flex w-full flex-col items-center gap-6 px-2 text-center">
      <div className="flex flex-col items-center gap-3">
        <span className="bg-muted text-muted-foreground inline-flex size-12 items-center justify-center rounded-lg">
          <Icon
            icon="lucide:history"
            className="size-6"
          />
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="text-foreground text-2xl leading-[1.35] font-semibold tracking-[-0.01em]">
            这个会话没有历史消息
          </h1>
          <p className="text-muted-foreground max-w-[36em] text-sm leading-[1.65] text-balance">
            它的消息没能保存下来，本地数据库里没有可读的记录，已经找不回来了。直接在这里继续说即可，
            新消息都会正常保存。
          </p>
        </div>
      </div>
    </div>
  )
}

export function ThreadWelcome() {
  // 有 remoteId = 这是从库里打开的老会话；新会话要等首条消息发出去才拿到这个 id
  const sessionID = useSessionID()

  return (
    <div className="flex w-full flex-col items-center">
      {sessionID ? <NoHistoryNotice /> : <ThreadGreeting />}
    </div>
  )
}

function ThreadGreeting() {
  const aui = useAui()
  const activeWorkspace = useActiveWorkspace()

  function handleSuggestion(prompt: string) {
    aui.composer.setText(prompt)
    aui.composer.send()
  }

  return (
    <div className="mb-2 flex w-full flex-col items-center gap-6 px-2 text-center">
      <div className="flex flex-col items-center gap-3">
        <span className="bg-primary/10 text-primary inline-flex size-12 items-center justify-center rounded-lg">
          <Icon
            icon="lucide:sparkles"
            className="size-6"
          />
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="text-foreground text-2xl leading-[1.35] font-semibold tracking-[-0.01em]">
            有什么可以帮你的？
          </h1>
          {activeWorkspace ? (
            <p className="text-muted-foreground text-sm leading-[1.65]">
              当前工作区{' '}
              <span className="text-foreground font-medium">{activeWorkspace.title}</span>
            </p>
          ) : (
            <p className="text-muted-foreground max-w-[36em] text-sm leading-[1.65] text-balance">
              在左栏添加工作区后，Agent 才能读写代码；不选也能先聊聊。
            </p>
          )}
        </div>
      </div>

      {activeWorkspace ? (
        <div className="flex w-full max-w-[880px] flex-col items-stretch gap-2.5 text-start">
          <p className="text-muted-foreground text-sm font-medium tracking-[0.02em]">可以试试</p>
          {/* 按中栏容器宽度折列，避免侧栏占宽后 sm 视口断点仍强行三列裁切 */}
          <div className="grid grid-cols-1 gap-3 @min-[36rem]:grid-cols-3">
            {SUGGESTIONS.map(function (item) {
              return (
                <button
                  key={item.title}
                  type="button"
                  className="border-border bg-background hover:border-primary/40 hover:bg-primary/5 flex flex-col items-start gap-2.5 rounded-lg border p-3.5 text-start transition-[border-color,background-color] duration-150"
                  onClick={function () {
                    handleSuggestion(item.prompt)
                  }}>
                  <span className="bg-muted text-muted-foreground inline-flex size-7 items-center justify-center rounded-md">
                    <Icon
                      icon={item.icon}
                      className="size-3.5"
                    />
                  </span>
                  <span className="text-foreground line-clamp-2 text-sm font-medium">
                    {item.title}
                  </span>
                  <span className="text-muted-foreground line-clamp-2 text-xs leading-snug">
                    {item.prompt}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
