/**
 * 两级（步骤为三级）级联引用选择器：作用域 → 叶 →（可选）子路径。
 */
import { Popover, PopoverContent, PopoverTrigger } from '@cogito/design/components/popover'
import { ScrollArea } from '@cogito/design/components/scroll-area'
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { cn } from 'cn'
import { useMemo, useState } from 'react'

import {
  buildRefGroups,
  formatRefLabel,
  normalizeRefPath,
  wrapRef,
  type ParamRefContext,
  type RefGroup,
  type RefLeaf,
  type RefScope
} from './param-ref.ts'

interface ParamRefPickerProps {
  context: ParamRefContext
  /** 当前若已是纯引用（可为裸名），高亮对应叶 */
  currentPath?: string | null
  onPick: (wrapped: string) => void
  /** 触发器外观：图标按钮 / 带标签的宽按钮 */
  variant?: 'icon' | 'chip'
  chipLabel?: string
  disabled?: boolean
  /** 图标按钮 title；默认「插入引用」 */
  title?: string
}

function findInitialScope(groups: RefGroup[], canonical: string | null): RefScope | null {
  if (canonical) {
    const head = canonical.split('.')[0]
    const hit = groups.find(function (group) {
      return group.scope === head || (head === 'variables' && group.scope === 'variables')
    })
    if (hit) return hit.scope
  }
  const first = groups.find(function (group) {
    return group.leaves.length > 0
  })
  return first?.scope ?? null
}

function findInitialBranch(group: RefGroup | undefined, canonical: string | null): string | null {
  if (!group || !canonical || group.scope !== 'step') return null
  const leaf = group.leaves.find(function (item) {
    return (
      canonical === item.path ||
      canonical.startsWith(`${item.path}.`) ||
      item.children?.some(function (child) {
        return child.path === canonical
      })
    )
  })
  return leaf?.path ?? null
}

