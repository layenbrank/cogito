/**
 * `/collection?id=`：集合页（双击磁贴经 activateTile 跳转）。
 * `?add=1` 打开「新增网址」Sheet。
 */
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Decorations } from '@/components/decorations/index.ts'
import { CollectionPanel } from '@/views/collection/panel.tsx'

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
  const [title, onUpdateTitle] = useState('集合')

  const id = useMemo(
    function () {
      return searchParams.get('id')?.trim() || findCollectionIDFromLabel()
    },
    [searchParams]
  )

  const isAddOpen = wantsAddOpen(searchParams)

  function onUpdateAddOpen(open: boolean) {
    const next = new URLSearchParams(searchParams)
    if (open) next.set('add', '1')
    else next.delete('add')
    updateSearchParams(next, { replace: true })
  }

  if (!id) {
    return (
      <Decorations
        summary="集合"
        scrollable={false}>
        <p className="p-6 text-sm text-muted-foreground">缺少集合 id（?id=）</p>
      </Decorations>
    )
  }

  return (
    <Decorations
      summary={title}
      scrollable={false}>
      <CollectionPanel
        key={id}
        id={id}
        isAddOpen={isAddOpen}
        onUpdateAddOpen={onUpdateAddOpen}
        onTitleChange={onUpdateTitle}
      />
    </Decorations>
  )
}
