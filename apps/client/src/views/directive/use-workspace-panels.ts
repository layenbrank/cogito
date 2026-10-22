import { usePanelRef } from '@i-thinking/design/components/resizable'
import { useEffect, useState } from 'react'

/**
 * 编排台侧面分栏（动作库 / 检查器）的开合状态与面板引用。
 * 底部运行台改由终端 store 的 `open` 控制，见 DirectiveDock。
 */
function useWorkspacePanels() {
  const catalogRef = usePanelRef()
  const inspectorRef = usePanelRef()
  const [isCatalogOpen, setCatalogOpen] = useState(true)
  const [isInspectorOpen, setInspectorOpen] = useState(true)

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

  return {
    catalogRef,
    inspectorRef,
    isCatalogOpen,
    isInspectorOpen,
    setCatalogOpen,
    setInspectorOpen
  }
}

export { useWorkspacePanels }
