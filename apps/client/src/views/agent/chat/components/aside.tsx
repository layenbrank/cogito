/**
 * 右栏容器：空对话快捷卡 / 已对话分区骨架；可切到文件树与审阅对比。
 */
import { Icon } from '@iconify/react/offline'
import { useAui, useAuiState } from '@assistant-ui/react'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { useMemo, useState } from 'react'

import { AsideBusy } from './aside-busy'
import { AsideEmpty } from './aside-empty'
import { AsideFiles } from './aside-files'
import { AsideReview } from './aside-review'
import { TerminalSurface } from '@/features/terminal'
import type { PlanSnapshot } from '@/features/agent/plan'
import { useActiveWorkspace } from '@/features/agent/workspace/active'
import { useTerminalStore } from '@/stores/terminal'

type AsideMode = 'home' | 'files' | 'review'

interface AsideProps {
  className?: string
  plan: PlanSnapshot | null
  onClose: () => void
}

const MODE_TITLE: Record<AsideMode, string> = {
  home: '',
  files: '工作区文件',
  review: '审阅'
}

function AgentAside(props: AsideProps) {
  const aui = useAui()
  const messages = useAuiState(function (state) {
    return state.thread.messages
  })

  const terminalOpen = useTerminalStore(function (state) {
    return state.open
  })
  const { primaryPath } = useActiveWorkspace()

  const [mode, updateMode] = useState<AsideMode>('home')
  const [focusRelative, updateFocusRelative] = useState<string | null>(null)

  const hasUserMessage = useMemo(
    function () {
      return messages.some(function (message) {
        return message.role === 'user'
      })
    },
    [messages]
  )

  function openFiles(relative?: string | null) {
    updateFocusRelative(relative ?? null)
    updateMode('files')
  }

  function openReview(relative?: string | null) {
    updateFocusRelative(relative ?? null)
    updateMode('review')
  }

  function backHome() {
    updateFocusRelative(null)
    updateMode('home')
  }

  // 终端面板固定渲染在右栏；打开时整栏被终端面板接管（面板自带标题栏与关闭）。
  if (terminalOpen) {
    return (
      <div className={clsx('bg-background flex h-full min-h-0 flex-col', props.className)}>
        <TerminalSurface
          cwd={primaryPath}
          emptyCwdMessage="先在左栏添加一个工作区"
        />
      </div>
    )
  }

  const homeTitle = hasUserMessage ? '任务详情' : '快捷操作'
  const title = mode === 'home' ? homeTitle : MODE_TITLE[mode]

  return (
    <div className={clsx('bg-background flex h-full min-h-0 flex-col', props.className)}>
      <div className="border-border flex h-10 shrink-0 items-center justify-between gap-1 border-b px-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-0.5">
          {mode !== 'home' ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-region="false"
              aria-label="返回任务详情"
              title="返回"
              className="text-muted-foreground hover:text-foreground size-7"
              onClick={backHome}>
              <Icon
                icon="lucide:chevron-left"
                className="size-3.5"
              />
            </Button>
          ) : null}
          <span className="text-muted-foreground truncate px-1 text-xs font-medium">{title}</span>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-region="false"
            aria-label="工作区文件"
            title="工作区文件"
            className={clsx(
              'size-7',
              mode === 'files'
                ? 'text-foreground bg-muted'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={function () {
              openFiles()
            }}>
            <Icon
              icon="lucide:folder-tree"
              className="size-3.5"
            />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-region="false"
            aria-label="审阅对比"
            title="审阅对比"
            className={clsx(
              'size-7',
              mode === 'review'
                ? 'text-foreground bg-muted'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={function () {
              openReview()
            }}>
            <Icon
              icon="lucide:git-compare"
              className="size-3.5"
            />
          </Button>
          {/* 收缩入口只在中栏 Head 的 panel-right；这里用 × 避免右侧出现两枚相同图标 */}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-region="false"
            aria-label="关闭右侧栏"
            title="关闭右侧栏"
            className="text-muted-foreground hover:text-foreground size-7"
            onClick={props.onClose}>
            <Icon
              icon="lucide:x"
              className="size-3.5"
            />
          </Button>
        </div>
      </div>

      {mode === 'files' ? (
        <AsideFiles
          aui={aui}
          initialRelative={focusRelative}
          onOpenReview={function (relative) {
            openReview(relative)
          }}
        />
      ) : null}

      {mode === 'review' ? <AsideReview initialRelative={focusRelative} /> : null}

      {mode === 'home' ? (
        hasUserMessage ? (
          <AsideBusy
            plan={props.plan}
            onOpenFiles={openFiles}
            onOpenReview={openReview}
          />
        ) : (
          <AsideEmpty
            onOpenFiles={openFiles}
            onOpenReview={openReview}
          />
        )
      ) : null}
    </div>
  )
}

export { AgentAside }
