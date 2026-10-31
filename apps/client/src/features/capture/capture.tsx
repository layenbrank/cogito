import { useRef, useState } from 'react'

import { ContextMenu, useContextMenu } from '@/components/contextmenu'
import { CaptureErrorBoundary } from '@/features/capture/capture-error-boundary'
import { CaptureStageView } from '@/features/capture/capture-stage-view'
import { type AnnotationHandle } from '@/features/capture/components/annotation'
import { type GraphicsEnum, type GraphicsProps } from '@/features/capture/components/graphics'
import { runCapturePrune } from '@/features/capture/retention'
import { useCaptureActions } from '@/features/capture/use-capture-actions'
import { useCaptureHistory } from '@/features/capture/use-capture-history'
import { useCaptureLifecycle } from '@/features/capture/use-capture-lifecycle'
import { useCaptureOcr } from '@/features/capture/use-capture-ocr'
import { useCaptureStage, type Phase } from '@/features/capture/use-capture-stage'
import { SHORTCUT_COMMAND } from '@/keyboard/definitions'
import { useCommands, useShortcut } from '@/keyboard/react'
import { DETECT_ELEMENT, DETECT_WINDOW, useSettingsStore } from '@/stores/setting'
import { probeElements } from '@/features/capture/tauri'

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
  const [sourcePath, onUpdateSourcePath] = useState<string | null>(null)
  const [captureStatus, onUpdateCaptureStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [captureError, onUpdateCaptureError] = useState<string | null>(null)

  const detect = useSettingsStore(function (state) {
    return state.settings.capture.detect
  })
  const isWindowDetect = detect === DETECT_WINDOW || detect === DETECT_ELEMENT
  const isElementDetect = detect === DETECT_ELEMENT
  const { present: presentContextMenu } = useContextMenu()
  const annotationRef = useRef<AnnotationHandle>(null)
  const { canUndo, canRedo, commitHistory, undo, redo, resetHistory } = useCaptureHistory()

  const { regionsRef, hoverLabel, handlePress, handleMove, handleRelease, handleWheel, resetDragState } =
    useCaptureStage({
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
      isElementDetect,
      probeElements: isElementDetect ? probeElements : undefined,
      annotationRef,
      onUpdateAnnotations,
      onUpdateSelection,
      onUpdatePhase,
      commitHistory
    })

  const { sessionID, retake, bootstrapCapture } = useCaptureLifecycle({
    active,
    captureStatus,
    sourceImage,
    regionsRef,
    onUpdateSourcePath,
    onUpdateSourceImage,
    onUpdateCaptureStatus,
    onUpdateCaptureError
  })

  const { ocrText, ocrBusy, onUpdateOcrText, runOcr, insertOcrText } = useCaptureOcr({
    sourcePath,
    sourceImage,
    selection,
    color,
    thickness,
    fontSize,
    filled,
    opacity,
    annotations,
    onUpdateAnnotations,
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
    onRetake: function () {
      void retake()
    },
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
    onTexture,
    sessionID,
    onHistoryWritten: function () {
      void runCapturePrune({ silent: true })
    }
  })

  useCommands([
    {
      id: SHORTCUT_COMMAND.CAPTURE_UNDO,
      title: '截屏：撤销标注',
      group: '截屏',
      run: actions.handleUndo
    },
    {
      id: SHORTCUT_COMMAND.CAPTURE_REDO,
      title: '截屏：重做标注',
      group: '截屏',
      run: actions.handleRedo
    },
    {
      id: SHORTCUT_COMMAND.CAPTURE_DELETE_SELECTION,
      title: '截屏：删除选中标注',
      group: '截屏',
      run: actions.handleDelete
    },
    {
      id: SHORTCUT_COMMAND.CAPTURE_RETAKE,
      title: '截屏：重新截图',
      group: '截屏',
      run: actions.handleRefresh
    },
    {
      id: SHORTCUT_COMMAND.CAPTURE_OCR,
      title: '截屏：取字',
      group: '截屏',
      run: function () {
        void runOcr()
      }
    }
  ])

  useShortcut(SHORTCUT_COMMAND.OVERLAY_ESCAPE, function () {
    actions.handleEscape()
    return true
  })

  return (
    <CaptureErrorBoundary
      onError={function () {
        onExit?.()
      }}
      onClose={onClose ?? function () {}}>
      <CaptureStageView
        captureStatus={captureStatus}
        captureError={captureError}
        onBootstrapCapture={function (forceFresh) {
          void bootstrapCapture(forceFresh)
        }}
        onExit={onExit}
        onClose={onClose}
        annotationRef={annotationRef}
        handleMove={handleMove}
        handleWheel={handleWheel}
        handlePress={handlePress}
        handleRelease={handleRelease}
        selection={selection}
        selectedID={selectedID}
        selectedIDs={selectedIDs}
        annotations={annotations}
        sourceImage={sourceImage}
        actions={actions}
        onUpdateSelection={onUpdateSelection}
        phase={phase}
        hoverLabel={hoverLabel}
        graphics={graphics}
        canRedo={canRedo}
        canUndo={canUndo}
        color={color}
        filled={filled}
        opacity={opacity}
        fontSize={fontSize}
        thickness={thickness}
        ocrBusy={ocrBusy}
        ocrText={ocrText}
        onRunOcr={function () {
          void runOcr()
        }}
        onUpdateOcrText={onUpdateOcrText}
        onInsertOcrText={insertOcrText}
      />
      <ContextMenu.Host />
    </CaptureErrorBoundary>
  )
}

export type { Phase }
export default Capture
