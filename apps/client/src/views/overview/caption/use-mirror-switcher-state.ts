import { useEffect, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'

import {
  findIsMirrorSwitching,
  requestMirrorSwitch,
  subscribeMirrorSwitching
} from '@/features/controller/mirror-switch'
import { useMirrorStore } from '@/stores/mirror.ts'
import { buildMirrorWrite, findNextTitle } from '@/views/overview/caption/mirror-utils'

function useMirrorSwitcherState() {
  const mirrors = useMirrorStore(function (state) {
    return state.mirrors
  })
  const activeID = useMirrorStore(function (state) {
    return state.active.mirror?.id
  })
  const [isBusy, updateBusy] = useState(findIsMirrorSwitching)
  const [isOpen, updateOpen] = useState(false)
  const [isManageOpen, updateManageOpen] = useState(false)
  const [cursor, updateCursor] = useState(0)

  useEffect(function () {
    return subscribeMirrorSwitching(function () {
      updateBusy(findIsMirrorSwitching())
    })
  }, [])

  const sorted = mirrors.slice().toSorted(function (a, b) {
    return a.index - b.index
  })
  const activeIndex = sorted.findIndex(function (mirror) {
    return mirror.id === activeID
  })
  const active = activeIndex >= 0 ? sorted[activeIndex] : undefined

  function handleOpenChange(next: boolean) {
    updateOpen(next)
    if (next) updateCursor(activeIndex >= 0 ? activeIndex : 0)
  }

  async function switchTo(id: string) {
    updateOpen(false)
    await requestMirrorSwitch(id)
  }

  async function handleCreate() {
    const write = buildMirrorWrite(findNextTitle(sorted), sorted.length)
    try {
      await useMirrorStore.getState().toInsertMirror([write])
    } catch (error) {
      console.error('[caption-mirror] 新建镜像失败', error)
      toast.error('新建镜像失败')
      return
    }

    const created = useMirrorStore.getState().mirrors.find(function (mirror) {
      return mirror.index === write.index && mirror.title === write.title
    })
    if (created) await switchTo(created.id)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      updateCursor(function (current) {
        return (current + step + sorted.length) % sorted.length
      })
      return
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      updateCursor(event.key === 'Home' ? 0 : sorted.length - 1)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const target = sorted[cursor]
      if (target && target.id !== activeID) void switchTo(target.id)
    }
  }

  return {
    sorted,
    active,
    activeID,
    isBusy,
    isOpen,
    isManageOpen,
    cursor,
    updateOpen,
    updateManageOpen,
    updateCursor,
    handleOpenChange,
    switchTo,
    handleCreate,
    onKeyDown
  }
}

export { useMirrorSwitcherState }
