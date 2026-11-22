import { MagneticTile, type SectionProps } from '@/features/magnetic-tile/magnetic-tile.tsx'

import Marker from '@/features/magnetic-tiles/morph/marker.tsx'

export default function Morph(props: SectionProps) {
  return (
    <MagneticTile.Section
      {...props}>
      <Marker
        size={props.size}
        shape={props.shape}
        direction={props.direction}
      />
    </MagneticTile.Section>
  )
}