function ParamRefPicker(props: ParamRefPickerProps) {
  const [open, setOpen] = useState(false)
  const groups = useMemo(
    function () {
      return buildRefGroups(props.context)
    },
    [props.context]
  )

  const canonicalPath = props.currentPath
    ? normalizeRefPath(props.currentPath, props.context)
    : null

  const [scope, setScope] = useState<RefScope | null>(null)
  const [branchPath, setBranchPath] = useState<string | null>(null)

  function syncCascader(nextOpen: boolean) {
    if (nextOpen) {
      const nextScope = findInitialScope(groups, canonicalPath)
      setScope(nextScope)
      const group = groups.find(function (item) {
        return item.scope === nextScope
      })
      setBranchPath(findInitialBranch(group, canonicalPath))
    }
    setOpen(nextOpen)
  }

  const activeGroup = groups.find(function (group) {
    return group.scope === scope
  })

  const activeBranch = activeGroup?.leaves.find(function (leaf) {
    return leaf.path === branchPath
  })

  const hasAny = groups.some(function (group) {
    return group.leaves.length > 0
  })

  function pick(path: string) {
    props.onPick(wrapRef(path))
    setOpen(false)
  }

  const trigger =
    props.variant === 'chip' ? (
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={props.disabled}
            className="h-8 w-full justify-between gap-2 font-normal"
            aria-label="选择引用"
          />
        }>
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon
            icon="lucide:braces"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <span className="truncate">{props.chipLabel ?? '选择引用'}</span>
        </span>
        <Icon
          icon="lucide:chevrons-up-down"
          className="size-3.5 shrink-0 opacity-50"
        />
      </PopoverTrigger>
    ) : (
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={props.disabled}
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="插入引用"
            title={props.title ?? '插入引用（变量 / 输入 / 环境 / 步骤）'}
          />
        }>
        <Icon
          icon="lucide:braces"
          className="size-3.5"
        />
      </PopoverTrigger>
    )

  const showThird = Boolean(activeBranch?.children?.length)

  return (
    <Popover
      open={open}
      onOpenChange={syncCascader}>
      {trigger}
      <PopoverContent
        align="end"
        className={cn('p-0', showThird ? 'w-[28rem]' : 'w-80')}
        sideOffset={4}>
        {!hasAny ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            暂无可引用项，先在「指令」里声明变量或输入
          </p>
        ) : (
          <div className="flex max-h-72 min-h-48">
            <ScrollArea className="w-28 shrink-0 border-r">
              <div className="flex flex-col gap-0.5 p-1">
                {groups.map(function (group) {
                  if (group.leaves.length === 0) return null
                  const active = scope === group.scope
                  return (
                    <Button
                      variant="ghost"
                      key={group.scope}
                      type="button"
                      className={cn(
                        'h-auto flex items-center justify-between rounded-md px-2 py-1.5 text-left text-xs',
                        active
                          ? 'bg-muted font-medium text-foreground'
                          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                      )}
                      onClick={function () {
                        setScope(group.scope)
                        setBranchPath(null)
                      }}>
                      <span>{group.title}</span>
                      <Icon
                        icon="lucide:chevron-right"
                        className="size-3 opacity-50"
                      />
                    </Button>
                  )
                })}
              </div>
            </ScrollArea>

            <ScrollArea className="min-w-0 flex-1 border-r last:border-r-0">
              <div className="flex flex-col gap-0.5 p-1">
                {!activeGroup || activeGroup.leaves.length === 0 ? (
                  <p className="px-2 py-4 text-xs text-muted-foreground">此分类暂无条目</p>
                ) : (
                  activeGroup.leaves.map(function (leaf) {
                    return (
                      <CascaderLeafButton
                        key={leaf.path}
                        leaf={leaf}
                        canonicalPath={canonicalPath}
                        expanded={branchPath === leaf.path}
                        onExpand={function () {
                          if (leaf.children?.length) {
                            setBranchPath(leaf.path)
                            return
                          }
                          pick(leaf.path)
                        }}
                        onPick={pick}
                      />
                    )
                  })
                )}
              </div>
            </ScrollArea>

            {showThird && activeBranch?.children ? (
              <ScrollArea className="min-w-0 flex-1">
                <div className="flex flex-col gap-0.5 p-1">
                  <p className="px-2 py-1 text-[11px] text-muted-foreground">
                    {activeBranch.label} 的取值
                  </p>
                  {activeBranch.children.map(function (child) {
                    const checked = canonicalPath === child.path
                    return (
                      <Button
                        variant="ghost"
                        key={child.path}
                        type="button"
                        className={cn(
                          'h-auto flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-left',
                          checked
                            ? 'bg-primary/10 text-foreground'
                            : 'hover:bg-muted/60 text-foreground'
                        )}
                        onClick={function () {
                          pick(child.path)
                        }}>
                        <span className="font-mono text-xs">{child.label}</span>
                        {child.hint ? (
                          <span className="text-[11px] text-muted-foreground">{child.hint}</span>
                        ) : null}
                      </Button>
                    )
                  })}
                </div>
              </ScrollArea>
            ) : null}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

interface CascaderLeafButtonProps {
  leaf: RefLeaf
  canonicalPath: string | null
  expanded: boolean
  onExpand: () => void
  onPick: (path: string) => void
}

function CascaderLeafButton(props: CascaderLeafButtonProps) {
  const hasChildren = Boolean(props.leaf.children?.length)
  const checked =
    props.canonicalPath === props.leaf.path ||
    (hasChildren &&
      props.leaf.children?.some(function (child) {
        return child.path === props.canonicalPath
      }))

  return (
    <Button
      variant="ghost"
      type="button"
      className={cn(
        'h-auto flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left',
        props.expanded || checked
          ? 'bg-muted font-medium text-foreground'
          : 'hover:bg-muted/60 text-foreground'
      )}
      onClick={function () {
        props.onExpand()
      }}>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs">{props.leaf.label}</div>
        {props.leaf.hint && !hasChildren ? (
          <div className="truncate text-[11px] text-muted-foreground">{props.leaf.hint}</div>
        ) : null}
      </div>
      {hasChildren ? (
        <Icon
          icon="lucide:chevron-right"
          className="size-3 shrink-0 opacity-50"
        />
      ) : checked ? (
        <Icon
          icon="lucide:check"
          className="size-3.5 shrink-0 text-primary"
        />
      ) : null}
    </Button>
  )
}

interface ParamRefSummaryProps {
  path: string
  context: ParamRefContext
  onChange: (wrapped: string) => void
  onClear: () => void
  onEditLiteral: () => void
}

/** 纯引用态：展示友好标签 + 换引用 / 改字面量 */
function ParamRefSummary(props: ParamRefSummaryProps) {
  return (
    <div className="flex gap-1">
      <div className="min-w-0 flex-1">
        <ParamRefPicker
          variant="chip"
          context={props.context}
          currentPath={props.path}
          chipLabel={formatRefLabel(props.path, props.context)}
          onPick={props.onChange}
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-8 shrink-0 text-muted-foreground"
        aria-label="改为手写"
        title="改为手写字面量"
        onClick={props.onEditLiteral}>
        <Icon
          icon="lucide:pencil"
          className="size-3.5"
        />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
        aria-label="清除"
        title="清除"
        onClick={props.onClear}>
        <Icon
          icon="lucide:x"
          className="size-3.5"
        />
      </Button>
    </div>
  )
}

export { ParamRefPicker, ParamRefSummary }
