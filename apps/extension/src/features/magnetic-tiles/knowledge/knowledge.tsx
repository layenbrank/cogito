import clsx from 'clsx'
import { MagneticTile, type SectionProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/knowledge/markdown.module.scss'

import Marker from '@/features/magnetic-tiles/knowledge/marker.tsx'

export default function Markdown(props: SectionProps) {
  return (
    <MagneticTile.Section
      {...props}
      className={clsx(styles.markdown)}>
      <Marker
        size={props.size}
        direction={props.direction}
        shape={props.shape}
      />
    </MagneticTile.Section>
  )
}
