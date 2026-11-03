/**
 * 「当前文件夹」切换条 —— 视觉与文件树顶栏 `AsideFilesRoots` 同源：
 * Glide 横向滑 + 激活态 `ring-1` 卡片，不再用扁 chip。
 *
 * 默认读写全局「当前文件夹」；传 `value` / `onSelect` 则为受控（composer `+` 面板）。
 */
import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'
import { useLayoutEffect, useRef } from 'react'

import { Glide } from '@/components/glide/glide'
import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import {
  buildFolderLabels,
  findFolderLabel
} from '@/views/agent/chat/components/workspace-relative-path.ts'

interface WorkspaceFolderChipsProps {
  className?: string
  /** 受控高亮的文件夹；省略用全局「当前文件夹」 */
  value?: string | null
  /** 受控切换；省略时写全局「当前文件夹」 */
  onSelect?: (path: string) => void
  /** 切换后的额外动作（文件树要清空目录 / 预览） */
  onSwitch?: (path: string) => void
}

function WorkspaceFolderChips(props: WorkspaceFolderChipsProps) {
  const { rootPath, folders, selectRoot } = useActiveWorkspace()
  const activePath = props.value ?? rootPath
  const activeRef = useRef<HTMLButtonElement | null>(null)

  useLayoutEffect(
    function () {
      const node = activeRef.current
      if (!node) return
      node.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest'
      })
    },
    [activePath]
  )

  if (folders.length <= 1) return null

  /** 两个同名目录并排时靠上一级区分 */
  const labels = buildFolderLabels(
    folders.map(function (folder) {
      return folder.path
    })
  )

  function select(path: string) {
    if (path === activePath) return
    if (props.onSelect) props.onSelect(path)
    else selectRoot(path)
    props.onSwitch?.(path)
  }

  return (
    <div className={clsx('border-border shrink-0 border-b px-2.5 py-1.5', props.className)}>
      <Glide.X className="bg-muted/55 h-9 w-full rounded-lg">
        <div
          role="tablist"
          aria-label="工作区文件夹"
          className="flex w-max gap-0.5 px-1.5">
          {folders.map(function (folder, index) {
            const isActive = folder.path === activePath
            return (
              <button
                key={folder.id}
                ref={isActive ? activeRef : undefined}
                type="button"
                role="tab"
                aria-selected={isActive}
                title={folder.path}
                onClick={function () {
                  select(folder.path)
                }}
                className={clsx(
                  'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs leading-none transition-colors',
                  isActive
                    ? 'bg-background text-foreground shadow-sm ring-1 ring-border/70'
                    : 'text-muted-foreground hover:bg-background/55 hover:text-foreground'
                )}>
                <Icon
                  icon={isActive ? 'lucide:folder-open' : 'lucide:folder'}
                  className={clsx(
                    'size-3.5 shrink-0',
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  )}
                />
                <span className="font-medium whitespace-nowrap">
                  {findFolderLabel(labels, folder.path)}
                </span>
                {index === 0 ? (
                  <span
                    className={clsx(
                      'ml-0.5 shrink-0 rounded px-1 py-px text-xs font-medium tracking-wide',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted-foreground/10 text-muted-foreground'
                    )}
                    title="工作区主文件夹：会话的工作目录，引用路径相对它；其他文件夹给绝对路径">
                    根
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </Glide.X>
    </div>
  )
}

export { WorkspaceFolderChips }
