import { Decorations } from '@/components/decorations/index.ts'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'

export default function Signboard() {
  return (
    <Decorations summary={findComponentLabel('signboard')}>
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        看板
      </div>
    </Decorations>
  )
}
