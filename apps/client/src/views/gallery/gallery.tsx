import { Decorations } from '@/components/decorations/index.ts'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'

export default function Gallery() {
  return (
    <Decorations summary={findComponentLabel('gallery')}>
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        图库
      </div>
    </Decorations>
  )
}
