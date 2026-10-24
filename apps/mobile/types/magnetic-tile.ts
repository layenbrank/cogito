type MagneticTileDirection = 'horizontal' | 'vertical'
type MagneticTileShape = 'square' | 'circle' | 'rectangle'
type MagneticTileSize = 1 | 2 | 3 | 4

type MagneticTileComponent =
  | 'bookmark'
  | 'clock'
  | 'calendar'
  | 'markdown'
  | 'intelligence'
  | 'navigation'
  | 'settings'
  | 'example'

interface MagneticTileBackground {
  color?: string
  image?: string
}

interface MagneticTileBackdrop {
  blur?: string
  opacity?: string
  url?: string
}

interface MagneticTile {
  id: string
  index: number
  title: string
  url: string | null
  round: string | null
  mark: string | null
  size: MagneticTileSize
  shape: MagneticTileShape
  direction: MagneticTileDirection
  mirrorID: string
  updatedAt: number
  createdAt: number
  textColor: string | null
  component: MagneticTileComponent
  description: string
  collectionID: string | null
  downloadCount: number
  background: MagneticTileBackground | null
  backdrop: MagneticTileBackdrop | null
  archivedAt: number | null
  /** markdown / intelligence payload */
  content?: string
}

type MagneticTileWrite = Omit<
  MagneticTile,
  'id' | 'createdAt' | 'updatedAt' | 'downloadCount' | 'archivedAt'
>

type MagneticTileChange = Partial<Omit<MagneticTile, 'id'>>

export type {
  MagneticTile,
  MagneticTileBackdrop,
  MagneticTileBackground,
  MagneticTileChange,
  MagneticTileComponent,
  MagneticTileDirection,
  MagneticTileShape,
  MagneticTileSize,
  MagneticTileWrite
}
