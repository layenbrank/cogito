/**
 * 「当前文件夹」切换 chips。
 *
 * 一个工作区挂多个目录时才出现。默认读写全局「当前文件夹」
 * （features/agent/workspace/active-root），所以文件树、审阅、历史看到的是同一个文件夹；
 * 传 `value` / `onSelect` 则变成受控组件 —— composer 的 `+` 面板用它**只看别的项目**，
 * 不改变全局上下文。
 */
import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'

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

  if (folders.length <= 1) return null

  /** 两个 `api` 并排出现时靠上一级目录区分，见 `buildFolderLabels` */
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
    <div
      className={clsx(
        'border-border flex shrink-0 items-center gap-1 overflow-x-auto px-1.5 py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        props.className
      )}>
      {folders.map(function (folder, index) {
        const isActive = folder.path === activePath
        return (
          <button
            key={folder.id}
            type="button"
            title={folder.path}
            onClick={function () {
              select(folder.path)
            }}
            className={clsx(
              'flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
              isActive
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
            )}>
            <Icon
              icon={isActive ? 'lucide:folder-open' : 'lucide:folder'}
              className={clsx('size-3.5 shrink-0', isActive && 'text-primary')}
            />
            {findFolderLabel(labels, folder.path)}
            {index === 0 ? (
              <span
                className={clsx(
                  'ml-0.5 shrink-0 rounded px-1 py-px text-[10px] font-medium leading-none tracking-wide',
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
  )
}

export { WorkspaceFolderChips }
