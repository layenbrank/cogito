import { Decorations } from '@/components/decorations/index.ts'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'

export default function Clipchamp() {
  return (
    <Decorations summary={findComponentLabel('clipchamp')}>
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        视频
      </div>
    </Decorations>
  )
}
