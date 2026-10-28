/**
 * 指令草稿收件箱（SQLite `directive_draft`）。
 *
 * agent 只往这里写草稿；用户确认后才由「指令」磁贴走 `sidecar:saveDirective` 落到 corex.db。
 */
import { create } from 'zustand'

import {
  listDrafts,
  removeDraft,
  saveDraft,
  setDraftStatus,
  type DirectiveDraft,
  type DraftSave
} from '@/lib/directive-draft-ipc'
import { DICT_VALUE } from '@/shared/ipc/specs/dict'
import { reportCaught } from '@/utils/exception-report'

const DRAFT = DICT_VALUE.DIRECTIVE_DRAFT_STATUS

interface DirectiveDraftState {
  drafts: DirectiveDraft[]
  isLoading: boolean
  loadError: string | null
  refresh: () => Promise<void>
  save: (input: DraftSave) => Promise<DirectiveDraft | null>
  markSaved: (id: string) => Promise<void>
  discard: (id: string) => Promise<void>
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return String(error)
}

const useDirectiveDraftStore = create<DirectiveDraftState>()(function (setter, getter) {
  return {
    drafts: [],
    isLoading: false,
    loadError: null,

    async refresh() {
      setter({ isLoading: true, loadError: null })
      try {
        const drafts = await listDrafts(DRAFT.PENDING)
        setter({ drafts, isLoading: false })
      } catch (error) {
        setter({ isLoading: false, loadError: toMessage(error) })
        reportCaught('directiveDraft.refresh', error, 'warning')
      }
    },

    async save(input) {
      try {
        const draft = await saveDraft(input)
        setter({
          drafts: [draft, ...getter().drafts.filter(function (item) {
            return item.id !== draft.id
          })]
        })
        return draft
      } catch (error) {
        setter({ loadError: toMessage(error) })
        reportCaught('directiveDraft.save', error, 'warning')
        return null
      }
    },

    async markSaved(id) {
      try {
        await setDraftStatus({ id, status: DRAFT.SAVED })
        setter({
          drafts: getter().drafts.filter(function (item) {
            return item.id !== id
          })
        })
      } catch (error) {
        setter({ loadError: toMessage(error) })
        reportCaught('directiveDraft.markSaved', error, 'warning')
      }
    },

    async discard(id) {
      try {
        await removeDraft(id)
        setter({
          drafts: getter().drafts.filter(function (item) {
            return item.id !== id
          })
        })
      } catch (error) {
        setter({ loadError: toMessage(error) })
        reportCaught('directiveDraft.discard', error, 'warning')
      }
    }
  }
})

export { useDirectiveDraftStore }
