/**
 * `/collection?id=`：集合页（双击磁贴经 activateTile 跳转）。
 * `?add=1` 打开「新增网址」Sheet。
 */
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useShellSurface } from '@/features/window-shell/slots'
import { CollectionSurface } from '@/views/collection/surface.tsx'
import { useCollectionMembers } from '@/views/collection/use-collection-members.ts'

function findCollectionIDFromLabel(): string {
  try {
    const label = getCurrentWindow().label
    const separator = label.indexOf(':')
    return separator === -1 ? '' : label.slice(separator + 1)
  } catch (error) {
    console.debug('[collection] 取窗口 label 失败，按空处理:', error)
    return ''
  }
}

function wantsAddOpen(params: URLSearchParams) {
  return params.get('add') === '1'
}

export default function Collection() {
  const [searchParams, updateSearchParams] = useSearchParams()

  const id = useMemo(
    function () {
      return searchParams.get('id')?.trim() || findCollectionIDFromLabel()
    },
    [searchParams]
  )

  const [stack, onUpdateStack] = useState<string[]>([id])
  useEffect(
    function () {
      onUpdateStack([id])
    },
    [id]
  )

  const currentId = stack[stack.length - 1] || id
  const { title, magneticTiles, onUpdateMagneticTiles, reloadMembers } =
    useCollectionMembers(currentId)

  const isAddOpen = wantsAddOpen(searchParams)

  useShellSurface({
    summary: id ? title : '集合',
    scrollable: false
  })

  function onUpdateAddOpen(open: boolean) {
    const next = new URLSearchParams(searchParams)
    if (open) next.set('add', '1')
    else next.delete('add')
    updateSearchParams(next, { replace: true })
  }

  if (!id) {
    return <p className="text-muted-foreground p-6 text-sm">缺少集合 id（?id=）</p>
  }

  return (
    <CollectionSurface
      key={id}
      id={id}
      stack={stack}
      onUpdateStack={onUpdateStack}
      title={title}
      magneticTiles={magneticTiles}
      onUpdateMagneticTiles={onUpdateMagneticTiles}
      onReloadMembers={reloadMembers}
      isAddOpen={isAddOpen}
      onUpdateAddOpen={onUpdateAddOpen}
    />
  )
}
