import { Icon } from '@iconify/react/offline'
import clsx from 'clsx'

import { MagneticTile, type MarkerProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/directive/marker.module.scss'

type Props = Omit<MarkerProps, 'children'>

export default function Marker(props: Props) {
  return (
    <MagneticTile.Marker
      size={props.size}
      direction={props.direction}
      shape={props.shape}
      className={clsx(styles.marker, styles[`lv${props.size}`])}>
      <span
        className={styles.icon}
        aria-hidden>
        <Icon icon="lucide:zap" />
      </span>
    </MagneticTile.Marker>
  )
}
