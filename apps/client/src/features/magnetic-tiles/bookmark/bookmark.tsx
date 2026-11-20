import { MagneticTile, type SectionProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import styles from '@/features/magnetic-tiles/bookmark/bookmark.module.scss'
import clsx from 'clsx'
import Marker from '@/features/magnetic-tiles/bookmark/marker.tsx'

export default function Bookmark(props: SectionProps) {
  return (
    <MagneticTile.Section
      {...props}
      className={clsx(styles.bookmark)}>
      <Marker
        size={props.size}
        direction={props.direction}
        shape={props.shape}
      />
    </MagneticTile.Section>
  )
}
