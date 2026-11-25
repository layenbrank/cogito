/**
 * 集合相关的写操作。集中一处，右键菜单与集合页共用同一套语义。
 *
 * index 一律交给后端分配（`MAX(index) + 1`，同一事务内），前端不再读全表算号、也不用自己排队。
 */
import { useMirrorStore } from '@/stores/mirror'

/** 新建集合：一块 `component = 'collection'` 的磁贴（外观与书签导入造出来的一致） */
async function createCollection(input: { mirrorID: string; title: string }): Promise<string | null> {
  const title = input.title.trim()
  if (!title) return null
  const ids = await useMirrorStore.getState().toInsertMagneticTile([
    {
      title,
      url: null,
      round: '12px',
      mark: null,
      component: 'collection',
      description: title,
      background: { color: '#FFFFFF' },
      backdrop: null,
      mirrorID: input.mirrorID,
      textColor: '0F172A',
      // 集合只有顶层一层（集合不能嵌套集合）
      collectionID: null,
      size: 1,
      shape: 'square',
      direction: 'vertical'
    }
  ])
  return ids[0] ?? null
}

/** 打开书签库：建 / 整理网址的主入口（跳转逻辑集中一处） */
async function openBookmarkLibrary(): Promise<void> {
  const { admitSession } = await import('@/features/magnetic-tile/session')
  admitSession({
    component: 'bookmark',
    path: '/bookmark'
  })
  const { router } = await import('@/routers')
  await router.navigate('/bookmark')
}

/** 把若干磁贴移进集合 */
function moveToCollection(ids: string[], collectionID: string): Promise<void> {
  if (ids.length === 0) return Promise.resolve()
  return useMirrorStore.getState().toUpdateMagneticTile(
    ids.map(function (id) {
      return { key: id, change: { collectionID } }
    })
  )
}

/** 移出集合（后端 `collectionID: null` 走显式置空） */
function leaveCollection(ids: string[]): Promise<void> {
  if (ids.length === 0) return Promise.resolve()
  return useMirrorStore.getState().toUpdateMagneticTile(
    ids.map(function (id) {
      return { key: id, change: { collectionID: null } }
    })
  )
}

/**
 * 删除磁贴。
 *
 * 「删集合先把成员解绑成顶层」在 Rust 侧 `Service::toRemove` 里与删除同一事务完成，
 * 这里只发一次删除：不必为了找成员把整表读回来，也不会出现「成员已解绑、集合还没删」的中间态。
 */
function deleteTiles(ids: string[]): Promise<void> {
  if (ids.length === 0) return Promise.resolve()
  return useMirrorStore.getState().toRemoveMagneticTile(ids)
}

export {
  createCollection,
  deleteTiles,
  leaveCollection,
  moveToCollection,
  openBookmarkLibrary
}
