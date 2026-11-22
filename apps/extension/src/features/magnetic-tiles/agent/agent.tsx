import clsx from 'clsx'

import { MagneticTile, type SectionProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/agent/agent.module.scss'

import Marker from '@/features/magnetic-tiles/agent/marker.tsx'

export default function Agent(props: SectionProps) {
  return (
    <MagneticTile.Section
      {...props}
      className={clsx(styles.agent)}>
      <Marker
        size={props.size}
        direction={props.direction}
        shape={props.shape}
      />
    </MagneticTile.Section>
  )
}
