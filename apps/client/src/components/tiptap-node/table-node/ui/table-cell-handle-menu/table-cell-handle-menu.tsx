// @ts-nocheck
import { forwardRef, useCallback, useState } from 'react'
import type { Editor } from '@tiptap/react'

// --- Hooks ---
import { useTiptapEditor } from '@/hooks/use-tiptap-editor'

// --- Lib ---
import { cn, SR_ONLY } from '@/lib/tiptap-utils'

// --- UI ---
import { ColorMenu } from '@/components/tiptap-ui/color-menu/color-menu.tsx'
import { TableAlignMenu } from '@/components/tiptap-node/table-node/ui/table-alignment-menu/table-alignment-menu.tsx'
import { useTableClearRowColumnContent } from '@/components/tiptap-node/table-node/ui/table-clear-row-column-content-button/use-table-clear-row-column-content.ts'
import { useTableMergeSplitCell } from '@/components/tiptap-node/table-node/ui/table-merge-split-cell-button/use-table-merge-split-cell.ts'

// --- UI Primitives ---
import { Button } from '@/components/tiptap-ui-primitive/button/button.tsx'
import {
  Combobox,
  ComboboxList
} from '@/components/tiptap-ui-primitive/combobox/combobox.tsx'
import {
  Menu,
  MenuButton,
  MenuContent,
  MenuGroup,
  MenuItem
} from '@/components/tiptap-ui-primitive/menu/menu.tsx'
import { Separator } from '@/components/tiptap-ui-primitive/separator/separator.tsx'

// --- Icons ---
import { Grip4Icon } from '@/components/tiptap-icons/grip-4-icon.tsx'

import './table-cell-handle-menu.scss'

interface TableAction {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  label: string
  onClick: () => void
  isAvailable: boolean
  isActive?: boolean
  shortcutBadge?: React.ReactNode
}

/**
 * Hook to manage all table actions and their availability
 */
function useTableActions() {
  const mergeCellAction = useTableMergeSplitCell({ action: 'merge' })
  const splitCellAction = useTableMergeSplitCell({ action: 'split' })
  const clearContentAction = useTableClearRowColumnContent({ resetAttrs: true })

  const mergeAction: TableAction = {
    icon: mergeCellAction.Icon,
    label: mergeCellAction.label,
    onClick: mergeCellAction.handleExecute,
    isAvailable: mergeCellAction.canExecute
  }

  const splitAction: TableAction = {
    icon: splitCellAction.Icon,
    label: splitCellAction.label,
    onClick: splitCellAction.handleExecute,
    isAvailable: splitCellAction.canExecute
  }

  const clearAction: TableAction = {
    icon: clearContentAction.Icon,
    label: clearContentAction.label,
    onClick: clearContentAction.handleClear,
    isAvailable: clearContentAction.canClearRowColumnContent
  }

  return {
    mergeAction,
    splitAction,
    clearAction
  }
}

/**
 * Hook to manage table handle menu state and interactions
 */
function useTableCellHandleMenu({ editor }: { editor: Editor | null }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const closeMenu = useCallback(() => {
    setIsMenuOpen(false)
    editor?.commands.unfreezeHandles()
  }, [editor])

  const handleMenuToggle = useCallback(
    (isOpen: boolean) => {
      setIsMenuOpen(isOpen)

      if (!editor) return

      if (isOpen) {
        editor.commands.freezeHandles()
      } else {
        editor.commands.unfreezeHandles()
      }
    },
    [editor]
  )

  return {
    isMenuOpen,
    handleMenuToggle,
    closeMenu
  }
}

const TableActionItem = ({ action }: { action: TableAction }) => {
  const { icon: Icon, label, onClick, isActive = false, shortcutBadge } = action

  return (
    <MenuItem
      render={
        <Button
          data-style="ghost"
          data-active-state={isActive ? 'on' : 'off'}
        />
      }
      onClick={onClick}>
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate text-xs">{label}</span>
      {shortcutBadge}
    </MenuItem>
  )
}

const TableActionMenu = ({ onClose }: { onClose: () => void }) => {
  const { mergeAction, splitAction, clearAction } = useTableActions()

  const hasMergeOrSplit = mergeAction.isAvailable || splitAction.isAvailable

  return (
    <MenuContent
      autoFocusOnShow
      modal
      style={{
        zIndex: 1000
      }}
      onClose={onClose}>
      <Combobox style={{ ...SR_ONLY, zIndex: 1000 }} />
      <ComboboxList style={{ minWidth: '15rem', zIndex: 1000 }}>
        {hasMergeOrSplit && (
          <MenuGroup
            style={{
              zIndex: 1000
            }}>
            {mergeAction.isAvailable && (
              <TableActionItem action={mergeAction} />
            )}
            {splitAction.isAvailable && (
              <TableActionItem action={splitAction} />
            )}
            <Separator orientation="horizontal" />
          </MenuGroup>
        )}

        <MenuGroup
          style={{
            zIndex: 1000
          }}>
          <ColorMenu />
          <TableAlignMenu />
          {clearAction.isAvailable && <TableActionItem action={clearAction} />}
        </MenuGroup>
      </ComboboxList>
    </MenuContent>
  )
}

interface TableCellHandleMenuProps extends React.ComponentPropsWithoutRef<'button'> {
  editor?: Editor | null
  onOpenChange?: (isOpen: boolean) => void
}

export const TableCellHandleMenu = forwardRef<
  HTMLButtonElement,
  TableCellHandleMenuProps
>(({ editor: providedEditor, onOpenChange, className, ...props }, ref) => {
  const { editor } = useTiptapEditor(providedEditor)
  const { isMenuOpen, handleMenuToggle, closeMenu } = useTableCellHandleMenu({
    editor
  })

  const notifyMenuOpen = useCallback(
    function (isOpen: boolean) {
      handleMenuToggle(isOpen)
      onOpenChange?.(isOpen)
    },
    [handleMenuToggle, onOpenChange]
  )

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={notifyMenuOpen}
      placement="bottom-start"
      trigger={
        <MenuButton
          ref={ref}
          className={cn(
            'expandable-menu-button',
            isMenuOpen && 'menu-opened',
            className
          )}
          aria-label={t('EDITOR_TABLE_CELLS_OPTION')}
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          {...props}>
          <Grip4Icon className="size-3.5 shrink-0" />
        </MenuButton>
      }>
      <TableActionMenu onClose={closeMenu} />
    </Menu>
  )
})

TableCellHandleMenu.displayName = 'TableCellHandleMenu'

export { TableActionMenu }

import { t } from '@/views/knowledge/locale.ts'