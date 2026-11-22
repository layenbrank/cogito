/**
 * 指令磁贴：双击经 activateTile 在主窗口打开（`/directive`）。
 */
import clsx from 'clsx'
import { MagneticTile, type SectionProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/directive/directive.module.scss'
import Marker from '@/features/magnetic-tiles/directive/marker.tsx'

export default function Directive(props: SectionProps) {
  return (
    <MagneticTile.Section
      {...props}
      className={clsx(styles.directive, props.className)}>
      <Marker
        size={props.size}
        direction={props.direction}
        shape={props.shape}
      />
    </MagneticTile.Section>
  )
}
