/** 磁贴入口；`screenshot` 键由 `useKeyCode` 接管（派发点在 `views/overview` 的全局快捷键） */
import { invoke } from '@tauri-apps/api/core'
import clsx from 'clsx'
import type { MouseEvent } from 'react'

import { MagneticTile, type SectionProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import { CHANNELS } from '@/shared/ipc/channels'
import styles from '@/features/magnetic-tiles/capture/capture.module.scss'
import { useKeyCode } from '@/keycodes/react'

import Marker from '@/features/magnetic-tiles/capture/marker.tsx'

export default function Capture(props: SectionProps) {
  function onTrash(e: MouseEvent<HTMLElement>) {
    console.log('Trash clicked for', e)
  }

  async function onCapture() {
    try {
      await invoke(CHANNELS.CAPTURE.OPEN)
    } catch (error) {
      console.error('Error opening capture overlay:', error)
    }
  }

  useKeyCode('screenshot', async function () {
    await onCapture()
    return true
  })

  return (
    <MagneticTile.Section
      {...props}
      onTrash={onTrash}
      className={clsx(styles.capture, props.className)}>
      <Marker
        size={props.size}
        shape={props.shape}
        direction={props.direction}
      />
    </MagneticTile.Section>
  )
}
