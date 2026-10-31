import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'

import type { SignboardEntry } from '@/stores/signboard'

interface CardSheetProps {
  card: SignboardEntry | null
  open: boolean
  onUpdateOpen: (open: boolean) => void
}

interface AttachmentPreview {
  assetID: string
  fileName: string
  src: string
  isCover: boolean
}

function parseDayjs(ms: number | null): Dayjs | null {
  if (ms === null) return null
  return dayjs(ms)
}

/** 存盘用本地 09:00，与原先 `YYYY-MM-DD` + T09:00:00 行为一致 */
function parseTimestamp(value: Dayjs | null): number | null {
  if (!value) return null
  return value.hour(9).minute(0).second(0).millisecond(0).valueOf()
}

const PRIORITY_OPTIONS = [
  { value: '0', label: '无' },
  { value: '1', label: '低' },
  { value: '2', label: '中' },
  { value: '3', label: '高' },
  { value: '4', label: '紧急' }
] as const

export { PRIORITY_OPTIONS, parseDayjs, parseTimestamp }
export type { AttachmentPreview, CardSheetProps }
