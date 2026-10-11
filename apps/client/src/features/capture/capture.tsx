import { useEffect, useRef, useState } from 'react'

import { clsx } from 'clsx'
import { useHotkeys } from 'react-hotkeys-hook'
import { useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'

import { ContextMenu, useContextMenu } from '@/components/contextmenu'
import { CaptureErrorBoundary } from '@/features/capture/capture-error-boundary'
import { CaptureErrorPanel, CaptureLoadingMask } from '@/features/capture/capture-status'
import { Annotation, type AnnotationHandle } from '@/features/capture/components/annotation'
import { type GraphicsEnum, type GraphicsProps } from '@/features/capture/components/graphics'
import Magnifier from '@/features/capture/components/magnifier'
import Utility from '@/features/capture/components/utility'
import { fetchImageFromPath, takePendingScreenshot, takeScreenshot } from '@/features/capture/tauri'
import { useCaptureActions } from '@/features/capture/use-capture-actions'
import { useCaptureHistory } from '@/features/capture/use-capture-history'
import { useCaptureStage, type Phase } from '@/features/capture/use-capture-stage'
import { useKeyCode } from '@/keycodes/react'
import { DETECT_WINDOW, useSettingsStore } from '@/stores/setting'

import styles from '@/features/capture/capture.module.scss'

export interface CaptureProps {
  /** Rendered inside the shared overlay window. */
  embedded?: boolean
  /** false 时不加载截图；为 true 时消费 capture:open 的 pending */
  active?: boolean
  onExit?: () => void
  onClose?: () => void
  onTexture?: (input: { src: string; w: number; h: number }) => void
}

function Capture(props: CaptureProps = {}) {
  const { onExit, onClose, onTexture, active = true } = props
  const [phase, onUpdatePhase] = useState<Phase>('selecting')
  const [graphics, onUpdateGraphics] = useState<GraphicsEnum | null>(null)
  const [annotations, onUpdateAnnotations] = useState<GraphicsProps[]>([])
  const [selection, onUpdateSelection] = useState<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)
  const [color, onUpdateColor] = useState('#4080ff')
  const [thickness, onUpdateThickness] = useState(2)
  const [filled, onUpdateFilled] = useState(false)
  const [opacity, onUpdateOpacity] = useState(1)
  const [fontSize, onUpdateFontSize] = useState(18)
  const [selectedID, onUpdateSelectedID] = useState<string | null>(null)
  const [selectedIDs, onUpdateSelectedIDs] = useState<string[]>([])
  const [sourceImage, onUpdateSourceImage] = useState<HTMLImageElement | null>(null)
  const [captureStatus, onUpdateCaptureStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [captureError, onUpdateCaptureError] = useState<string | null>(null)

  const detect = useSettingsStore(function (state) {
    return state.settings.capture.detect
  })
  const isWindowDetect = detect === DETECT_WINDOW
  const isReducedMotion = useReducedMotion()
  const { present: presentContextMenu } = useContextMenu()
  const annotationRef = useRef<AnnotationHandle>(null)
  const { canUndo, canRedo, commitHistory, undo, redo, resetHistory } = useCaptureHistory()

  const { regionsRef, handlePress, handleMove, handleRelease, resetDragState } = useCaptureStage({
    phase,
    graphics,
    annotations,
    selection,
    color,
    thickness,
    filled,
    opacity,
    fontSize,
    isWindowDetect,
    annotationRef,
    onUpdateAnnotations,
    onUpdateSelection,
    onUpdatePhase,
    commitHistory
  })

  const actions = useCaptureActions({
    annotations,
    selectedIDs,
    selection,
    phase,
    annotationRef,
    presentContextMenu,
    commitHistory,
    undo,
    redo,
    resetHistory,
    resetDragState,
    onUpdateAnnotations,
    onUpdateSelectedIDs,
    onUpdateSelectedID,
    onUpdateColor,
    onUpdateThickness,
    onUpdateFilled,
    onUpdateOpacity,
    onUpdateFontSize,
    onUpdateGraphics,
    onUpdatePhase,
    onUpdateSelection,
    onExit,
    onTexture
  })

  useHotkeys('mod+z', function (e) {
    e.preventDefault()
    actions.handleUndo()
  })
  useHotkeys(['mod+shift+z', 'mod+y'], function (e) {
    e.preventDefault()
    actions.handleRedo()
  })
  useHotkeys(['delete', 'backspace'], function (e) {
    e.preventDefault()
    actions.handleDelete()
  })
  useKeyCode('escape', function () {
    actions.handleEscape()
    return true
  })
  useHotkeys('mod+r', function (e) {
    e.preventDefault()
    actions.handleRefresh()
  })

  async function loadCapture(forceFresh = false) {
    onUpdateCaptureStatus('loading')
    onUpdateCaptureError(null)
    try {
      const result = forceFresh ? await takeScreenshot() : await takePendingScreenshot()
      if (!result) {
        throw new Error('未找到预截图，请点重试')
      }
      const img = await fetchImageFromPath(result.path)
      regionsRef.current = result.regions ?? []
      onUpdateSourceImage(img)
      onUpdateCaptureStatus('ready')
    } catch (err) {
      console.error('[capture] 真实截图失败', err)
      onUpdateCaptureError(String(err))
      onUpdateCaptureStatus('error')
    }
  }

  const loadStartedRef = useRef(false)

  useEffect(function () {
    void useSettingsStore.getState().toInitialize()
  }, [])

  useEffect(
    function () {
      if (!active) {
        loadStartedRef.current = false
        return
      }
      if (loadStartedRef.current) return
      loadStartedRef.current = true
      let cancelled = false
      void (async function () {
        try {
          const result = await takePendingScreenshot()
          if (cancelled) return
          if (!result) {
            throw new Error('未找到预截图，请点重试')
          }
          const img = await fetchImageFromPath(result.path)
          if (cancelled) return
          regionsRef.current = result.regions ?? []
          onUpdateSourceImage(img)
          onUpdateCaptureStatus('ready')
        } catch (err) {
          if (cancelled) return
          console.error('[capture] 真实截图失败', err)
          onUpdateCaptureError(String(err))
          onUpdateCaptureStatus('error')
        }
      })()
      return function () {
        cancelled = true
      }
    },
    [active, regionsRef]
  )

  return (
    <CaptureErrorBoundary
      onError={function () {
        onExit?.()
      }}
      onClose={onClose ?? function () {}}>
      <div className={clsx(styles.capture)}>
        {captureStatus === 'error' ? (
          <CaptureErrorPanel
            message={captureError}
            onRetry={function () {
              void loadCapture(true)
            }}
            onExit={onExit}
          />
        ) : (
          <>
            {captureStatus === 'loading' ? <CaptureLoadingMask /> : null}
            <m.div
              key="capture-ready"
              initial={isReducedMotion ? undefined : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{
                duration: 0.1,
                ease: [0.22, 1, 0.36, 1]
              }}>
              <Annotation
                ref={annotationRef}
                onClose={onClose ?? function () {}}
                onMove={handleMove}
                clipRect={selection}
                onPress={handlePress}
                selectedID={selectedID}
                selectedIDs={selectedIDs}
                annotations={annotations}
                sourceImage={sourceImage}
                onRelease={handleRelease}
                onSelect={actions.handleSelect}
                onSelectMany={actions.handleSelectMany}
                interactive={captureStatus === 'ready'}
                onChange={actions.handleAnnotationChange}
                onBatchChange={actions.handleAnnotationsBatchChange}
                onContextMenuAnnotation={actions.handleContextMenuAnnotation}
                onEditStart={function () {
                  actions.handleSelect(null)
                }}
                selection={selection}
                phase={phase}
                onSelectionChange={onUpdateSelection}
                graphicsActive={graphics !== null}
              />
            </m.div>

            <Magnifier
              sourceImage={sourceImage}
              visible={phase === 'selecting' && captureStatus === 'ready'}
              onClose={onClose ?? function () {}}
            />

            {captureStatus === 'ready' && (
              <Utility
                color={color}
                filled={filled}
                canRedo={canRedo}
                canUndo={canUndo}
                active={graphics}
                opacity={opacity}
                onCopy={actions.handleCopy}
                onPin={actions.handlePin}
                fontSize={fontSize}
                onRedo={actions.handleRedo}
                onUndo={actions.handleUndo}
                thickness={thickness}
                onClose={actions.handleClose}
                onRefresh={actions.handleRefresh}
                onSave={actions.handleSave}
                onUpdateColor={actions.handleUpdateColor}
                onUpdateUtility={actions.handleUpdateGraphics}
                onUpdateFilled={actions.handleUpdateFilled}
                onUpdateOpacity={actions.handleUpdateOpacity}
                onUpdateFontSize={actions.handleUpdateFontSize}
                onUpdateThickness={actions.handleUpdateThickness}
                selection={phase === 'selecting' ? null : selection}
              />
            )}
            <ContextMenu.Host />
          </>
        )}
      </div>
    </CaptureErrorBoundary>
  )
}

export type { Phase }
export default Capture
