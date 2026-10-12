import { usePanelRef } from '@i-thinking/design/components/resizable'
import { useEffect, useRef, useState } from 'react'

const PANEL_ANIMATION_MS = 240

function useWorkspacePanels() {
  const catalogRef = usePanelRef()
  const inspectorRef = usePanelRef()
  const runRef = usePanelRef()
  const animationTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isCatalogOpen, setCatalogOpen] = useState(true)
  const [isInspectorOpen, setInspectorOpen] = useState(true)
  const [isRunOpen, setRunOpen] = useState(true)
  const [isPanelAnimating, setPanelAnimating] = useState(false)

  function withPanelAnimation(update: () => void) {
    setPanelAnimating(true)
    update()
    if (animationTimer.current) clearTimeout(animationTimer.current)
    animationTimer.current = setTimeout(function () {
      setPanelAnimating(false)
      animationTimer.current = null
    }, PANEL_ANIMATION_MS)
  }

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

  useEffect(function () {
    return function () {
      if (animationTimer.current) clearTimeout(animationTimer.current)
    }
  }, [])

  return {
    catalogRef,
    inspectorRef,
    runRef,
    isCatalogOpen,
    isInspectorOpen,
    isRunOpen,
    isPanelAnimating,
    setCatalogOpen,
    setInspectorOpen,
    setRunOpen,
    withPanelAnimation
  }
}

export { useWorkspacePanels }
