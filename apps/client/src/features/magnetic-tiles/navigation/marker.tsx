import { Avatar, AvatarFallback } from '@i-thinking/design/components/avatar'
import clsx from 'clsx'

import {
  MagneticTile,
  type MarkerProps
} from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/navigation/marker.module.scss'

type Props = Pick<MagneticTile, 'mark' | 'title'> &
  Omit<MarkerProps, 'children'>

/** 形状圆角：design Avatar 无 shape prop，改为圆角类（矩形取圆角矩形） */
const SHAPE_RADIUS: Record<MarkerProps['shape'], string> = {
  circle: 'rounded-full',
  square: 'rounded-sm',
  rectangle: 'rounded-md'
}

export default function Marker(props: Props) {
  const label = props.mark || [...props.title].at(0)
  const radius = SHAPE_RADIUS[props.shape]
  return (
    <MagneticTile.Marker
      size={props.size}
      direction={props.direction}
      shape={props.shape}
      className={clsx([
        styles.marker,
        props.size,
        props.direction,
        props.shape
      ])}>
      <Avatar
        className={clsx(
          // design Avatar 自带 after 描边环；磁贴只要色块 / 首字
          'after:hidden',
          styles.avatar,
          radius
        )}>
        <AvatarFallback
          className={clsx(
            'size-full bg-transparent text-[1em] text-inherit',
            radius
          )}>
          {label}
        </AvatarFallback>
      </Avatar>
    </MagneticTile.Marker>
  )
}
