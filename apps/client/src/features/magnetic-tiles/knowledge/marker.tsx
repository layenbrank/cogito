import {
  MagneticTile,
  type MarkerProps
} from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/knowledge/marker.module.scss'
import clsx from 'clsx'

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
      markdown
    </MagneticTile.Marker>
  )
}
