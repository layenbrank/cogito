/** 磁贴入口。截屏键走统一命令表（`capture.screenshot`），磁贴不再单独接管 */
import clsx from 'clsx'
import type { MouseEvent } from 'react'

import { MagneticTile, type SectionProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/capture/capture.module.scss'

import Marker from '@/features/magnetic-tiles/capture/marker.tsx'

export default function Capture(props: SectionProps) {
  function onTrash(e: MouseEvent<HTMLElement>) {
    console.log('Trash clicked for', e)
  }

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
