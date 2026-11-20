import clsx from 'clsx'
import { MagneticTile, type SectionProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/clock/clock.module.scss'

import Marker from '@/features/magnetic-tiles/clock/marker.tsx'

export default function Clock(props: SectionProps) {
  return (
    <MagneticTile.Section
      {...props}
      className={clsx(styles.clock)}>
      <Marker
        size={props.size}
        direction={props.direction}
        shape={props.shape}
      />
    </MagneticTile.Section>
  )
}
