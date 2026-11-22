import clsx from 'clsx'
import { MagneticTile, type SectionProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/calendar/calendar.module.scss'

import Marker from '@/features/magnetic-tiles/calendar/marker.tsx'

export default function Calendar(props: SectionProps) {
  return (
    <MagneticTile.Section
      {...props}
      className={clsx(styles.calendar)}>
      <Marker
        size={props.size}
        direction={props.direction}
        shape={props.shape}
      />
    </MagneticTile.Section>
  )
}
