// @ts-nocheck
'use client'

import type { ComponentType } from 'react'
import { Button } from '@/components/tiptap-ui-primitive/button/button.tsx'
import { Combobox, ComboboxList } from '@/components/tiptap-ui-primitive/combobox/combobox.tsx'
import { MenuContent, MenuGroup, MenuItem } from '@/components/tiptap-ui-primitive/menu/menu.tsx'
import { Separator } from '@/components/tiptap-ui-primitive/separator/separator.tsx'
import { ColorMenu } from '@/components/tiptap-ui/color-menu/color-menu.tsx'
import { TableAlignMenu } from '@/components/tiptap-node/table-node/ui/table-alignment-menu/table-alignment-menu.tsx'
import { SR_ONLY } from '@/lib/tiptap-utils'
import { useTableActionItems } from './use-table-action-items.ts'
import { useTableHandleMenu } from './use-table-handle-menu.ts'
import { type TableActionItemProps } from './table-handle-context.ts'

const TableActionItem = ({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  isActive = false,
  shortcutBadge
}: TableActionItemProps) => (
  <MenuItem
    render={
      <Button
        data-style="ghost"
        data-active-state={isActive ? 'on' : 'off'}
      />
    }
    onClick={onClick}
    disabled={disabled}>
    <Icon className="tiptap-button-icon" />
    <span className="tiptap-button-text">{label}</span>
    {shortcutBadge}
  </MenuItem>
)

function TableActionItemList(props: {
  prefix: string
  items: Array<{ label: string; icon: ComponentType; onClick: () => void; disabled?: boolean }>
}) {
  if (props.items.length === 0) return null
  return (
    <>
      <MenuGroup>
        {props.items.map(function (item) {
          return (
            <TableActionItem
              key={`${props.prefix}-${item.label}`}
              {...item}
            />
          )
        })}
      </MenuGroup>
      <Separator orientation="horizontal" />
    </>
  )
}

/**
 * Action group component containing add and delete actions
 */
function TableActionGroup() {
  const { index, orientation } = useTableHandleContext()
  const actions = useTableActionItems()
  const hasHeaderAction = actions.headerAction.isVisible && index === 0
  const hasActions =
    actions.deleteAction.isVisible ||
    actions.duplicateAction.isVisible ||
    actions.clearContentAction.isVisible
  const isEmpty =
    !hasActions &&
    actions.addItems.length === 0 &&
    actions.moveItems.length === 0 &&
    actions.sortItems.length === 0 &&
    !hasHeaderAction

  if (isEmpty) return null

  return (
    <>
      {hasHeaderAction ? (
        <>
          <MenuGroup>
            <TableActionItem
              icon={actions.headerAction.Icon}
              label={actions.headerAction.label}
              disabled={!actions.headerAction.canToggleHeader}
              isActive={actions.headerAction.isActive}
              onClick={actions.headerAction.handleToggle}
            />
          </MenuGroup>
          <Separator orientation="horizontal" />
        </>
      ) : null}

      <TableActionItemList
        prefix="move"
        items={actions.moveItems}
      />
      <TableActionItemList
        prefix="add"
        items={actions.addItems}
      />
      <TableActionItemList
        prefix="sort"
        items={actions.sortItems}
      />

      <MenuGroup>
        <ColorMenu />
        <TableAlignMenu
          index={index}
          orientation={orientation}
        />
        {actions.clearContentAction.isVisible ? (
          <TableActionItem
            icon={actions.clearContentAction.Icon}
            label={actions.clearContentAction.label}
            disabled={!actions.clearContentAction.canClearRowColumnContent}
            onClick={actions.clearContentAction.handleClear}
          />
        ) : null}
      </MenuGroup>
      <Separator orientation="horizontal" />

      {hasActions ? (
        <MenuGroup>
          {actions.duplicateAction.isVisible ? (
            <TableActionItem
              icon={actions.duplicateAction.Icon}
              label={actions.duplicateAction.label}
              disabled={!actions.duplicateAction.canDuplicateRowColumn}
              onClick={actions.duplicateAction.handleDuplicate}
            />
          ) : null}
          {actions.deleteAction.isVisible ? (
            <TableActionItem
              icon={actions.deleteAction.Icon}
              label={actions.deleteAction.label}
              disabled={!actions.deleteAction.canDeleteRowColumn}
              onClick={actions.deleteAction.handleDelete}
            />
          ) : null}
        </MenuGroup>
      ) : null}
    </>
  )
}

/**
 * Menu content component
 */
const TableActionMenu = () => {
  const { resetMenu } = useTableHandleMenu()

  return (
    <MenuContent
      style={{
        zIndex: 1000
      }}
      autoFocusOnShow
      autoFocusOnHide={false}
      modal
      onClose={resetMenu}>
      <Combobox style={SR_ONLY} />
      <ComboboxList style={{ minWidth: '15rem' }}>
        <TableActionGroup />
      </ComboboxList>
    </MenuContent>
  )
}

