import { useEffect, useRef, useState } from 'react'

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
import { DETECT_ELEMENT, DETECT_WINDOW, useSettingsStore, type Setting } from '@/stores/setting'
import { probeElements, readCursorPoint } from '@/features/capture/tauri'

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
  /**
   * 标注默认样式从设置层取初值。组件随截屏态挂载/卸载，硬编码默认值就会变成
   * 「每次截屏都要重新调颜色」——所以初值必须是持久层里那份。
   */
  const storedStyle = useSettingsStore(function (state) {
    return state.settings.capture.style
  })
  const [color, onUpdateColor] = useState(storedStyle.color)
  const [thickness, onUpdateThickness] = useState(storedStyle.thickness)
  const [filled, onUpdateFilled] = useState(storedStyle.filled)
  const [opacity, onUpdateOpacity] = useState(storedStyle.opacity)
  const [fontSize, onUpdateFontSize] = useState(storedStyle.fontSize)

  // 设置异步加载完成（或默认样式在别处被改）时跟随一次
  const styleRef = useRef(storedStyle)
  useEffect(
    function () {
      if (styleRef.current === storedStyle) return
      styleRef.current = storedStyle
      onUpdateColor(storedStyle.color)
      onUpdateThickness(storedStyle.thickness)
      onUpdateFilled(storedStyle.filled)
      onUpdateOpacity(storedStyle.opacity)
      onUpdateFontSize(storedStyle.fontSize)
    },
    [storedStyle]
  )

  /**
   * 工具栏直改样式：本地 state 立刻生效，落盘合并到 200ms 后。
   * 只有「用户主动改默认样式」走这里；`syncToolbarFromAnnotation`（选中已有标注）
   * 只改显示，不能把标注的样式写回默认值。
   */
  const styleTimerRef = useRef<number | null>(null)
  const pendingStyleRef = useRef<Partial<Setting.CaptureStyle>>({})
  function flushStyle() {
    if (styleTimerRef.current !== null) window.clearTimeout(styleTimerRef.current)
    styleTimerRef.current = null
    const pending = pendingStyleRef.current
    pendingStyleRef.current = {}
    if (Object.keys(pending).length === 0) return
    const store = useSettingsStore.getState()
    void store.toUpdate('capture', { style: { ...store.settings.capture.style, ...pending } })
  }
  function commitStyle(patch: Partial<Setting.CaptureStyle>) {
    pendingStyleRef.current = { ...pendingStyleRef.current, ...patch }
    if (styleTimerRef.current !== null) window.clearTimeout(styleTimerRef.current)
    styleTimerRef.current = window.setTimeout(flushStyle, 200)
  }
  // 卸载（按 ESC 退出截屏）时把还没落盘的样式补写一次
  useEffect(function () {
    return flushStyle
  }, [])
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

  const {
    regionsRef,
    hoverLabel,
    seedHover,
    handlePress,
    handleMove,
    handleRelease,
    handleWheel,
    resetDragState
  } = useCaptureStage({
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

  /**
   * 首帧就绪后按光标位置种一次悬停：选区/吸附框只由 mousemove 驱动，用户按完热键
   * 不动鼠标就一直是空遮罩（看起来像「点一下才出框选」）。这里主动补第一次。
   */
  const seedHoverRef = useRef(seedHover)
  useEffect(function () {
    seedHoverRef.current = seedHover
  })
  useEffect(
    function () {
      if (captureStatus !== 'ready' || !sourceImage) return
      let cancelled = false
      void readCursorPoint().then(function (point) {
        if (cancelled || !point) return
        seedHoverRef.current(point.x, point.y)
      })
      return function () {
        cancelled = true
      }
    },
    [captureStatus, sourceImage]
  )

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
    onCommitStyle: commitStyle,
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
        sourcePath={sourcePath}
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
