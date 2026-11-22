import { Icon } from '@iconify/react/offline'
import clsx from 'clsx'

import {
  MagneticTile,
  type MarkerProps
} from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/shared/icon-marker.module.scss'

type Props = Omit<MarkerProps, 'children'> & {
  icon: string
}

/** 自研磁贴通用图标 marker（替代英文占位文案） */
function IconMarker(props: Props) {
  const { icon, className, ...markerProps } = props
  return (
    <MagneticTile.Marker
      {...markerProps}
      className={clsx(styles.marker, styles[`lv${markerProps.size}`], className)}>
      <span
        className={styles.icon}
        aria-hidden>
        <Icon icon={icon} />
      </span>
    </MagneticTile.Marker>
  )
}

export { IconMarker }
export type { Props as IconMarkerProps }
