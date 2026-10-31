import { CardSheetDialog } from '@/views/signboard/card-sheet-dialog.tsx'
import type { CardSheetProps } from '@/views/signboard/card-sheet-types.ts'
import { useCardSheet } from '@/views/signboard/use-card-sheet.ts'

function CardSheet(props: CardSheetProps) {
  const vm = useCardSheet(props)
  if (!props.card) return null
  return <CardSheetDialog {...vm} />
}

export { CardSheet }
