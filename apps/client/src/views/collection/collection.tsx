/**
 * `/collection` 路由兜底：开发或深链时直接渲染面板（主路径为镜像内 scale 展开）。
 */
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useMemo } from 'react'

import { CollectionPanel } from '@/views/collection/panel.tsx'

function findCollectionID(): string {
  const fromQuery = new URLSearchParams(location.search).get('id')
  if (fromQuery) return fromQuery

  try {
    const label = getCurrentWindow().label
    const separator = label.indexOf(':')
    return separator === -1 ? '' : label.slice(separator + 1)
  } catch (error) {
    console.debug('[collection] 取窗口 label 失败，按空处理:', error)
    return ''
  }
}

export default function Collection() {
  const id = useMemo(function () {
    return findCollectionID()
  }, [])

  if (!id) {
    return (
      <p className="p-6 text-sm text-muted-foreground">缺少集合 id（?id= 或窗口 label）</p>
    )
  }

  return (
    <div className="h-full min-h-[480px]">
      <CollectionPanel id={id} />
    </div>
  )
}
