import { usePanelRef } from '@i-thinking/design/components/resizable'
import { useEffect, useState } from 'react'

/**
 * 编排台三面分栏的开合状态与面板引用。
 *
 * 开合过渡由组件库（`[data-panel]` 过渡 + `collapsibleOnDrag`）统一承担，
 * 这里只管状态与 ref，不再自己做动画计时。
 */
function useWorkspacePanels() {
  const catalogRef = usePanelRef()
  const inspectorRef = usePanelRef()
  const runRef = usePanelRef()
  const [isCatalogOpen, setCatalogOpen] = useState(true)
  const [isInspectorOpen, setInspectorOpen] = useState(true)
  const [isRunOpen, setRunOpen] = useState(true)

  useEffect(
    function () {
      const panel = catalogRef.current
      if (!panel) return
      if (isCatalogOpen) panel.expand()
      else panel.collapse()
    },
    [isCatalogOpen, catalogRef]
  )

  useEffect(
    function () {
      const panel = inspectorRef.current
      if (!panel) return
      if (isInspectorOpen) panel.expand()
      else panel.collapse()
    },
    [isInspectorOpen, inspectorRef]
  )

  useEffect(
    function () {
      const panel = runRef.current
      if (!panel) return
      if (isRunOpen) panel.expand()
      else panel.collapse()
    },
    [isRunOpen, runRef]
  )

  return {
    catalogRef,
    inspectorRef,
    runRef,
    isCatalogOpen,
    isInspectorOpen,
    isRunOpen,
    setCatalogOpen,
    setInspectorOpen,
    setRunOpen
  }
}

export { useWorkspacePanels }
