import { readFile, stat } from '@tauri-apps/plugin-fs'
import exifr from 'exifr'

import type { MediaKind } from '@/views/gallery/constraints'

type DateSource = 'exif' | 'filename' | 'mtime' | 'import' | 'capture'

interface ProbedDate {
  at: number
  source: DateSource
}

const EXIF_PICK = ['DateTimeOriginal', 'CreateDate', 'ModifyDate', 'DateCreated'] as const

/** 文件名里常见的拍摄/截图时间戳 */
const FILENAME_PATTERNS = [
  // PixPin_2026-08-10_00-18-50 / Screenshot_2026-08-10-00-18-50
  /(?:^|[_-])(\d{4})-(\d{2})-(\d{2})[_-](\d{2})[-_]?(\d{2})[-_]?(\d{2})(?:[_-]|$|\.)/,
  // 微信图片_20261008221706 / IMG_20260810001850
  /(?:^|[_-])(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:[_-]|$|\.)/,
  // 2026-08-10（仅日期）
  /(?:^|[_-])(\d{4})-(\d{2})-(\d{2})(?:[_-]|$|\.)/
]

function findFileName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').pop() || path
}

function toValidMs(value: unknown): number | undefined {
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) && ms > 0 ? ms : undefined
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1000 : value
  }
  if (typeof value === 'string') {
    const normalized = value.includes('T') ? value : value.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
    const ms = Date.parse(normalized)
    return Number.isFinite(ms) && ms > 0 ? ms : undefined
  }
  return undefined
}

function findDateFromFileName(path: string): number | undefined {
  const name = findFileName(path)
  for (const pattern of FILENAME_PATTERNS) {
    const match = name.match(pattern)
    if (!match) continue
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const hour = match[4] !== undefined ? Number(match[4]) : 12
    const minute = match[5] !== undefined ? Number(match[5]) : 0
    const second = match[6] !== undefined ? Number(match[6]) : 0
    if (
      year < 1990 ||
      year > 2100 ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31
    ) {
      continue
    }
    const ms = new Date(year, month - 1, day, hour, minute, second).getTime()
    if (Number.isFinite(ms) && ms > 0) return ms
  }
  return undefined
}

async function findDateFromExif(path: string): Promise<number | undefined> {
  try {
    const bytes = await readFile(path)
    const tags = await exifr.parse(bytes, {
      pick: [...EXIF_PICK],
      reviveValues: true
    })
    if (!tags || typeof tags !== 'object') return undefined
    for (const key of EXIF_PICK) {
      const ms = toValidMs((tags as Record<string, unknown>)[key])
      if (ms !== undefined) return ms
    }
  } catch (error) {
    console.warn('[gallery] EXIF probe failed', path, error)
  }
  return undefined
}

async function findDateFromStat(path: string): Promise<number | undefined> {
  try {
    const info = await stat(path)
    const birth = info.birthtime?.getTime()
    const mtime = info.mtime?.getTime()
    if (typeof birth === 'number' && Number.isFinite(birth) && birth > 0) return birth
    if (typeof mtime === 'number' && Number.isFinite(mtime) && mtime > 0) return mtime
  } catch (error) {
    console.warn('[gallery] stat probe failed', path, error)
  }
  return undefined
}

/** 拍摄/截图时间：EXIF → 文件名 → 文件系统时间 → 当前时间 */
async function probeCapturedAt(path: string, kind: MediaKind): Promise<ProbedDate> {
  if (kind === 'image') {
    const exif = await findDateFromExif(path)
    if (exif !== undefined) return { at: exif, source: 'exif' }
  }

  const fromName = findDateFromFileName(path)
  if (fromName !== undefined) return { at: fromName, source: 'filename' }

  const fromStat = await findDateFromStat(path)
  if (fromStat !== undefined) return { at: fromStat, source: 'mtime' }

  return { at: Date.now(), source: 'import' }
}

export { probeCapturedAt }
export type { DateSource, ProbedDate }
