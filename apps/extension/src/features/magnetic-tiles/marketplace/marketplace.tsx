import clsx from 'clsx'

import { MagneticTile, type SectionProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/marketplace/marketplace.module.scss'

import Marker from '@/features/magnetic-tiles/marketplace/marker.tsx'

export default function Marketplace(props: SectionProps) {
  return (
    <MagneticTile.Section
      {...props}
      className={clsx(styles.marketplace)}>
      <Marker
        size={props.size}
        direction={props.direction}
        shape={props.shape}
      />
    </MagneticTile.Section>
  )
}
