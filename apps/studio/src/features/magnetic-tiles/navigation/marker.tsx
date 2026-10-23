import { Avatar, AvatarFallback } from '@cogito/design/components/avatar'
import { clsx } from 'clsx'

import { MagneticTile, type MarkerProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from './marker.module.scss'

type Props = Pick<MagneticTile, 'mark' | 'title'> & Omit<MarkerProps, 'children'>

export default function Marker(props: Props) {
  const label = props.mark || [...props.title].at(0)
  return (
    <MagneticTile.Marker
      size={props.size}
      direction={props.direction}
      shape={props.shape}
      className={clsx([styles.marker, styles[`lv${props.size}`]])}>
      <Avatar
        className={clsx(
          // design Avatar 默认 after 描边；磁贴只要色块/字母，不要环
          'after:hidden',
          styles.avatar,
          props.shape !== 'circle' && styles.square
        )}>
        <AvatarFallback className={styles.fallback}>{label}</AvatarFallback>
      </Avatar>
    </MagneticTile.Marker>
  )
}
