import { Icon } from '@iconify/react'
import { cn } from 'cn'

/** 补全候选：当前空间的一个页面标题 */
interface WikiLinkCandidate {
  title: string
}

interface WikiLinkSuggestListProps {
  query: string
  items: WikiLinkCandidate[]
  selectedIndex: number
  onSelect: (candidate: WikiLinkCandidate) => void
}

/**
 * `[[` 弹层内容。
 *
 * 只有列表和空态，定位与挂载由 suggestion 插件负责；行用 `div[role=option]` 而不是按钮，
 * 因为这里必须 `onPointerDown` 抢在编辑器失焦之前响应（用按钮会被 focus 抢走导致链式命令失败）。
 */
function WikiLinkSuggestList(props: WikiLinkSuggestListProps) {
  if (props.items.length === 0) {
    return (
      <div className="min-w-56 rounded-md border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-md">
        {props.query
          ? `没有匹配「${props.query}」的页面`
          : '当前空间还没有可链接的页面'}
      </div>
    )
  }

  return (
    <div
      role="listbox"
      aria-label="链接到页面"
      className="max-h-72 min-w-56 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md"
    >
      {props.items.map(function (item, index) {
        const isSelected = index === props.selectedIndex
        return (
          <div
            key={item.title}
            role="option"
            aria-selected={isSelected}
            tabIndex={-1}
            className={cn(
              'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm',
              isSelected ? 'bg-accent text-accent-foreground' : 'text-foreground'
            )}
            onPointerDown={function (event) {
              // 抢在失焦前选中，否则 blur 会先把弹层关掉
              event.preventDefault()
              props.onSelect(item)
            }}
            onPointerEnter={function () {
              // 鼠标划过不改变键盘选中项：保持「键盘优先」的可预期行为
            }}
          >
            <Icon icon="lucide:file-text" className="size-3.5 shrink-0 opacity-60" />
            <span className="truncate">{item.title}</span>
          </div>
        )
      })}
    </div>
  )
}

export { WikiLinkSuggestList }
export type { WikiLinkCandidate, WikiLinkSuggestListProps }
