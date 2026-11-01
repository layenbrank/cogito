import { Avatar, AvatarFallback, AvatarImage } from '@cogito/design/components/avatar'
import clsx from 'clsx'
import { useEffect, useState } from 'react'

import {
  findNavigationIconSrc,
  findNavigationLabel
} from '@/features/magnetic-tile/mark.ts'
import {
  MagneticTile,
  type MarkerProps
} from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/navigation/marker.module.scss'

type Props = Pick<MagneticTile, 'mark' | 'title' | 'url'> &
  Omit<MarkerProps, 'children'>

/** 形状圆角：design Avatar 无 shape prop，改为圆角类（矩形取圆角矩形） */
const SHAPE_RADIUS: Record<MarkerProps['shape'], string> = {
  circle: 'rounded-full',
  square: 'rounded-sm',
  rectangle: 'rounded-md'
}

export default function Marker(props: Props) {
  const label = findNavigationLabel(props.mark, props.title)
  const iconSrc = findNavigationIconSrc(props.mark, props.url)
  const [isBroken, updateBroken] = useState(false)
  const radius = SHAPE_RADIUS[props.shape]
  const showsImage = Boolean(iconSrc) && !isBroken

  useEffect(
    function () {
      updateBroken(false)
    },
    [iconSrc]
  )

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
          // design Avatar 自带 after 描边环；磁贴只要色块 / 图标
          'after:hidden overflow-hidden',
          styles.avatar,
          radius
        )}>
        {showsImage ? (
          <AvatarImage
            src={iconSrc!}
            alt=""
            className={clsx('size-full rounded-none object-contain', radius)}
            onError={function () {
              updateBroken(true)
            }}
          />
        ) : null}
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
