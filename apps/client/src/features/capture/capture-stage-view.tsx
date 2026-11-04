import { clsx } from 'clsx'
import type { RefObject } from 'react'

import { copyText } from '@/features/capture/clipboard'
import { CaptureErrorSurface, CaptureLoadingMask } from '@/features/capture/capture-status'
import { Annotation, type AnnotationHandle } from '@/features/capture/components/annotation'
import type { GraphicsEnum, GraphicsProps } from '@/features/capture/components/graphics'
import Magnifier from '@/features/capture/components/magnifier'
import { OcrSurface } from '@/features/capture/components/ocr-surface'
import Utility from '@/features/capture/components/utility'
import type { useCaptureActions } from '@/features/capture/use-capture-actions'
import type { Phase } from '@/features/capture/use-capture-stage'

import styles from '@/features/capture/capture.module.scss'

type CaptureActions = ReturnType<typeof useCaptureActions>

interface CaptureStageViewProps {
  captureStatus: 'loading' | 'ready' | 'error'
  captureError: string | null
  onBootstrapCapture: (forceFresh?: boolean) => void
  onExit?: () => void
  onClose?: () => void
  annotationRef: RefObject<AnnotationHandle | null>
  handleMove: NonNullable<React.ComponentProps<typeof Annotation>['onMove']>
  handleWheel: (deltaY: number, shiftKey: boolean) => boolean
  handlePress: NonNullable<React.ComponentProps<typeof Annotation>['onPress']>
  handleRelease: NonNullable<React.ComponentProps<typeof Annotation>['onRelease']>
  selection: { x: number; y: number; w: number; h: number } | null
  selectedID: string | null
  selectedIDs: string[]
  annotations: GraphicsProps[]
  sourceImage: HTMLImageElement | null
  /** 冻结帧磁盘路径：加载期用它铺底（`CaptureLoadingMask`） */
  sourcePath: string | null
  actions: CaptureActions
  onUpdateSelection: (selection: { x: number; y: number; w: number; h: number } | null) => void
  phase: Phase
  hoverLabel: string | undefined
  graphics: GraphicsEnum | null
  canRedo: boolean
  canUndo: boolean
  color: string
  filled: boolean
  opacity: number
  fontSize: number
  thickness: number
  ocrBusy: boolean
  ocrText: string | null
  onRunOcr: () => void
  onUpdateOcrText: (value: string | null) => void
  onInsertOcrText: () => void
}

function CaptureStageView(props: CaptureStageViewProps) {
  const onClose = props.onClose ?? function () {}

  return (
    <div className={clsx(styles.capture)}>
      {props.captureStatus === 'error' ? (
        <CaptureErrorSurface
          message={props.captureError}
          onRetry={function () {
            props.onBootstrapCapture(true)
          }}
          onExit={props.onExit}
        />
      ) : (
        <>
          {props.captureStatus === 'loading' ? (
            <CaptureLoadingMask sourcePath={props.sourcePath} />
          ) : null}
          <div>
            <Annotation
              ref={props.annotationRef}
              onClose={onClose}
              onMove={props.handleMove}
              onWheel={function (event) {
                if (props.handleWheel(event.evt.deltaY, event.evt.shiftKey)) event.evt.preventDefault()
              }}
              clipRect={props.selection}
              onPress={props.handlePress}
              selectedID={props.selectedID}
              selectedIDs={props.selectedIDs}
              annotations={props.annotations}
              sourceImage={props.sourceImage}
              onRelease={props.handleRelease}
              onSelect={props.actions.handleSelect}
              onSelectMany={props.actions.handleSelectMany}
              interactive={props.captureStatus === 'ready'}
              onChange={props.actions.handleAnnotationChange}
              onBatchChange={props.actions.handleAnnotationsBatchChange}
              onContextMenuAnnotation={props.actions.handleContextMenuAnnotation}
              onEditStart={function () {
                props.actions.handleSelect(null)
              }}
              selection={props.selection}
              phase={props.phase}
              hoverLabel={props.hoverLabel}
              onSelectionChange={props.onUpdateSelection}
              graphicsActive={props.graphics !== null}
            />
          </div>

          <Magnifier
            sourceImage={props.sourceImage}
            visible={props.phase === 'selecting' && props.captureStatus === 'ready'}
            onClose={onClose}
          />

          {props.captureStatus === 'ready' && (
            <Utility
              color={props.color}
              filled={props.filled}
              canRedo={props.canRedo}
              canUndo={props.canUndo}
              active={props.graphics}
              opacity={props.opacity}
              ocrBusy={props.ocrBusy}
              onOcr={props.onRunOcr}
              onCopy={props.actions.handleCopy}
              onPin={props.actions.handlePin}
              fontSize={props.fontSize}
              onRedo={props.actions.handleRedo}
              onUndo={props.actions.handleUndo}
              thickness={props.thickness}
              onClose={props.actions.handleClose}
              onRefresh={props.actions.handleRefresh}
              onSave={props.actions.handleSave}
              onUpdateColor={props.actions.handleUpdateColor}
              onUpdateUtility={props.actions.handleUpdateGraphics}
              onUpdateFilled={props.actions.handleUpdateFilled}
              onUpdateOpacity={props.actions.handleUpdateOpacity}
              onUpdateFontSize={props.actions.handleUpdateFontSize}
              onUpdateThickness={props.actions.handleUpdateThickness}
              selection={props.phase === 'selecting' ? null : props.selection}
            />
          )}

          {props.ocrText !== null ? (
            <OcrSurface
              text={props.ocrText}
              busy={props.ocrBusy}
              canInsert={Boolean(props.selection)}
              onCopy={function () {
                void copyText(props.ocrText!)
              }}
              onInsert={props.onInsertOcrText}
              onClose={function () {
                props.onUpdateOcrText(null)
              }}
            />
          ) : null}
        </>
      )}
    </div>
  )
}

export { CaptureStageView }
