// @ts-nocheck
import type { CSSProperties } from 'react'
import type { EditorState, Selection } from '@tiptap/pm/state'
import type { Node } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { CellSelection, cellAround } from '@tiptap/pm/tables'

type ResizeHandle = 'tl' | 'tr' | 'bl' | 'br' | null

// if an element’s edge is within 5px of the selection edge,
// it is treated as aligned.
const CORNER_DETECTION_TOLERANCE = 5

const findCellAtCoordinates = (
  state: EditorState,
  view: EditorView,
  x: number,
  y: number
) => {
  const pos = view.posAtCoords({ left: x, top: y })?.pos
  if (pos == null) return null

  const $pos = state.doc.resolve(pos)
  return cellAround($pos)
}

const findSelectionBoundingRect = (
  view: EditorView,
  selection: Selection
): DOMRect | null => {
  if (!(selection instanceof CellSelection)) return null

  const cells: Element[] = []
  selection.forEachCell((_node: Node, pos: number) => {
    const dom = view.nodeDOM(pos) as Element | null
    if (dom) cells.push(dom)
  })

  if (cells.length === 0) return null

  const bounds = {
    left: Infinity,
    top: Infinity,
    right: -Infinity,
    bottom: -Infinity
  }

  cells.forEach((cell) => {
    const rect = cell.getBoundingClientRect()
    bounds.left = Math.min(bounds.left, rect.left)
    bounds.top = Math.min(bounds.top, rect.top)
    bounds.right = Math.max(bounds.right, rect.right)
    bounds.bottom = Math.max(bounds.bottom, rect.bottom)
  })

  return new DOMRect(
    bounds.left,
    bounds.top,
    bounds.right - bounds.left,
    bounds.bottom - bounds.top
  )
}

const findSingleCellBoundingRect = (
  view: EditorView,
  cellPos: number
): DOMRect | null => {
  const cellDom = view.nodeDOM(cellPos) as Element | null
  if (!cellDom) return null

  const rect = cellDom.getBoundingClientRect()
  return new DOMRect(rect.left, rect.top, rect.width, rect.height)
}

const makeVirtualReference = (rect: DOMRect) => ({
  getBoundingClientRect: () => rect
})

interface CornerPositions {
  topLeft: number | null
  topRight: number | null
  bottomLeft: number | null
  bottomRight: number | null
}

const findCornerCells = (
  view: EditorView,
  selection: CellSelection,
  selectionRect: DOMRect
): CornerPositions => {
  const corners: CornerPositions = {
    topLeft: null,
    topRight: null,
    bottomLeft: null,
    bottomRight: null
  }

  // It takes two numbers: value1 and value2.
  // It calculates the absolute difference between them: Math.abs(value1 - value2).
  // It checks whether that difference is less than 5 (CORNER_DETECTION_TOLERANCE).
  // It returns a boolean:
  // true → if value1 and value2 are within 5 (CORNER_DETECTION_TOLERANCE) of each other.
  // false → if they are 5 or more units apart.
  const isNearEdge = (value1: number, value2: number) =>
    Math.abs(value1 - value2) < CORNER_DETECTION_TOLERANCE

  selection.forEachCell((_node: Node, pos: number) => {
    const dom = view.nodeDOM(pos) as Element | null
    if (!dom) return

    const cellRect = dom.getBoundingClientRect()

    // Top-left corner
    if (
      isNearEdge(cellRect.left, selectionRect.left) &&
      isNearEdge(cellRect.top, selectionRect.top)
    ) {
      corners.topLeft = pos
    }

    // Top-right corner
    if (
      isNearEdge(cellRect.right, selectionRect.right) &&
      isNearEdge(cellRect.top, selectionRect.top)
    ) {
      corners.topRight = pos
    }

    // Bottom-left corner
    if (
      isNearEdge(cellRect.left, selectionRect.left) &&
      isNearEdge(cellRect.bottom, selectionRect.bottom)
    ) {
      corners.bottomLeft = pos
    }

    // Bottom-right corner
    if (
      isNearEdge(cellRect.right, selectionRect.right) &&
      isNearEdge(cellRect.bottom, selectionRect.bottom)
    ) {
      corners.bottomRight = pos
    }
  })

  return corners
}

const findAnchorCellForHandle = (
  view: EditorView,
  selection: CellSelection,
  selectionRect: DOMRect,
  handle: ResizeHandle
): { pos: number } | null => {
  if (!handle) return null

  const corners = findCornerCells(view, selection, selectionRect)

  const anchorMap: Record<NonNullable<ResizeHandle>, keyof CornerPositions> = {
    tl: 'bottomRight',
    tr: 'bottomLeft',
    bl: 'topRight',
    br: 'topLeft'
  }

  const anchorPos = corners[anchorMap[handle]]
  return anchorPos ? { pos: anchorPos } : null
}

const makeHandleStyles = (): React.CSSProperties => ({
  position: 'absolute',
  width: 15,
  height: 15,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  pointerEvents: 'auto',
  zIndex: 10
})

const makeCornerHandleStyles = (
  position: 'tl' | 'tr' | 'bl' | 'br',
  isActiveHandle: boolean,
  isDisabled: boolean = false
): React.CSSProperties => {
  const baseStyles = makeHandleStyles()

  const positionStyles: Record<typeof position, React.CSSProperties> = {
    tl: {
      top: -7.5,
      left: -7.5,
      cursor: isDisabled ? 'default' : 'nwse-resize'
    },
    tr: {
      top: -7.5,
      right: -7.5,
      cursor: isDisabled ? 'default' : 'nesw-resize'
    },
    bl: {
      bottom: -7.5,
      left: -7.5,
      cursor: isDisabled ? 'default' : 'nesw-resize'
    },
    br: {
      bottom: -7.5,
      right: -7.5,
      cursor: isDisabled ? 'default' : 'nwse-resize'
    }
  }

  return {
    ...baseStyles,
    ...positionStyles[position],
    opacity: isDisabled ? 0.3 : isActiveHandle ? 1 : 0.5,
    pointerEvents: isDisabled ? 'none' : 'auto'
  }
}

export type { ResizeHandle }
export {
  findCellAtCoordinates,
  findSelectionBoundingRect,
  findSingleCellBoundingRect,
  makeVirtualReference,
  findAnchorCellForHandle,
  makeCornerHandleStyles
}
