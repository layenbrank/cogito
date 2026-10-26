import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'

import { type GraphicsEnum } from '@/features/capture/components/graphics'

import { UtilityPropsPanel } from './props-panel'
import { UtilityToolbar } from './toolbar'
import { useUtilityColor } from './use-color'
import { useUtilityPosition } from './use-position'

import styles from './utility.module.scss'

interface UtilityProps {
  selection: { x: number; y: number; w: number; h: number } | null
  active: GraphicsEnum | null
  color: string
  thickness: number
  filled: boolean
  opacity: number
  fontSize: number
  canUndo: boolean
  canRedo: boolean
  ocrBusy: boolean
  onUpdateUtility: (shape: GraphicsEnum | null) => void
  onUpdateColor: (color: string) => void
  onUpdateThickness: (thickness: number) => void
  onUpdateFilled: (filled: boolean) => void
  onUpdateOpacity: (opacity: number) => void
  onUpdateFontSize: (fontSize: number) => void
  onUndo: () => void
  onRedo: () => void
  onOcr: () => void
  onCopy: () => void
  onPin: () => void
  onSave: () => void
  onClose: () => void
  onRefresh: () => void
}

function Utility(props: UtilityProps) {
  const {
    active,
    canRedo,
    canUndo,
    color,
    filled,
    fontSize,
    ocrBusy,
    opacity,
    selection,
    thickness,
    onUpdateColor,
    onUpdateFilled,
    onUpdateFontSize,
    onUpdateOpacity,
    onRedo,
    onRefresh,
    onOcr,
    onCopy,
    onPin,
    onSave,
    onUpdateThickness,
    onUndo,
    onUpdateUtility
  } = props

  const { containerRef, position } = useUtilityPosition(selection, active)
  const {
    pickerOpen,
    setPickerOpen,
    setPinnedMainColor,
    presetHues,
    mainColor,
    derivedShades,
    isCustomColor
  } = useUtilityColor(color)

  return (
    <AnimatePresence>
      {selection && (
        <m.div
          ref={containerRef}
          className={styles.utility}
          style={{
            top: position.top,
            left: position.left,
            pointerEvents: 'all'
          }}
          initial={{
            y: 6,
            opacity: 0,
            scale: 0.97
          }}
          animate={{
            y: 0,
            scale: 1,
            opacity: 1
          }}
          exit={{
            y: 4,
            opacity: 0,
            scale: 0.98
          }}
          transition={{
            duration: 0.2,
            ease: [0.22, 1, 0.36, 1]
          }}
          onMouseDown={function (e) {
            e.stopPropagation()
          }}>
          <UtilityToolbar
            active={active}
            canUndo={canUndo}
            canRedo={canRedo}
            ocrBusy={ocrBusy}
            onUpdateUtility={onUpdateUtility}
            onUndo={onUndo}
            onRedo={onRedo}
            onRefresh={onRefresh}
            onOcr={onOcr}
            onCopy={onCopy}
            onPin={onPin}
            onSave={onSave}
          />
          <UtilityPropsPanel
            active={active}
            color={color}
            thickness={thickness}
            filled={filled}
            opacity={opacity}
            fontSize={fontSize}
            pickerOpen={pickerOpen}
            setPickerOpen={setPickerOpen}
            presetHues={presetHues}
            mainColor={mainColor}
            derivedShades={derivedShades}
            isCustomColor={isCustomColor}
            setPinnedMainColor={setPinnedMainColor}
            onUpdateColor={onUpdateColor}
            onUpdateThickness={onUpdateThickness}
            onUpdateFilled={onUpdateFilled}
            onUpdateOpacity={onUpdateOpacity}
            onUpdateFontSize={onUpdateFontSize}
          />
        </m.div>
      )}
    </AnimatePresence>
  )
}

export default Utility
export type { UtilityProps }
