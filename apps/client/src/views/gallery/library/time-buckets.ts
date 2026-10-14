import type { TimeScope } from '@/views/gallery/constraints'
import {
  findScopeBuckets,
  groupByDay,
  groupByMonth,
  groupByYear,
  type DayBucket,
  type GalleryMedia,
  type MonthBucket,
  type YearBucket
} from '@/views/gallery/model/media'

interface ScrubberMark {
  key: string
  label: string
  ratio: number
}

function findSectionMedias(medias: GalleryMedia[], scope: TimeScope) {
  return findScopeBuckets(medias, scope)
}

function findScrubberMarks(medias: GalleryMedia[]): ScrubberMark[] {
  if (medias.length === 0) return []
  const months = groupByMonth(medias)
  if (months.length === 0) return []
  return months.map(function (month, index) {
    return {
      key: month.key,
      label: month.label,
      ratio: index / Math.max(months.length - 1, 1)
    }
  })
}

export { findScopeBuckets, findScrubberMarks, findSectionMedias, groupByDay, groupByMonth, groupByYear }

export type { DayBucket, MonthBucket, ScrubberMark, YearBucket }
