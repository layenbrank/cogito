/**
 * 仓库选择器：多根工作区里挑「当前仓库」。
 *
 * 与 Explorer 的 `WorkspaceSwitcher` 分工不同 —— 那个换工作区（会关孤儿标签、
 * 重建文件树），这个只换 Git 视图指向哪个根，对齐 VS Code 的 SCM 仓库选择：
 * 多个根里只有真仓库进列表，非仓库置灰说明原因。
 */
import { Icon } from '@iconify/react/offline'
import { Popover, PopoverContent, PopoverTrigger } from '@cogito/design/components/popover'
import { cn } from 'cn'
import { useState } from 'react'

import { useCodeGitStore } from '@/stores/code-git'
import { findFileName } from '@/views/code/lib/path.ts'

/** 下拉里最多的根数（roots 本身由工作区切换器管理，这里只挑 Git 目标） */
const MAX_ROWS = 12

function RepoSwitcher(props: { className?: string }) {
  const [isOpen, setOpen] = useState(false)
  const candidates = useCodeGitStore(function (state) {
    return state.repoCandidates
  })
  const repoRoot = useCodeGitStore(function (state) {
    return state.repoRoot
  })
  const isRepo = useCodeGitStore(function (state) {
    return state.isRepo
  })

  const repoCount = candidates.filter(function (item) {
    return item.isRepo
  }).length
  const label = repoRoot ? findFileName(repoRoot) : '未检测到仓库'

  return (
    <Popover
      open={isOpen}
      onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="切换仓库"
            title={repoRoot ?? '当前工作区里没有 Git 仓库'}
            className={cn(
              'hover:bg-muted/70 flex h-7 min-w-0 items-center gap-1.5 rounded-sm px-1.5 text-left',
              !isRepo && 'text-muted-foreground',
              props.className
            )}>
            <Icon
              icon="lucide:folder-git-2"
              className="size-3.5 shrink-0"
            />
            <span className="min-w-0 truncate text-xs font-medium">{label}</span>
            {repoCount > 1 ? (
              <Icon
                icon="lucide:chevrons-up-down"
                className="text-muted-foreground size-3 shrink-0"
              />
            ) : null}
          </button>
        }
      />
      <PopoverContent
        align="start"
        className="w-72 p-1">
        <div className="text-muted-foreground px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wider uppercase">
          工作区仓库
        </div>
        {candidates.length === 0 ? (
          <p className="text-muted-foreground px-2 py-1 text-xs">尚未打开文件夹</p>
        ) : (
          <ul className="list-none">
            {candidates.slice(0, MAX_ROWS).map(function (item) {
              const isActive = item.path === repoRoot
              return (
                <li key={item.path}>
                  <button
                    type="button"
                    disabled={!item.isRepo}
                    title={item.path}
                    className={cn(
                      'hover:bg-muted/60 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left',
                      !item.isRepo && 'cursor-not-allowed opacity-45',
                      isActive && 'bg-muted/50'
                    )}
                    onClick={function () {
                      if (!item.isRepo) return
                      setOpen(false)
                      void useCodeGitStore.getState().toSync(item.path)
                    }}>
                    <Icon
                      icon={isActive ? 'lucide:check' : 'lucide:folder'}
                      className="text-muted-foreground size-3.5 shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate text-xs">
                      {findFileName(item.path)}
                    </span>
                    {!item.isRepo ? (
                      <span className="text-muted-foreground shrink-0 text-[10px]">非仓库</span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}

export { RepoSwitcher }
