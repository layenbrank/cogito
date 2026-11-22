import { useEffect, useState } from 'react'

import { database } from '@/database/database.ts'
import { notify } from '@/features/shell/notice-state.ts'

function useCollectionMembers(currentId: string) {
  const [magneticTiles, onUpdateMagneticTiles] = useState<MagneticTile[]>([])
  const [title, onUpdateTitle] = useState('文件夹')
  const [membersToken, bumpMembersToken] = useState(0)

  useEffect(
    function () {
      let cancelled = false

      async function fetchMembers() {
        try {
          const [members, host] = await Promise.all([
            database.magneticTile.where('collectionID').equals(currentId).sortBy('index'),
            database.magneticTile.get(currentId)
          ])
          if (cancelled) return
          onUpdateMagneticTiles(
            members.filter(function (tile) {
              return !tile.archivedAt
            })
          )
          onUpdateTitle(host?.title?.trim() || '文件夹')
        } catch (cause) {
          console.warn('[collection] 加载成员失败:', cause)
          if (cancelled) return
          onUpdateMagneticTiles([])
          notify('文件夹内容加载失败')
        }
      }

      void fetchMembers()
      return function () {
        cancelled = true
      }
    },
    [currentId, membersToken]
  )

  return {
    title,
    magneticTiles,
    onUpdateMagneticTiles,
    reloadMembers() {
      bumpMembersToken(function (value) {
        return value + 1
      })
    }
  }
}

export { useCollectionMembers }
