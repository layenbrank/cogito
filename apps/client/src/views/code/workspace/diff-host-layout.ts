import { useEffect, useRef, useState, type RefObject } from 'react'

/** 与 VS Code `diffEditor.renderSideBySideInlineBreakpoint` 默认一致；带滞回避免临界抖动 */
const SIDE_BY_SIDE_BREAKPOINT = 900
const SIDE_BY_SIDE_ENTER = 920
const SIDE_BY_SIDE_EXIT = 880

type DiffLayout = 'sideBySide' | 'inline'

interface SideRow {
  left: string | null
  right: string | null
  tag: 'ctx' | 'del' | 'add' | 'mod'
}

/**
 * 将 unified hunk 行对齐成并排行（连续删改配对）。
 */
function toSideRows(lines: string[]): SideRow[] {
  const rows: SideRow[] = []
  let index = 0
  while (index < lines.length) {
    const kind = lines[index]?.charAt(0)
    if (kind === ' ') {
      const body = lines[index].slice(1)
      rows.push({ left: body, right: body, tag: 'ctx' })
      index += 1
      continue
    }
    if (kind === '-') {
      const deleted: string[] = []
      while (index < lines.length && lines[index].charAt(0) === '-') {
        deleted.push(lines[index].slice(1))
        index += 1
      }
      const added: string[] = []
      while (index < lines.length && lines[index].charAt(0) === '+') {
        added.push(lines[index].slice(1))
        index += 1
      }
      const count = Math.max(deleted.length, added.length)
      for (let offset = 0; offset < count; offset += 1) {
        const left = deleted[offset] ?? null
        const right = added[offset] ?? null
        const tag =
          left !== null && right !== null ? 'mod' : left !== null ? 'del' : 'add'
        rows.push({ left, right, tag })
      }
      continue
    }
    if (kind === '+') {
      rows.push({ left: null, right: lines[index].slice(1), tag: 'add' })
      index += 1
      continue
    }
    index += 1
  }
  return rows
}

/**
 * 观测内容区宽度，驱动单列/并排。
 * 忽略 width≤0（节点 hidden 时），避免打开差异后卡在 inline。
 */
function useContainerLayout(isActive: boolean): {
  hostRef: RefObject<HTMLDivElement | null>
  layout: DiffLayout
} {
  const hostRef = useRef<HTMLDivElement>(null)
  const [layout, updateLayout] = useState<DiffLayout>('sideBySide')
  const layoutRef = useRef<DiffLayout>('sideBySide')

  useEffect(
    function () {
      const node = hostRef.current
      if (!node || typeof ResizeObserver === 'undefined') return

      function syncWidth(width: number) {
        if (!isActive || width < 1) return
        const current = layoutRef.current
        const next: DiffLayout =
          current === 'sideBySide'
            ? width < SIDE_BY_SIDE_EXIT
              ? 'inline'
              : 'sideBySide'
            : width >= SIDE_BY_SIDE_ENTER
              ? 'sideBySide'
              : 'inline'
        if (layoutRef.current === next) return
        layoutRef.current = next
        updateLayout(next)
      }

      const observer = new ResizeObserver(function (entries) {
        const entry = entries[0]
        if (!entry) return
        const width = entry.contentRect.width || node.clientWidth
        syncWidth(width)
      })
      observer.observe(node)

      if (isActive) {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            syncWidth(node.clientWidth)
          })
        })
      }

      return function () {
        observer.disconnect()
      }
    },
    [isActive]
  )

  return { hostRef, layout }
}

export { SIDE_BY_SIDE_BREAKPOINT, toSideRows, useContainerLayout }
export type { DiffLayout, SideRow }
