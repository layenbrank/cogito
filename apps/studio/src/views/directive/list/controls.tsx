import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { Input } from '@cogito/design/components/input'
import { ToggleGroup, ToggleGroupItem } from '@cogito/design/components/toggle-group'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'

import { useCorexStore } from '@/stores/corex'

import { SORT_ICONS, SORT_LABELS, SORT_MODES, type SortMode } from './group'

/**
 * 指令列表的工具件：搜索框、排序开关、全部已读、导入。
 *
 * 卡片墙与编排台左栏都要这几件，只是宽窄不同 —— 工具件只管自己长什么样，
 * 摆在哪一行、占多宽由调用方的 className 说了算。
 */

interface SearchProps {
  value: string
  isCompact?: boolean
  className?: string
  onChange: (value: string) => void
}

/** 左栏窄、卡片墙宽，同一个搜索框用两档高度就够，不必让调用方掏类名改内部布局 */
const SEARCH_HEIGHTS = { compact: 'h-8', regular: 'h-9' }

function DirectiveSearch(props: SearchProps) {
  const isSearching = props.value.length > 0
  const isCompact = props.isCompact === true
  const height = isCompact ? SEARCH_HEIGHTS.compact : SEARCH_HEIGHTS.regular

  return (
    <div className={cn('relative', props.className)}>
      <Icon
        icon="mdi:magnify"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        value={props.value}
        placeholder="搜索名称或描述…"
        className={cn(
          'border-transparent bg-muted/70 pr-9 pl-9 shadow-none',
          'placeholder:text-muted-foreground/70',
          'focus-visible:border-ring focus-visible:bg-background focus-visible:ring-[3px]',
          isCompact ? 'rounded-lg' : 'rounded-xl',
          height
        )}
        onChange={function (event) {
          props.onChange(event.target.value)
        }}
      />
      <AnimatePresence initial={false}>
        {isSearching ? (
          <motion.div
            key="clear"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            className="absolute top-1/2 right-1.5 -translate-y-1/2">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="cursor-pointer rounded-full"
              aria-label="清空搜索"
              title="清空搜索"
              onClick={function () {
                props.onChange('')
              }}>
              <Icon icon="mdi:close" />
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

interface MarkReadProps {
  /** 还没看过的指令名；空的话什么都不渲染 */
  names: readonly string[]
  className?: string
}

/** 「全部标为已读」：圆点攒了一片时一次清掉，不必挨个点进去 */
function DirectiveMarkAllRead(props: MarkReadProps) {
  const markSeenAll = useCorexStore(function (state) {
    return state.markSeenAll
  })
  if (props.names.length === 0) return null

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn('text-muted-foreground hover:text-primary', props.className)}
      aria-label={`把 ${props.names.length} 条指令标为已读`}
      title={`把 ${props.names.length} 条指令标为已读`}
      onClick={function () {
        markSeenAll(props.names)
      }}>
      <Icon icon="mdi:email-open-outline" />
    </Button>
  )
}

interface SortProps {
  value: SortMode
  className?: string
  onChange: (mode: SortMode) => void
}

/**
 * 排序分段：对齐 antd `Space.Compact` —— 边框只在子项上，相邻共用竖线，
 * 圆角只落在首尾。外层再套一层 border/padding 会叠成双框。
 */
function DirectiveSort(props: SortProps) {
  return (
    <ToggleGroup
      size="sm"
      variant="outline"
      spacing={0}
      value={[props.value]}
      className={cn('shadow-xs', props.className)}
      onValueChange={function (value) {
        const next = value[0]
        if (next) props.onChange(next as SortMode)
      }}>
      {SORT_MODES.map(function (mode) {
        return (
          <ToggleGroupItem
            key={mode}
            value={mode}
            aria-label={`按${SORT_LABELS[mode]}排序`}
            className="grow basis-0 cursor-pointer gap-1.5 px-2.5 text-xs whitespace-nowrap data-[pressed]:bg-primary/10 data-[pressed]:text-primary">
            <Icon icon={SORT_ICONS[mode]} />
            {SORT_LABELS[mode]}
          </ToggleGroupItem>
        )
      })}
    </ToggleGroup>
  )
}

interface ImportProps {
  /** 窄栏用图标按钮，卡片墙用带文字的按钮 */
  isCompact?: boolean
  className?: string
  onImportFolder: () => void
  onImportFile: () => void
}

/**
 * 导入 YAML：目录或单文件。
 *
 * 以前只挂在「还没有指令」的占位区 —— 有列表之后入口就没了，但 corex 的
 * `import_directives` 本来就支持同名跳过 / 覆盖。工具栏常驻，空列表时占位区
 * 仍保留同一套入口，两边文案对齐。
 */
function DirectiveImport(props: ImportProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          props.isCompact ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={props.className}
              aria-label="导入 YAML"
              title="导入 YAML">
              <Icon icon="mdi:file-import-outline" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={props.className}
              aria-label="导入 YAML"
              title="导入 YAML">
              <Icon icon="mdi:file-import-outline" />
              导入
            </Button>
          )
        }
      />
      <DropdownMenuContent
        align="end"
        className="min-w-44">
        <DropdownMenuItem
          onClick={function () {
            props.onImportFolder()
          }}>
          <Icon icon="mdi:folder-open-outline" />
          导入 YAML 目录…
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={function () {
            props.onImportFile()
          }}>
          <Icon icon="mdi:file-import-outline" />
          导入 YAML 文件…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { DirectiveImport, DirectiveMarkAllRead, DirectiveSearch, DirectiveSort }
