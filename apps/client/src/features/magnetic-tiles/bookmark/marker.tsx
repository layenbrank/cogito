import { clsx } from 'clsx'

import type { MarkerProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import { MagneticTile } from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/bookmark/marker.module.scss'

type Props = Omit<MarkerProps, 'children'>

export default function Marker(props: Props) {
  return (
    <MagneticTile.Marker
      {...props}
      className={clsx([
        styles.marker,
        props.size,
        props.direction,
        props.shape
      ])}>
      导入
    </MagneticTile.Marker>
  )
}

// return (
// 	<div
// 		onClick={() => props.onUpdateVisible(true)}
// 		className={clsx([styles.marker, styles.medium, styles.square, styles.horizontal])}
// 	>
// 		Marker
// 	</div>
// )
