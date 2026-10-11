/**
 * 指令磁贴：双击经 activateTile 打开独立窗口（`/directive`）。
 */
import clsx from 'clsx'
import type { MouseEvent } from 'react'

import { MagneticTile, type SectionProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/directive/directive.module.scss'
import Marker from '@/features/magnetic-tiles/directive/marker.tsx'

export default function Directive(props: SectionProps) {
  function onTrash(e: MouseEvent<HTMLElement>) {
    console.log('Trash clicked for', e)
  }

  return (
    <MagneticTile.Section
      {...props}
      onTrash={onTrash}
      className={clsx(styles.directive, props.className)}>
      <Marker
        size={props.size}
        direction={props.direction}
        shape={props.shape}
      />
    </MagneticTile.Section>
  )
}
