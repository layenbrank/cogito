import clsx from 'clsx'
import { MagneticTile, type SectionProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/signboard/signboard.module.scss'

import Marker from '@/features/magnetic-tiles/signboard/marker.tsx'

export default function Signboard(props: SectionProps) {
  return (
    <MagneticTile.Section
      {...props}
      className={clsx(styles.signboard)}>
      <Marker
        size={props.size}
        direction={props.direction}
        shape={props.shape}
      />
    </MagneticTile.Section>
  )
}
