import { MagneticTile, type SectionProps } from '@/features/magnetic-tile/magnetic-tile.tsx'

import Marker from './marker'

function Wallpaper(props: SectionProps) {
  return (
    <MagneticTile.Section
      {...props}>
      <Marker
        size={props.size}
        shape={props.shape}
        direction={props.direction}
        title={props.title}
        url={props.url}
      />
    </MagneticTile.Section>
  )
}

export default Wallpaper
export { Wallpaper }
