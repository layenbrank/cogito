import clsx, { type ClassValue } from 'clsx'
import type { CSSProperties } from 'react'

import { MagneticTile, type SectionProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/navigation/navigation.module.scss'

import Marker from '@/features/magnetic-tiles/navigation/marker.tsx'

interface NavigationProps extends Omit<SectionProps, 'children'> {
  style?: CSSProperties
  className?: ClassValue
  onPrevent?: React.MouseEventHandler<HTMLDivElement>
}

export default function Navigation(props: NavigationProps) {
  const { onPrevent, onTrash, className, ...tile } = props

  return (
    <MagneticTile.Section
      {...tile}
      onTrash={onTrash}
      onDoubleClick={onPrevent}
      className={clsx(styles.navigation, className)}>
      <Marker
        size={props.size}
        direction={props.direction}
        shape={props.shape}
        mark={props.mark}
        title={props.title}
      />
    </MagneticTile.Section>
  )
}
