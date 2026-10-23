import { Icon } from '@iconify/react/offline'
import { useAui } from '@assistant-ui/react'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@cogito/design/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { useQuery } from '@tanstack/react-query'
import { cn } from 'cn'
import { useState } from 'react'
import { toast } from 'sonner'

import { useActiveWorkspaceID } from '@/features/agent/workspace/client.ts'
import { attachWorkspaceFile } from '@/features/agent/attachment.ts'
import { toIpcMessage } from '@/utils/ipc.errors.ts'
import { WorkspaceFilePicker } from './workspace-file-picker.tsx'

/**
 * 输入区左下角的 `+`：双栏 AttachMenu（对齐 client / Qoder）。
 *
 * 左栏分类；右栏 files 浏览/搜索或 skills 列表。目标 / 计划 / 插件暂未实现，
 * 禁用并 toast「即将推出」。本地文件、图片走旁边的回形针，不和上下文混在一起。
 */

type AttachCategory = 'goal' | 'plan' | 'files' | 'plugins' | 'skills'

interface CategoryItem {
  key: AttachCategory
  label: string
  icon: string
  enabled: boolean
}

const CATEGORIES: readonly CategoryItem[] = [
  { key: 'goal', label: '目标', icon: 'lucide:target', enabled: false },
  { key: 'plan', label: '计划', icon: 'lucide:list-todo', enabled: false },
  { key: 'files', label: '工作区', icon: 'lucide:folder-tree', enabled: true },
  { key: 'plugins', label: '插件', icon: 'lucide:puzzle', enabled: false },
  { key: 'skills', label: '技能', icon: 'lucide:wrench', enabled: true }
]

function SkillsPane(props: {
  active: boolean
  workspaceID: string | null
  onPick: (relative: string) => void
}) {
  const [query, updateQuery] = useState('')
  const skillsQuery = useQuery({
    queryKey: ['workspace', 'readSkills', props.workspaceID],
    queryFn: function () {
      return itc.workspace.readSkills({ workspaceID: props.workspaceID as string })
    },
    enabled: props.active && Boolean(props.workspaceID)
  })

  const needle = query.trim().toLowerCase()
  const skills = skillsQuery.data ?? []
  const filtered =
    needle.length === 0
      ? skills
      : skills.filter(function (skill) {
          return (
            skill.name.toLowerCase().includes(needle) ||
            skill.description.toLowerCase().includes(needle)
          )
        })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b p-2">
        <Input
          autoFocus
          value={query}
          placeholder="搜索技能"
          aria-label="搜索技能"
          className="h-7 text-xs"
          onChange={function (event) {
            updateQuery(event.target.value)
          }}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
        {skillsQuery.isFetching ? (
          <p className="text-muted-foreground flex items-center gap-1.5 p-2.5 text-xs">
            <Icon
              icon="lucide:loader-circle"
              className="size-3.5 animate-spin"
            />
            读取中…
          </p>
        ) : null}
        {!skillsQuery.isFetching
          ? filtered.map(function (skill) {
              return (
                <Button
                  key={skill.id}
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-xs font-normal"
                  onClick={function () {
                    props.onPick(skill.relative)
                  }}>
                  <Icon
                    icon="lucide:wrench"
                    className="text-muted-foreground size-3.5 shrink-0"
                  />
                  <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                    <span className="w-full truncate text-start">{skill.name}</span>
                    {skill.description ? (
                      <span className="text-muted-foreground w-full truncate text-start text-xs">
                        {skill.description}
                      </span>
                    ) : null}
                  </span>
                </Button>
              )
            })
          : null}
        {!skillsQuery.isFetching && filtered.length === 0 ? (
          <p className="text-muted-foreground p-2.5 text-xs">
            {props.workspaceID ? '当前工作区暂无技能' : '先在左栏添加工作区'}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function ComposerContextMenu() {
  const aui = useAui()
  const workspaceID = useActiveWorkspaceID()
  const [isOpen, updateOpen] = useState(false)
  const [category, updateCategory] = useState<AttachCategory>('files')

  function handleOpenChange(next: boolean) {
    updateOpen(next)
    if (next) updateCategory('files')
  }

  function handlePickRelative(relative: string) {
    void attachWorkspaceFile(aui, relative)
      .then(function () {
        updateOpen(false)
      })
      .catch(function (error: unknown) {
        toast.error(toIpcMessage(error, '引用失败'))
      })
  }

  return (
    <Popover
      open={isOpen}
      onOpenChange={handleOpenChange}>
      <Tooltip open={isOpen ? false : undefined}>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="添加上下文"
                  className="text-muted-foreground hover:text-foreground size-7 rounded-md"
                />
              }>
              <Icon icon="lucide:plus" />
            </PopoverTrigger>
          }
        />
        <TooltipContent
          side="top"
          className="max-w-56 text-start">
          <span className="block">添加上下文</span>
          <span className="text-background/75 block">工作区文件、技能</span>
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        align="start"
        className="w-[min(32rem,calc(100vw-2.5rem))] overflow-hidden p-0 shadow-lg">
        <div className="flex h-80 min-h-0 w-full">
          <div className="border-border/60 bg-muted/30 flex w-33 shrink-0 flex-col gap-0.5 border-r p-1.5">
            {CATEGORIES.map(function (item) {
              const isActive = category === item.key
              return (
                <button
                  key={item.key}
                  type="button"
                  disabled={!item.enabled}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-xs transition-colors',
                    item.enabled
                      ? 'hover:bg-muted text-foreground cursor-pointer'
                      : 'text-muted-foreground cursor-not-allowed opacity-40',
                    isActive && item.enabled && 'bg-muted font-medium'
                  )}
                  onClick={function () {
                    if (!item.enabled) {
                      toast.info('即将推出')
                      return
                    }
                    updateCategory(item.key)
                  }}>
                  <Icon
                    icon={item.icon}
                    className="text-muted-foreground size-3.5 shrink-0"
                  />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.key === 'files' || item.key === 'skills' ? (
                    <Icon
                      icon="lucide:chevron-right"
                      className="text-muted-foreground size-3.5 shrink-0"
                    />
                  ) : null}
                </button>
              )
            })}
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {category === 'files' ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <WorkspaceFilePicker
                  active={isOpen && category === 'files'}
                  className="flex h-full min-h-0 flex-col"
                  listClassName="min-h-0"
                  onPick={handlePickRelative}
                />
              </div>
            ) : null}

            {category === 'skills' ? (
              <SkillsPane
                active={isOpen && category === 'skills'}
                workspaceID={workspaceID}
                onPick={handlePickRelative}
              />
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
