import clsx from 'clsx'
import { MagneticTile, type SectionProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/settings/settings.module.scss'

import Marker from '@/features/magnetic-tiles/settings/marker.tsx'

export default function Settings(props: SectionProps) {
  return (
    <MagneticTile.Section
      {...props}
      className={clsx(styles.settings)}>
      <Marker
        size={props.size}
        direction={props.direction}
        shape={props.shape}
      />
    </MagneticTile.Section>
  )
}
