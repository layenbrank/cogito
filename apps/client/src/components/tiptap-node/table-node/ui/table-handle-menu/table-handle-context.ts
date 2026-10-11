// @ts-nocheck
'use client'

import { createContext, useContext } from 'react'
import type { Editor } from '@tiptap/react'
import type { Node } from '@tiptap/pm/model'
import type { Orientation } from '@/components/tiptap-node/table-node/lib/tiptap-table-utils'

interface BaseProps {
  editor?: Editor | null
  orientation: Orientation
  index?: number
  tableNode?: Node
  tablePos?: number
}

interface TableHandleMenuProps extends BaseProps {
  onToggleOtherHandle?: (visible: boolean) => void
  onOpenChange?: (open: boolean) => void
  dragStart?: (e: React.DragEvent) => void
}

type TableHandleContextValue = BaseProps

interface TableActionItemProps {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  label: string
  onClick: () => void
  disabled?: boolean
  isActive?: boolean
  shortcutBadge?: React.ReactNode
}

const TableHandleContext = createContext<TableHandleContextValue | null>(null)

function useTableHandleContext() {
  const context = useContext(TableHandleContext)
  if (!context) {
    throw new Error(
      'useTableHandleContext must be used within TableHandleProvider'
    )
  }
  return context
}

export { TableHandleContext, useTableHandleContext }
export type { BaseProps, TableHandleMenuProps, TableActionItemProps, TableHandleContextValue }
