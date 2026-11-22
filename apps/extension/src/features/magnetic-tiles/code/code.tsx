import clsx from 'clsx'
import { MagneticTile, type SectionProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/code/code.module.scss'

import Marker from '@/features/magnetic-tiles/code/marker.tsx'

export default function Code(props: SectionProps) {
  return (
    <MagneticTile.Section
      {...props}
      className={clsx(styles.code)}>
      <Marker
        size={props.size}
        shape={props.shape}
        direction={props.direction}
      />
    </MagneticTile.Section>
  )
}
