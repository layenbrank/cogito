import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { CHANNELS } from '@/shared/ipc/channels'

function useCollectionMembers(currentId: string) {
  const [magneticTiles, onUpdateMagneticTiles] = useState<MagneticTile[]>([])
  const [title, onUpdateTitle] = useState('文件夹')
  const [membersToken, bumpMembersToken] = useState(0)

  useEffect(
    function () {
      let cancelled = false

      async function fetchMembers() {
        try {
          const [members, hosts] = await Promise.all([
            invoke<MagneticTile[]>(CHANNELS.MAGNETIC_TILE.READ, {
              params: { collectionID: currentId }
            }),
            invoke<MagneticTile[]>(CHANNELS.MAGNETIC_TILE.READ, {
              params: { id: currentId }
            })
          ])
          if (cancelled) return
          onUpdateMagneticTiles(
            members.toSorted(function (a, b) {
              return a.index - b.index
            })
          )
          const [host] = hosts
          onUpdateTitle(host?.title?.trim() || '文件夹')
        } catch (cause) {
          console.warn('[collection] 加载成员失败:', cause)
          if (cancelled) return
          onUpdateMagneticTiles([])
          toast.error('文件夹内容加载失败')
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
    // 箭头函数属性：解构后传递仍保留词法 this，不会触发 unbound-method
    reloadMembers: () => {
      bumpMembersToken(function (value) {
        return value + 1
      })
    }
  }
}

export { useCollectionMembers }
