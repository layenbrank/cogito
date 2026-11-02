/**
 * 「当前文件夹」切换 chips。
 *
 * 一个工作区挂多个目录时才出现；切换走 features/agent/workspace/active-root，
 * 所以文件树和审阅面板看到的是同一个文件夹。
 */
import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'

import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { findBaseName } from '@/views/agent/chat/components/workspace-relative-path.ts'

interface WorkspaceFolderChipsProps {
  className?: string
  /** 切换后的额外动作（文件树要清空目录 / 预览） */
  onSwitch?: (path: string) => void
}

function WorkspaceFolderChips(props: WorkspaceFolderChipsProps) {
  const { rootPath, folders, selectRoot } = useActiveWorkspace()

  if (folders.length <= 1) return null

  return (
    <div
      className={clsx(
        'border-border flex shrink-0 items-center gap-1 overflow-x-auto px-1.5 py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        props.className
      )}>
      {folders.map(function (folder) {
        const isActive = folder.path === rootPath
        return (
          <button
            key={folder.id}
            type="button"
            title={folder.path}
            onClick={function () {
              if (folder.path === rootPath) return
              selectRoot(folder.path)
              props.onSwitch?.(folder.path)
            }}
            className={clsx(
              'flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
              isActive
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
            )}>
            <Icon
              icon="lucide:folder"
              className="size-3.5 shrink-0"
            />
            {findBaseName(folder.path)}
          </button>
        )
      })}
    </div>
  )
}

export { WorkspaceFolderChips }
