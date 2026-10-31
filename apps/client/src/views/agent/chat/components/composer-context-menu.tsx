import { Icon } from '@iconify/react/offline'
import { useAui } from '@assistant-ui/react'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@cogito/design/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { clsx } from 'clsx'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { attachWorkspaceFile } from '@/features/agent/attachment.ts'
import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { WorkspaceSkills, type WorkspaceSkill } from '@/lib/workspace-skills.ts'
import { ExtensionsPane } from './composer-extensions-pane.tsx'
import { WorkspaceFilePicker } from './workspace-file-picker.tsx'

/**
 * 输入区 `+`：双栏 AttachMenu（对齐 Qoder / studio）。
 * 左栏分类；右栏工作区浏览或技能列表。
 */

type AttachCategory = 'files' | 'plugins' | 'skills'

interface CategoryItem {
  key: AttachCategory
  label: string
  icon: string
  enabled: boolean
  /** 跳到设置里的对应页面（扩展就是 goose 的 extension） */
  href?: string
}

/** 模式（执行/计划/问答/目标）只在 composer 底部的模式选择器里切，这里不重复开口子 */
const CATEGORIES: readonly CategoryItem[] = [
  { key: 'files', label: '工作区', icon: 'lucide:folder-tree', enabled: true },
  { key: 'plugins', label: '扩展', icon: 'lucide:puzzle', enabled: true },
  { key: 'skills', label: '技能', icon: 'lucide:wrench', enabled: true }
]

function SkillsPane(props: {
  active: boolean
  rootPath: string | null
  onPick: (relative: string) => void
}) {
  const [query, updateQuery] = useState('')
  const [skillsState, updateSkills] = useState<WorkspaceSkill[]>([])
  const [isLoading, updateLoading] = useState(false)
  /** 面板没开 / 没有工作区时按空列表渲染：不在 effect 里同步清 state */
  const skills = props.active && props.rootPath ? skillsState : []

  useEffect(
    function () {
      if (!props.active || !props.rootPath) return
      let cancelled = false
      async function load() {
        try {
          updateLoading(true)
          const rows = await WorkspaceSkills.fetchSkills([props.rootPath as string])
          if (!cancelled) updateSkills(rows)
        } catch (error) {
          console.warn('[composer-context-menu] 读取技能失败:', error)
          if (!cancelled) updateSkills([])
        } finally {
          if (!cancelled) updateLoading(false)
        }
      }
      void load()
      return function () {
        cancelled = true
      }
    },
    [props.active, props.rootPath]
  )

  const needle = query.trim().toLowerCase()
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
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {isLoading ? (
          <p className="text-muted-foreground flex items-center gap-1.5 p-2.5 text-xs">
            <Icon
              icon="lucide:loader-circle"
              className="size-3.5 animate-spin"
            />
            读取中…
          </p>
        ) : null}
        {!isLoading
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
        {!isLoading && filtered.length === 0 ? (
          <p className="text-muted-foreground p-2.5 text-xs">
            {props.rootPath ? '当前工作区暂无技能' : '先在左栏添加工作区'}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function ComposerContextMenu() {
  const aui = useAui()
  const navigate = useNavigate()
  const { rootPath } = useActiveWorkspace()
  const [isOpen, updateOpen] = useState(false)
  const [isTooltipOpen, updateTooltipOpen] = useState(false)
  const [category, updateCategory] = useState<AttachCategory>('files')

  function handleOpenChange(next: boolean) {
    updateOpen(next)
    if (next) {
      updateCategory('files')
      updateTooltipOpen(false)
    }
  }

  function handlePickRelative(relative: string) {
    void attachWorkspaceFile(aui, relative)
      .then(function () {
        updateOpen(false)
        toast.success('已引用')
      })
      .catch(function (error: unknown) {
        toast.error(error instanceof Error ? error.message : '引用失败')
      })
  }

  return (
    <Popover
      open={isOpen}
      onOpenChange={handleOpenChange}>
      <Tooltip
        open={isOpen ? false : isTooltipOpen}
        onOpenChange={function (next) {
          if (!isOpen) updateTooltipOpen(next)
        }}>
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
        className="w-[min(32rem,calc(100vw-2.5rem))] overflow-hidden rounded-xl border-0 p-0 shadow-[0_10px_36px_-8px_color-mix(in_oklab,var(--foreground)_18%,transparent),0_4px_14px_-4px_color-mix(in_oklab,var(--foreground)_10%,transparent)]">
        <div className="flex h-80 min-h-0 w-full">
          <div className="border-border/60 bg-muted/30 flex w-33 shrink-0 flex-col gap-0.5 border-r p-1.5">
            {CATEGORIES.map(function (item) {
              const isActive = category === item.key
              return (
                <Button
                  key={item.key}
                  type="button"
                  variant="ghost"
                  disabled={!item.enabled}
                  className={clsx(
                    'h-auto w-full justify-start gap-2 rounded-md px-2.5 py-2 text-xs font-normal',
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
                  <span className="flex-1 truncate text-start">{item.label}</span>
                  {item.key === 'files' || item.key === 'skills' || item.key === 'plugins' ? (
                    <Icon
                      icon="lucide:chevron-right"
                      className="text-muted-foreground size-3.5 shrink-0"
                    />
                  ) : null}
                </Button>
              )
            })}
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {category === 'files' ? (
              <WorkspaceFilePicker
                active={isOpen && category === 'files'}
                className="flex h-full min-h-0 flex-col"
                listClassName="min-h-0"
                onPick={handlePickRelative}
              />
            ) : null}

            {category === 'skills' ? (
              <SkillsPane
                active={isOpen && category === 'skills'}
                rootPath={rootPath}
                onPick={handlePickRelative}
              />
            ) : null}

            {category === 'plugins' ? (
              <ExtensionsPane
                active={isOpen && category === 'plugins'}
                onManage={function () {
                  updateOpen(false)
                  void navigate('/agent/settings?section=extensions')
                }}
              />
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { ComposerContextMenu }
