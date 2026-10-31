import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useSignboardStore, type ColumnRole } from '@/stores/signboard'

function useColumnLaneState(options: {
  columnID: string
  requestAdd?: boolean
  onConsumedAddRequest?: () => void
  onWriteCard: (columnID: string, title: string) => Promise<void>
}) {
  const toUpdateColumn = useSignboardStore(function (state) {
    return state.toUpdateColumn
  })
  const [isAdding, setIsAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  if (options.requestAdd && !isAdding) {
    setIsAdding(true)
  }

  // 解构到局部：依赖只认这两个值，避免 options 整体换引用导致 effect 无谓重跑
  const requestAdd = options.requestAdd
  const onConsumedAddRequest = options.onConsumedAddRequest
  useEffect(
    function () {
      if (!requestAdd) return
      onConsumedAddRequest?.()
      requestAnimationFrame(function () {
        inputRef.current?.focus()
      })
    },
    [requestAdd, onConsumedAddRequest]
  )

  async function updateRole(role: ColumnRole | null) {
    const ok = await toUpdateColumn(options.columnID, { role })
    if (!ok) toast.error('列语义更新失败')
  }

  async function updateColor(color: string | null) {
    const ok = await toUpdateColumn(options.columnID, {
      color: color ?? ''
    })
    if (!ok) toast.error(color ? '设置列颜色失败' : '移除列颜色失败')
  }

  async function commit() {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    await options.onWriteCard(options.columnID, title)
    setIsAdding(true)
    requestAnimationFrame(function () {
      inputRef.current?.focus()
    })
  }

  function cancelAdd() {
    setIsAdding(false)
    setDraft('')
  }

  function startAddCard() {
    setIsAdding(true)
    requestAnimationFrame(function () {
      inputRef.current?.focus()
    })
  }

  return {
    isAdding,
    draft,
    setDraft,
    inputRef,
    updateRole,
    updateColor,
    commit,
    cancelAdd,
    startAddCard,
    setIsAdding
  }
}

export { useColumnLaneState }
