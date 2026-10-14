import clsx from 'clsx'
import { type MouseEvent } from 'react'

import { MagneticTile, type SectionProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/collection/collection.module.scss'

import Marker from '@/features/magnetic-tiles/collection/marker.tsx'

export default function Collection(props: SectionProps) {
  function onTrash(e: MouseEvent<HTMLElement>) {
    console.log('Trash clicked for', e)
  }

  return (
    <MagneticTile.Section
      {...props}
      onTrash={onTrash}
      className={clsx(styles.collection)}>
      <Marker
        id={props.id}
        size={props.size}
        shape={props.shape}
        direction={props.direction}
      />
    </MagneticTile.Section>
  )
}
