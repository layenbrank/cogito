import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

import { CollectionSurface } from '@/views/collection/surface.tsx'
import { useCollectionMembers } from '@/views/collection/use-collection-members.ts'

function wantsAddOpen(params: URLSearchParams) {
  return params.get('add') === '1'
}

/** 双击集合磁贴进入的集合页：成员网格、添加已有网址、移出集合。 */
export default function Collection() {
  const params = useParams()
  const [searchParams] = useSearchParams()
  const id = params.id?.trim() ?? ''
  const [stack, onUpdateStack] = useState<string[]>([id])

  useEffect(
    function () {
      onUpdateStack([id])
    },
    [id]
  )

  const currentId = stack[stack.length - 1] || id
  const { title, magneticTiles, onUpdateMagneticTiles, reloadMembers } = useCollectionMembers(currentId)
  const [isAddOpen, updateAddOpen] = useState(function () {
    return wantsAddOpen(searchParams)
  })

  if (!id) {
    return <p className="p-6 text-sm text-muted-foreground">缺少集合 id</p>
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
