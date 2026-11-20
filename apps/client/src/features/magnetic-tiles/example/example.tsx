import clsx from 'clsx'
import { MagneticTile, type SectionProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/example/example.module.scss'

import Marker from '@/features/magnetic-tiles/example/marker.tsx'

export default function Example(props: SectionProps) {
  return (
    <MagneticTile.Section
      {...props}
      className={clsx(styles.example)}>
      <Marker
        size={props.size}
        shape={props.shape}
        direction={props.direction}
      />
    </MagneticTile.Section>
  )
}
