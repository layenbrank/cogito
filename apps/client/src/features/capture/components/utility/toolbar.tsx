import { Icon } from '@iconify/react/offline'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { clsx } from 'clsx'
import * as m from 'motion/react-m'

import { type GraphicsEnum } from '@/features/capture/components/graphics'
import { UTILITIES } from './constants'

import styles from './utility.module.scss'

interface UtilityToolbarProps {
  active: GraphicsEnum | null
  canUndo: boolean
  canRedo: boolean
  ocrBusy: boolean
  onUpdateUtility: (shape: GraphicsEnum | null) => void
  onUndo: () => void
  onRedo: () => void
  onRefresh: () => void
  onOcr: () => void
  onCopy: () => void
  onPin: () => void
  onSave: () => void
}

function UtilityToolbar(props: UtilityToolbarProps) {
  const {
    active,
    canUndo,
    canRedo,
    ocrBusy,
    onUpdateUtility,
    onUndo,
    onRedo,
    onRefresh,
    onOcr,
    onCopy,
    onPin,
    onSave
  } = props

  return (
    <div className={styles.row}>
      <div className={styles.ensemble}>
        {UTILITIES.map(function (utility) {
          return (
            <Tooltip key={utility.type}>
              <TooltipTrigger
                render={
                  <m.button
                    type="button"
                    className={clsx(styles.button, {
                      [styles.active]: active === utility.type
                    })}
                    whileTap={{ scale: 0.9 }}
                    onClick={function () {
                      onUpdateUtility(active === utility.type ? null : utility.type)
                    }}
                  />
                }>
                <Icon
                  icon={utility.icon}
                  width={18}
                  height={18}
                />
              </TooltipTrigger>
              <TooltipContent>{utility.label}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>

      <div className={styles.separator} />

      <div className={styles.ensemble}>
        <Tooltip>
          <TooltipTrigger
            render={
              <m.button
                type="button"
                className={styles.button}
                disabled={!canUndo}
                whileTap={{ scale: 0.9 }}
                onClick={onUndo}
              />
            }>
            <Icon
              icon="mdi:undo-variant"
              width={18}
              height={18}
            />
          </TooltipTrigger>
          <TooltipContent>撤销 Ctrl+Z</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <m.button
                type="button"
                className={styles.button}
                disabled={!canRedo}
                whileTap={{ scale: 0.9 }}
                onClick={onRedo}
              />
            }>
            <Icon
              icon="mdi:redo-variant"
              width={18}
              height={18}
            />
          </TooltipTrigger>
          <TooltipContent>重做 Ctrl+Y</TooltipContent>
        </Tooltip>
      </div>

      <div className={styles.separator} />

      <div className={styles.ensemble}>
        <Tooltip>
          <TooltipTrigger
            render={
              <m.button
                type="button"
                className={styles.button}
                whileTap={{ scale: 0.9 }}
                onClick={onRefresh}
              />
            }>
            <Icon
              icon="mdi:refresh"
              width={18}
              height={18}
            />
          </TooltipTrigger>
          <TooltipContent>重选</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <m.button
                type="button"
                className={styles.button}
                disabled={ocrBusy}
                whileTap={{ scale: 0.9 }}
                onClick={onOcr}
              />
            }>
            <Icon
              icon="mdi:text-recognition"
              width={18}
              height={18}
            />
          </TooltipTrigger>
          <TooltipContent>取字 Ctrl+T</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <m.button
                type="button"
                className={styles.button}
                whileTap={{ scale: 0.9 }}
                onClick={onCopy}
              />
            }>
            <Icon
              icon="mdi:content-copy"
              width={18}
              height={18}
            />
          </TooltipTrigger>
          <TooltipContent>复制</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <m.button
                type="button"
                className={styles.button}
                whileTap={{ scale: 0.9 }}
                onClick={onPin}
              />
            }>
            <Icon
              icon="mdi:pin"
              width={18}
              height={18}
            />
          </TooltipTrigger>
          <TooltipContent>贴图</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <m.button
                type="button"
                className={styles.button}
                whileTap={{ scale: 0.9 }}
                onClick={onSave}
              />
            }>
            <Icon
              icon="mdi:content-save-outline"
              width={18}
              height={18}
            />
          </TooltipTrigger>
          <TooltipContent>保存</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

export type { UtilityToolbarProps }
export { UtilityToolbar }
