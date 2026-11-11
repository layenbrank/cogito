/**
 * Prompt library（对齐 assistant-ui `elements/prompt-library`）
 *
 * 面板 = 搜索 + 已存提示词列表 + 选中项预览。列表右端是变量数（`N 个变量`），
 * 预览里的 `{branch}` 单独渲染成等宽芯片 —— 扫一眼就知道这条模板要填什么。
 *
 * 进入方式是输入框里的 `::` 触发器（见 `composer-triggers.tsx`）：
 * 命中时由触发器面板渲染本组件，`showSearch` 关掉（过滤词就是 `::` 后面打的字），
 * 选中后整段模板以纯文本插入，变量保持 `{name}` 形态方便就地修改。
 *
 * 元素本体是收费产物，结构与样式按官网渲染出的 DOM 还原到本仓 token
 * （`field` / `paper` / `mono`），不照搬它的 px 数值。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import type { ComponentProps, ReactNode } from 'react'

import { field, mono, paper } from './elements/surfaces'
import { useAssistantLabels } from './labels'
import { parsePromptVariables } from './prompt-vars'

interface PromptLibraryItem {
  readonly id: string
  /** 列表主文案；长标题截断，完整标题放 `title` */
  readonly title: string
  /** 模板正文；预览区与变量芯片都从这里来 */
  readonly body: string
}

interface PromptLibraryProps extends Omit<ComponentProps<'div'>, 'children' | 'onSelect'> {
  items: readonly PromptLibraryItem[]
  /** 当前高亮项（与输入框触发器共用 ↑↓ 状态） */
  activeID?: string | null
  onHover?: (id: string) => void
  onPick?: (id: string) => void
  /** 搜索词；`showSearch` 为 true 时由面板自己的输入框编辑 */
  query?: string
  onQueryChange?: (query: string) => void
  /**
   * 面板内搜索框。嵌在输入框触发器里时关掉：此时过滤词就是 `::` 后面键入的内容，
   * 再放一个输入框会和编辑器抢焦点。
   */
  showSearch?: boolean
  emptyText?: string
  /** 面板底部（管理入口、快捷键提示） */
  footer?: ReactNode
}

const ROW_BASE_CLASS =
  'flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-start transition-colors outline-hidden'

function PromptLibrary({
  items,
  activeID,
  onHover,
  onPick,
  query,
  onQueryChange,
  showSearch = false,
  emptyText,
  footer,
  className,
  ...props
}: PromptLibraryProps) {
  const labels = useAssistantLabels()
  const active = items.find(function (item) {
    return item.id === activeID
  })
  const variables = active ? parsePromptVariables(active.body) : []

  return (
    <div
      data-slot="prompt-library"
      className={cn(paper, 'flex w-full min-w-0 flex-col gap-2 rounded-2xl p-3', className)}
      {...props}>
      {showSearch ? (
        <div
          data-slot="prompt-library-search"
          className={cn(field, 'flex items-center gap-2 rounded-xl px-2.5 py-1.5')}>
          <Icon
            icon="lucide:bookmark"
            className="text-muted-foreground size-3.5 shrink-0"
            aria-hidden
          />
          <input
            type="text"
            role="combobox"
            aria-expanded
            aria-controls="prompt-library-list"
            aria-autocomplete="list"
            aria-label={labels.promptLibrarySearch}
            placeholder={labels.promptLibrarySearch}
            value={query ?? ''}
            onChange={function (event) {
              onQueryChange?.(event.target.value)
            }}
            className="text-foreground/85 placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>
      ) : null}

      <div
        id="prompt-library-list"
        role="listbox"
        aria-label={labels.promptLibraryList}
        className="flex max-h-[min(26vh,13rem)] min-h-0 flex-col overflow-y-auto">
        {items.length === 0 ? (
          <p className="text-muted-foreground px-2 py-1.5 text-xs">
            {emptyText ?? labels.promptLibraryEmpty}
          </p>
        ) : null}
        {items.map(function (item) {
          const count = parsePromptVariables(item.body).length
          const isActive = item.id === activeID
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={isActive}
              title={item.title}
              data-slot="prompt-library-item"
              className={cn(
                ROW_BASE_CLASS,
                'hover:bg-foreground/[0.03]',
                isActive && 'bg-foreground/[0.05]'
              )}
              onMouseEnter={function () {
                onHover?.(item.id)
              }}
              onMouseDown={function (event) {
                // 面板挂在输入框上：别让按钮抢焦点，否则编辑器 blur 会把面板关掉
                event.preventDefault()
                onPick?.(item.id)
              }}>
              <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
              {count > 0 ? (
                <span className={cn(mono, 'shrink-0')}>{labels.promptLibraryVariables(count)}</span>
              ) : null}
            </button>
          )
        })}
      </div>

      {active ? (
        <div
          data-slot="prompt-library-preview"
          className={cn(field, 'flex flex-col gap-2 rounded-xl p-2.5')}>
          <p className="text-foreground/65 text-xs leading-relaxed break-words whitespace-pre-wrap">
            {active.body}
          </p>
          {variables.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {variables.map(function (name) {
                return (
                  <span
                    key={name}
                    data-slot="prompt-library-variable"
                    className={cn(mono, 'bg-background/70 rounded px-1.5 py-0.5')}>
                    {'{' + name + '}'}
                  </span>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {footer ? <div className="text-muted-foreground px-0.5 text-xs">{footer}</div> : null}
    </div>
  )
}

export { PromptLibrary }
export type { PromptLibraryItem, PromptLibraryProps }
