import { Decorations } from '@/components/decorations/index.ts'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'

export default function Bookmark() {
  return (
    <Decorations summary={findComponentLabel('bookmark')}>
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        书签
      </div>
    </Decorations>
  )
}
