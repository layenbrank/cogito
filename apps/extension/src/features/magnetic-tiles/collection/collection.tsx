import clsx from 'clsx'
import { MagneticTile, type SectionProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/collection/collection.module.scss'

import Marker from '@/features/magnetic-tiles/collection/marker.tsx'

type CollectionProps = Omit<SectionProps, 'children'>

export default function Collection(props: CollectionProps) {
  return (
    <MagneticTile.Section
      {...props}
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
