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
  const [searchParams] = useSearchParams()

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

  /**
   * 抽屉开关走组件状态，**不走 `?add=1`**。
   *
   * 以前每次开抽屉都 `setSearchParams` 发一次导航：路由换一轮 → 页面重渲／入场动画重放，
   * 集合里的图标会整体跳一下，看起来像「切了一页」，但用户只是点开了抽屉。
   * 深链（外部带 `?add=1` 打开）仍然生效：只作为初始值读一次。
   */
  const [isAddOpen, updateAddOpen] = useState(function () {
    return wantsAddOpen(searchParams)
  })

  useShellSurface({
    summary: id ? title : '集合',
    scrollable: false
  })

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
      onUpdateAddOpen={updateAddOpen}
    />
  )
}
