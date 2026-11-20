import { database } from '@/database/database.ts'
import { findSiteMark } from '@/features/magnetic-tile/mark.ts'

/**
 * 首次运行（库里还没有镜像 / 磁贴）时的种子数据：时钟、书签入口、外观入口、一个导航磁贴。
 */

export const SEED_MIRROR: Mirror = {
  id: 'primary',
  title: '主镜像',
  index: 0,
  mark: '',
  updatedAt: 0,
  createdAt: 0,
  description: '默认镜像',
  background: null,
  backdrop: null,
  overlay: '',
  archivedAt: null
}

function buildSeedTile(
  mirrorID: string,
  index: number,
  fields: Pick<MagneticTile, 'title' | 'url' | 'component' | 'size'>
): MagneticTile {
  const now = Date.now()

  return {
    id: crypto.randomUUID(),
    index,
    title: fields.title,
    url: fields.url,
    round: '16px',
    mark: fields.url ? findSiteMark(fields.url) : null,
    size: fields.size,
    shape: 'square',
    direction: 'horizontal',
    mirrorID,
    updatedAt: now,
    createdAt: now,
    textColor: '#ffffff',
    component: fields.component,
    description: '',
    collectionID: null,
    downloadCount: 0,
    background: null,
    backdrop: null,
    archivedAt: null
  }
}

function buildSeedTiles(mirrorID: string): MagneticTile[] {
  return [
    buildSeedTile(mirrorID, 0, { title: '时钟', url: null, component: 'clock', size: 2 }),
    buildSeedTile(mirrorID, 1, { title: '书签', url: null, component: 'bookmark', size: 1 }),
    buildSeedTile(mirrorID, 2, { title: '外观', url: null, component: 'settings', size: 1 }),
    buildSeedTile(mirrorID, 3, {
      title: 'GitHub',
      url: 'https://github.com',
      component: 'navigation',
      size: 2
    })
  ]
}

const BUILTIN_KEY = 'cogito.builtins'

const BUILTINS: readonly Pick<MagneticTile, 'title' | 'component' | 'size'>[] = [
  { title: '时钟', component: 'clock', size: 2 },
  { title: '书签', component: 'bookmark', size: 1 },
  { title: '外观', component: 'settings', size: 1 }
]

async function builtinsReady(): Promise<boolean> {
  const storage = globalThis.chrome?.storage?.local
  if (storage) {
    const bag = await storage.get(BUILTIN_KEY)
    return bag[BUILTIN_KEY] === '1'
  }
  if (typeof localStorage !== 'undefined') return localStorage.getItem(BUILTIN_KEY) === '1'
  return false
}

async function markBuiltinsReady(): Promise<void> {
  const storage = globalThis.chrome?.storage?.local
  if (storage) await storage.set({ [BUILTIN_KEY]: '1' })
  if (typeof localStorage !== 'undefined') localStorage.setItem(BUILTIN_KEY, '1')
}

/** 旧库只有导航磁贴时补一次时钟 / 书签 / 外观；之后用户删掉不会再加回来 */
async function ensureBuiltins(mirrorID: string): Promise<void> {
  if (await builtinsReady()) return

  const tiles = await database.magneticTile.where('mirrorID').equals(mirrorID).toArray()
  const present = new Set(tiles.map(function (tile) {
    return tile.component
  }))
  let index = tiles.reduce(function (max, tile) {
    return Math.max(max, tile.index)
  }, -1)

  const adding: MagneticTile[] = []
  for (const item of BUILTINS) {
    if (present.has(item.component)) continue
    index += 1
    adding.push(buildSeedTile(mirrorID, index, { ...item, url: null }))
  }

  if (adding.length > 0) await database.magneticTile.bulkAdd(adding)
  await markBuiltinsReady()
}

/** 库空时写入种子；已有镜像时只补一次内置磁贴 */
export async function seedIfEmpty(): Promise<void> {
  const mirrors = await database.mirror.orderBy('index').toArray()
  const [mirror] = mirrors

  if (!mirror) {
    await database.mirror.add(SEED_MIRROR)
    await database.magneticTile.bulkAdd(buildSeedTiles(SEED_MIRROR.id))
    await markBuiltinsReady()
    return
  }

  const count = await database.magneticTile.where('mirrorID').equals(mirror.id).count()
  if (count === 0) await database.magneticTile.bulkAdd(buildSeedTiles(mirror.id))
  await ensureBuiltins(mirror.id)
}
