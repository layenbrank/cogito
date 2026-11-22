import clsx from 'clsx'
import { MagneticTile, type SectionProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/clipchamp/clipchamp.module.scss'

import Marker from '@/features/magnetic-tiles/clipchamp/marker.tsx'

export default function Clipchamp(props: SectionProps) {
  return (
    <MagneticTile.Section
      {...props}
      className={clsx(styles.clipchamp)}>
      <Marker
        size={props.size}
        direction={props.direction}
        shape={props.shape}
      />
    </MagneticTile.Section>
  )
}
