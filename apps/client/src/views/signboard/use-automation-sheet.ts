import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useSignboardStore, type SignboardAutomation } from '@/stores/signboard'
import {
  buildActionJson,
  buildConditionJson,
  emptyAutomationDraft,
  fillAutomationDraft,
  type AutomationDraft
} from '@/views/signboard/automation-sheet-drafts.ts'

function useAutomationSheet(boardID: string | null) {
  const automations = useSignboardStore(function (state) {
    return state.automations
  })
  const toWriteAutomation = useSignboardStore(function (state) {
    return state.toWriteAutomation
  })
  const toUpdateAutomation = useSignboardStore(function (state) {
    return state.toUpdateAutomation
  })
  const toRemoveAutomation = useSignboardStore(function (state) {
    return state.toRemoveAutomation
  })

  const [draft, setDraft] = useState<AutomationDraft>(emptyAutomationDraft)
  const [editingID, setEditingID] = useState<string | null>(null)

  const ordered = useMemo(
    function () {
      return automations.slice().sort(function (a, b) {
        return a.index - b.index
      })
    },
    [automations]
  )

  function resetForm() {
    setDraft(emptyAutomationDraft())
    setEditingID(null)
  }

  function fillRule(rule: SignboardAutomation) {
    setDraft(fillAutomationDraft(rule))
    setEditingID(rule.id)
  }

  async function saveRule() {
    if (!boardID) return
    const title = draft.title.trim() || '未命名规则'
    if (draft.actionType === 'attachTag' && !draft.tagID) {
      toast.error('请选择要附加的标签')
      return
    }
    const payload = {
      title,
      enabled: draft.enabled,
      trigger: draft.trigger,
      conditionJson: buildConditionJson(draft),
      actionJson: buildActionJson(draft)
    }
    if (editingID) {
      const ok = await toUpdateAutomation(editingID, payload)
      if (!ok) {
        toast.error('更新规则失败')
        return
      }
      toast.success('已更新规则')
    } else {
      const id = await toWriteAutomation({ boardID, ...payload })
      if (!id) {
        toast.error('创建规则失败')
        return
      }
      toast.success('已创建规则')
    }
    resetForm()
  }

  return {
    ordered,
    draft,
    setDraft,
    editingID,
    resetForm,
    fillRule,
    saveRule,
    toUpdateAutomation,
    toRemoveAutomation
  }
}

export { useAutomationSheet }
