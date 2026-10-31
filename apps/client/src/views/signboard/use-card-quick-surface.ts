import { useState } from 'react'
import { toast } from 'sonner'

import {
  useSignboardStore,
  type SignboardCheck,
  type SignboardEntry
} from '@/stores/signboard'

function useCardQuickSurface(card: SignboardEntry, checklist: SignboardCheck[], focus: 'tags' | 'checks') {
  const activeBoardID = useSignboardStore(function (state) {
    return state.activeBoardID
  })
  const boardTags = useSignboardStore(function (state) {
    return state.tags
  })
  const tagIDsForEntry = useSignboardStore(function (state) {
    return state.tagIDsForEntry
  })
  const toTagEntry = useSignboardStore(function (state) {
    return state.toTagEntry
  })
  const toUntagEntry = useSignboardStore(function (state) {
    return state.toUntagEntry
  })
  const toWriteTag = useSignboardStore(function (state) {
    return state.toWriteTag
  })
  const toWriteCheck = useSignboardStore(function (state) {
    return state.toWriteCheck
  })
  const toUpdateCheck = useSignboardStore(function (state) {
    return state.toUpdateCheck
  })

  const [tagDraft, setTagDraft] = useState('')
  const [checkDraft, setCheckDraft] = useState('')
  const [tab, setTab] = useState<'tags' | 'checks'>(focus)
  const attached = tagIDsForEntry(card.id)
  const attachedSet = new Set(attached)
  const checkTotal = checklist.length
  const checkDone = checklist.filter(function (item) {
    return item.done
  }).length
  const checkPct = checkTotal === 0 ? 0 : Math.round((checkDone / checkTotal) * 100)

  async function toggleTag(tagID: string) {
    const isOn = attached.includes(tagID)
    const ok = isOn
      ? await toUntagEntry(card.id, tagID)
      : await toTagEntry(card.id, tagID)
    if (!ok) toast.error(isOn ? '移除标签失败' : '添加标签失败')
  }

  async function insertTag() {
    const title = tagDraft.trim()
    if (!title || !activeBoardID) return
    const existing = boardTags.find(function (tag) {
      return tag.title === title
    })
    if (existing) {
      setTagDraft('')
      const ok = await toTagEntry(card.id, existing.id)
      if (!ok) toast.error('绑定标签失败')
      return
    }
    const id = await toWriteTag(activeBoardID, title)
    if (!id) {
      toast.error('新建标签失败')
      return
    }
    setTagDraft('')
    const ok = await toTagEntry(card.id, id)
    if (!ok) toast.error('绑定标签失败')
  }

  async function addCheck() {
    const title = checkDraft.trim()
    if (!title) return
    const id = await toWriteCheck(card.id, title)
    if (!id) {
      toast.error('添加清单失败')
      return
    }
    setCheckDraft('')
  }

  return {
    boardTags,
    attachedSet,
    tagDraft,
    setTagDraft,
    checkDraft,
    setCheckDraft,
    tab,
    setTab,
    checkDone,
    checkTotal,
    checkPct,
    toggleTag,
    insertTag,
    addCheck,
    toUpdateCheck
  }
}

export { useCardQuickSurface }
