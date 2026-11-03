/**
 * 工作区切换器：当前根 / 最近打开 / Cogito 工作区 / 打开与追加。
 *
 * 挂在 Explorer header；切换语义统一走 `switchWorkspace`（会先处理脏标签确认）。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@cogito/design/components/popover'
import { cn } from 'cn'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { useAgentStore } from '@/stores/agent'
import { useCodeStore } from '@/stores/code'
import { pickRootDirectory } from '@/views/code/lib/fs.ts'
import { addWorkspaceRoot, removeWorkspaceRoot, switchWorkspace } from '@/views/code/lib/workspace-switch.ts'

function findFolderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function SectionLabel(props: { children: string }) {
  return (
    <div className="text-muted-foreground px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wider uppercase">
      {props.children}
    </div>
  )
}

function WorkspaceSwitcher(props: { className?: string }) {
  const roots = useCodeStore(function (state) {
    return state.roots
  })
  const workspaceID = useCodeStore(function (state) {
    return state.workspaceID
  })
  const recentRoots = useCodeStore(function (state) {
    return state.recentRoots
  })
  const isOpen = useCodeStore(function (state) {
    return state.isWorkspaceSwitcherOpen
  })
  const workspaces = useAgentStore(function (state) {
    return state.workspaces
  })
  const folders = useAgentStore(function (state) {
    return state.workspaceFolders
  })

  function setOpen(open: boolean) {
    useCodeStore.getState().toSetWorkspaceSwitcherOpen(open)
  }

  useEffect(
    function () {
      if (!isOpen) return
      void useAgentStore.getState().toReadWorkspaces()
      void useAgentStore.getState().toReadWorkspaceFolders()
    },
    [isOpen]
  )

  const recentOnly = recentRoots.filter(function (root) {
    const key = root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    return !roots.some(function (item) {
      return item.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === key
    })
  })

  async function onOpenFolder() {
    const root = await pickRootDirectory()
    if (!root) return
    switchWorkspace([root])
    setOpen(false)
    toast.success('已打开文件夹')
  }

  async function onAddFolder() {
    const root = await pickRootDirectory()
    if (!root) return
    addWorkspaceRoot(root)
    setOpen(false)
    toast.success('已添加文件夹')
  }

  function onSwitchWorkspace(id: string) {
    const owned = folders
      .filter(function (folder) {
        return folder.workspaceID === id
      })
      .sort(function (a, b) {
        return a.sort - b.sort
      })
    if (owned.length === 0) {
      toast.message('该工作区还没有文件夹')
      return
    }
    switchWorkspace(
      owned.map(function (folder) {
        return folder.path
      }),
      { workspaceID: id }
    )
    setOpen(false)
  }

  return (
    <Popover
      open={isOpen}
      onOpenChange={function (open) {
        setOpen(open)
      }}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            type="button"
            aria-label="切换工作区"
            title="切换工作区"
            className={cn(
              'hover:bg-muted hover:text-foreground flex size-5 items-center justify-center rounded-sm',
              props.className
            )}>
            <Icon
              icon="lucide:folders"
              className="size-3.5"
            />
          </Button>
        }
      />
      <PopoverContent
        align="start"
        className="w-80 p-1">
        <SectionLabel>当前工作区</SectionLabel>
        {roots.length === 0 ? (
          <p className="text-muted-foreground px-2 py-1 text-xs">尚未打开文件夹</p>
        ) : (
          <ul className="list-none">
            {roots.map(function (root) {
              return (
                <li
                  key={root}
                  className="hover:bg-muted/60 flex items-center gap-2 rounded-md px-2 py-1.5">
                  <Icon
                    icon="lucide:folder"
                    className="text-muted-foreground size-3.5 shrink-0"
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-xs"
                    title={root}>
                    {findFolderName(root)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    type="button"
                    aria-label={`移除 ${findFolderName(root)}`}
                    title="从工作区移除"
                    disabled={roots.length <= 1}
                    className="text-muted-foreground size-5"
                    onClick={function () {
                      removeWorkspaceRoot(root)
                    }}>
                    <Icon
                      icon="lucide:x"
                      className="size-3"
                    />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}

        {recentOnly.length > 0 ? (
          <>
            <SectionLabel>最近打开</SectionLabel>
            <ul className="list-none">
              {recentOnly.slice(0, 5).map(function (root) {
                return (
                  <li key={root}>
                    <Button
                      variant="ghost"
                      type="button"
                      className="hover:bg-muted/60 h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left text-xs"
                      title={root}
                      onClick={function () {
                        switchWorkspace([root])
                        setOpen(false)
                      }}>
                      <Icon
                        icon="lucide:history"
                        className="text-muted-foreground size-3.5 shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {findFolderName(root)}
                      </span>
                      <span className="text-muted-foreground max-w-28 truncate text-[10px]">
                        {root.replace(/\\/g, '/').split('/').slice(-2, -1)[0]}
                      </span>
                    </Button>
                  </li>
                )
              })}
            </ul>
          </>
        ) : null}

        <SectionLabel>Cogito 工作区</SectionLabel>
        {workspaces.length === 0 ? (
          <p className="text-muted-foreground px-2 py-1 text-xs">暂无工作区</p>
        ) : (
          <ul className="list-none">
            {workspaces.map(function (workspace) {
              const count = folders.filter(function (folder) {
                return folder.workspaceID === workspace.id
              }).length
              return (
                <li key={workspace.id}>
                  <Button
                    variant="ghost"
                    type="button"
                    className={cn(
                      'hover:bg-muted/60 h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left text-xs',
                      workspace.id === workspaceID && 'text-primary'
                    )}
                    onClick={function () {
                      onSwitchWorkspace(workspace.id)
                    }}>
                    <Icon
                      icon={workspace.icon || 'lucide:box'}
                      className="size-3.5 shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate">{workspace.title}</span>
                    <span className="text-muted-foreground text-[10px]">{count} 个文件夹</span>
                  </Button>
                </li>
              )
            })}
          </ul>
        )}

        <div className="border-border/60 mt-1 flex gap-1 border-t p-1">
          <Button
            variant="ghost"
            type="button"
            className="hover:bg-muted h-7 flex-1 gap-1.5 text-xs"
            onClick={function () {
              void onOpenFolder()
            }}>
            <Icon
              icon="lucide:folder-open"
              className="size-3.5"
            />
            打开文件夹…
          </Button>
          <Button
            variant="ghost"
            type="button"
            className="hover:bg-muted h-7 flex-1 gap-1.5 text-xs"
            onClick={function () {
              void onAddFolder()
            }}>
            <Icon
              icon="lucide:folder-plus"
              className="size-3.5"
            />
            添加文件夹…
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { WorkspaceSwitcher }
