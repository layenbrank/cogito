import { database } from '@/database/database.ts'
import { findSiteMark } from '@/features/magnetic-tile/mark.ts'
import { seedIfEmpty } from '@/features/mirror/seed.ts'
import { parseSiteUrl } from '@/features/mirror/url.ts'

import type { InsertOptions, MagneticTileInput } from './input.ts'

export type InsertResult = 'added' | 'duplicate' | 'missing'

/** 写入一条导航（或内置入口）磁贴。镜像不存在时先补种子。 */
export async function insertNavigation(
  input: MagneticTileInput,
  options: InsertOptions = {}
): Promise<InsertResult> {
  await seedIfEmpty()

  const mirror = await database.mirror.orderBy('index').first()
  if (!mirror) return 'missing'

  const tiles = await database.magneticTile.where('mirrorID').equals(mirror.id).toArray()
  const trimmed = input.url.trim()
  const url = trimmed ? (parseSiteUrl(trimmed) ?? trimmed) : ''

  if (options.skipSameUrl && url) {
    const duplicated = tiles.some(function (tile) {
      return tile.url === url && !tile.archivedAt
    })
    if (duplicated) return 'duplicate'
  }

  const now = Date.now()
  const index = tiles.reduce(function (max, tile) {
    return Math.max(max, tile.index)
  }, -1)

  await database.magneticTile.add({
    id: crypto.randomUUID(),
    index: index + 1,
    title: input.title.trim(),
    url: url || null,
    round: '16px',
    mark: input.mark ?? (url ? findSiteMark(url) : null),
    size: input.size,
    shape: input.shape,
    direction: input.direction,
    mirrorID: mirror.id,
    updatedAt: now,
    createdAt: now,
    textColor: '#ffffff',
    component: input.component ?? 'navigation',
    description: '',
    collectionID: null,
    downloadCount: 0,
    background: null,
    backdrop: null,
    archivedAt: null
  })

  return 'added'
}
