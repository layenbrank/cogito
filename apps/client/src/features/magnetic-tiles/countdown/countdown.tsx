import clsx from 'clsx'
import { MagneticTile, type SectionProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/countdown/countdown.module.scss'

import Marker from '@/features/magnetic-tiles/countdown/marker'

export default function Countdown(props: SectionProps) {
  return (
    <MagneticTile.Section
      {...props}
      className={clsx(styles.countdown)}>
      <Marker
        size={props.size}
        shape={props.shape}
        direction={props.direction}
      />
    </MagneticTile.Section>
  )
}
