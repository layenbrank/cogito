import type { MarkerProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import { IconMarker } from '@/features/magnetic-tiles/shared/icon-marker'

type Props = Omit<MarkerProps, 'children'>

export default function Marker(props: Props) {
  return (
    <IconMarker
      {...props}
      icon="lucide:zap"
    />
  )
}
