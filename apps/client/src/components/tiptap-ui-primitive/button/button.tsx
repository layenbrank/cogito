'use client'

import {
  Children,
  Fragment,
  forwardRef,
  isValidElement,
  useMemo,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactNode
} from 'react'

import { Button as DesignButton } from '@cogito/design/components/button'
import { Toggle } from '@cogito/design/components/toggle'
import { Kbd, KbdGroup } from '@cogito/design/components/kbd'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@cogito/design/components/tooltip'
import { cn, parseShortcutKeys } from '@/lib/tiptap-utils'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string
  showTooltip?: boolean
  tooltip?: ReactNode
  shortcutKeys?: string
  'data-style'?: string
  'data-active-state'?: 'on' | 'off'
  'data-disabled'?: boolean | string
  /**
   * 为 true 时不在 mousedown 上 preventDefault，允许按钮抢焦点（如链接 URL 输入触发前）。
   * 默认 false：保留 ProseMirror 选区。
   */
  allowFocusOnMouseDown?: boolean
}

function ShortcutDisplay(props: { shortcuts: string[] }) {
  if (props.shortcuts.length === 0) return null
  return (
    <KbdGroup>
      {props.shortcuts.map(function (key, index) {
        return (
          <Fragment key={`${index}-${key}`}>
            {index > 0 ? <span className="px-0.5 text-xs opacity-50">+</span> : null}
            <Kbd>{key}</Kbd>
          </Fragment>
        )
      })}
    </KbdGroup>
  )
}

function resolveVariant(dataStyle: string | undefined) {
  if (dataStyle === 'primary' || dataStyle === 'default') return 'default' as const
  if (dataStyle === 'outline') return 'outline' as const
  return 'ghost' as const
}

/** 含文案（菜单行）时不能再用 icon 方钮 + justify-center，否则下拉会水平居中、留白过大 */
function hasLabelChild(children: ReactNode): boolean {
  return Children.toArray(children).some(function (child) {
    if (typeof child === 'string' || typeof child === 'number') return String(child).trim().length > 0
    if (!isValidElement<{ children?: ReactNode }>(child)) return false
    if (child.type === 'span' || child.type === 'label') return true
    if (child.props?.children != null) return hasLabelChild(child.props.children)
    return false
  })
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function TipTapButton(
  props,
  ref
) {
  const {
    className,
    children,
    tooltip,
    showTooltip = true,
    shortcutKeys,
    'aria-label': ariaLabel,
    'aria-pressed': ariaPressed,
    'data-style': dataStyle,
    'data-active-state': activeState,
    'data-disabled': dataDisabled,
    disabled,
    type = 'button',
    tabIndex = -1,
    onClick,
    onMouseDown,
    allowFocusOnMouseDown = false,
    value: _value,
    ...rest
  } = props

  const shortcuts = useMemo(
    function () {
      return parseShortcutKeys({ shortcutKeys })
    },
    [shortcutKeys]
  )
  const isActive = activeState === 'on' || ariaPressed === true
  const isDisabled = Boolean(disabled || dataDisabled === true || dataDisabled === '')
  const variant = resolveVariant(dataStyle)
  const useToggle = ariaPressed !== undefined || activeState !== undefined
  const isMenuRow = hasLabelChild(children)

  const shared = {
    ref,
    type,
    disabled: isDisabled,
    'aria-label': ariaLabel,
    tabIndex,
    className: cn(
      'shrink-0 [&_svg]:size-3.5',
      // 有文案：用条形钮并左对齐；宽度由工具栏内容撑开，菜单行由 DropdownMenuItem 加 w-full
      isMenuRow && 'h-7 justify-start gap-1.5 px-2',
      className
    ),
    onClick,
    onMouseDown(event: MouseEvent<HTMLButtonElement>) {
      // 默认保留 ProseMirror 选区；需要聚焦的入口传 allowFocusOnMouseDown
      if (!allowFocusOnMouseDown) {
        event.preventDefault()
      }
      onMouseDown?.(event)
    }
  }

  const control = useToggle ? (
    <Toggle
      {...shared}
      size="sm"
      variant={variant === 'outline' ? 'outline' : 'default'}
      pressed={isActive}
      aria-pressed={isActive}
      {...rest}>
      {children}
    </Toggle>
  ) : (
    <DesignButton
      {...shared}
      size={isMenuRow ? 'sm' : 'icon-sm'}
      variant={variant}
      {...rest}>
      {children}
    </DesignButton>
  )

  // TooltipProvider 由上层 Toolbar / Section 提供，避免每个按钮各挂一份
  if (!tooltip || !showTooltip) return control

  return (
    <Tooltip>
      <TooltipTrigger render={control} />
      <TooltipContent side="bottom">
        <span className="inline-flex items-center gap-1.5">
          <span>{tooltip}</span>
          <ShortcutDisplay shortcuts={shortcuts} />
        </span>
      </TooltipContent>
    </Tooltip>
  )
})

Button.displayName = 'Button'

export const ButtonGroup = forwardRef<
  HTMLDivElement,
  React.ComponentProps<'div'> & { orientation?: 'horizontal' | 'vertical' }
>(function ButtonGroup({ className, children, orientation = 'vertical', ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        'flex gap-0.5',
        orientation === 'horizontal'
          ? 'flex-row flex-wrap items-center'
          : 'w-full flex-col items-stretch',
        className
      )}
      data-orientation={orientation}
      role="group"
      {...props}>
      {children}
    </div>
  )
})

ButtonGroup.displayName = 'ButtonGroup'

export default Button
