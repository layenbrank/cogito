import { clsx } from 'clsx'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'

import { hasChildren } from '@/components/contextmenu/menu'
import type {
  MenuClassNames,
  MenuStyles,
  ParsedMenuItem
} from '@/components/contextmenu/menu'

function RightArrow() {
  return (
    <svg
      className="contextmenu-arrow-icon"
      viewBox="0 0 12 12"
      width="10"
      height="10"
      aria-hidden="true"
      focusable="false">
      <path
        d="M4.2 1.5L8.7 6L4.2 10.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface MenuItemRowProps {
  item: ParsedMenuItem
  isActive: boolean
  isExpanded: boolean
  classNames?: MenuClassNames
  styles?: MenuStyles
  onMouseEnter: () => void
  onPointerDown: (event: ReactPointerEvent) => void
  renderItem?: (item: ParsedMenuItem, node: ReactNode) => ReactNode
}

function MenuItemRow(props: MenuItemRowProps) {
  const isSubmenu = hasChildren(props.item)
  const shortcut = props.item.shortcut

  const node = (
    <div
      role="menuitem"
      tabIndex={-1}
      data-contextmenu-key={props.item.key}
      aria-disabled={props.item.disabled || undefined}
      aria-haspopup={isSubmenu || undefined}
      aria-expanded={isSubmenu ? props.isExpanded : undefined}
      className={clsx(
        'contextmenu-item',
        props.classNames?.item,
        props.item.className,
        props.isActive && 'is-active',
        props.item.disabled && 'is-disabled',
        props.item.danger && 'is-danger',
        isSubmenu && 'has-children'
      )}
      style={{ ...props.styles?.item, ...props.item.style }}
      onMouseEnter={props.onMouseEnter}
      onPointerDown={props.onPointerDown}>
      {props.item.icon ? (
        <span
          className={clsx('contextmenu-icon', props.classNames?.icon)}
          style={props.styles?.icon}>
          {props.item.icon}
        </span>
      ) : (
        <span className="contextmenu-icon contextmenu-icon-empty" />
      )}
      <span
        className={clsx('contextmenu-label', props.classNames?.label)}
        style={props.styles?.label}>
        {props.item.label}
      </span>
      {shortcut ? (
        <span
          className={clsx('contextmenu-shortcut', props.classNames?.shortcut)}
          style={props.styles?.shortcut}>
          {shortcut}
        </span>
      ) : null}
      {isSubmenu ? (
        <span
          className={clsx('contextmenu-arrow', props.classNames?.arrow)}
          style={props.styles?.arrow}>
          <RightArrow />
        </span>
      ) : (
        <span className="contextmenu-arrow contextmenu-arrow-empty" />
      )}
    </div>
  )

  return props.renderItem ? props.renderItem(props.item, node) : node
}

interface MenuItemsProps {
  items: ParsedMenuItem[]
  activeKey?: string
  expandedKey?: string
  classNames?: MenuClassNames
  styles?: MenuStyles
  onItemMouseEnter: (item: ParsedMenuItem) => void
  onItemPointerDown: (event: ReactPointerEvent, item: ParsedMenuItem) => void
  renderItem?: (item: ParsedMenuItem, node: ReactNode) => ReactNode
}

type ItemRenderer = (props: MenuItemsProps, item: ParsedMenuItem) => ReactNode

const ITEM_RENDERERS: Record<string, ItemRenderer> = {
  divider: function (_props, item) {
    return (
      <hr
        key={item.key}
        className={clsx('contextmenu-divider', _props.classNames?.divider, item.className)}
        style={{ ..._props.styles?.divider, ...item.style }}
      />
    )
  },
  group: function (props, item) {
    return (
      <div
        key={item.key}
        className={clsx('contextmenu-group', item.className)}
        style={item.style}
        role="group">
        {item.label ? <div className="contextmenu-group-title">{item.label}</div> : null}
        {item.children ? (
          <MenuItems
            {...props}
            items={item.children}
          />
        ) : null}
      </div>
    )
  },
  item: function (props, item) {
    return (
      <MenuItemRow
        key={item.key}
        item={item}
        isActive={props.activeKey === item.key}
        isExpanded={props.expandedKey === item.key}
        classNames={props.classNames}
        styles={props.styles}
        onMouseEnter={function () {
          props.onItemMouseEnter(item)
        }}
        onPointerDown={function (event) {
          props.onItemPointerDown(event, item)
        }}
        renderItem={props.renderItem}
      />
    )
  }
}

function MenuItems(props: MenuItemsProps) {
  return (
    <>
      {props.items.map(function (item) {
        const render = ITEM_RENDERERS[item.type] ?? ITEM_RENDERERS.item
        return render(props, item)
      })}
    </>
  )
}

export type { MenuItemRowProps, MenuItemsProps }
export { MenuItems, MenuItemRow, RightArrow }
