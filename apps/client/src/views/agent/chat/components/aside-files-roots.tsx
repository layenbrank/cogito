/**
 * 多根工作区：文件树顶部的根目录切换条。
 * 展示文件夹短名；溢出时用 Glide.X 横向滑。
 */
import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'
import { useLayoutEffect, useRef } from 'react'

import { Glide } from '@/components/glide/glide'
import type { WorkspaceFolder } from '@/stores/agent.ts'
import { findBaseName } from '@/views/agent/chat/components/workspace-relative-path.ts'

interface AsideFilesRootsProps {
  folders: readonly WorkspaceFolder[]
  activePath: string | null
  onSelect: (path: string) => void
}

function AsideFilesRoots(props: AsideFilesRootsProps) {
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
    [props.activePath]
  )

  if (props.folders.length <= 1) return null

  return (
    <div className="border-border shrink-0 border-b px-2.5 py-1.5">
      <Glide.X className="bg-muted/55 h-9 w-full rounded-lg">
        {/* padding-inline 跟内容一起滚，避免 Glide overflow 裁掉首尾描边 */}
        <div
          role="tablist"
          aria-label="工作区文件夹"
          className="flex w-max gap-0.5 px-1.5">
          {props.folders.map(function (folder, index) {
            const isActive = folder.path === props.activePath
            const name = findBaseName(folder.path)
            return (
              <button
                key={folder.id}
                ref={isActive ? activeRef : undefined}
                type="button"
                role="tab"
                aria-selected={isActive}
                title={folder.path}
                onClick={function () {
                  props.onSelect(folder.path)
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
                <span className="font-medium whitespace-nowrap">{name}</span>
                {index === 0 ? (
                  <span
                    className={clsx(
                      'ml-0.5 shrink-0 rounded px-1 py-px text-xs font-medium tracking-wide',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted-foreground/10 text-muted-foreground'
                    )}>
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

export { AsideFilesRoots }
