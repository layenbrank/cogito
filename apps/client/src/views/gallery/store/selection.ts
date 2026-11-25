import { create } from 'zustand'

/**
 * 选择集：锚点 + Shift 范围选 + 全选。
 *
 * 「范围」按**当前视图顺序**算（不是 catalog 顺序）—— 用户看到什么就选什么，
 * 所以 `toClick` 必须拿到渲染顺序。
 */
interface SelectionState {
  ids: Set<string>
  anchorID: string | null
  /** 选择模式：单击即多选（Enter 进出） */
  isMode: boolean
  toToggleMode: () => void
  toClick: (id: string, options: { additive: boolean; range: boolean; order: string[] }) => void
  toSelectOnly: (ids: string[]) => void
  toSelectAll: (order: string[]) => void
  toClear: () => void
}

const useSelectionStore = create<SelectionState>()(function (set, get) {
  return {
    ids: new Set(),
    anchorID: null,
    isMode: false,

    toToggleMode() {
      const next = !get().isMode
      set({ isMode: next, ids: next ? get().ids : new Set() })
    },

    toClick(id, options) {
      const { ids, anchorID, isMode } = get()
      if (options.range && anchorID) {
        const from = options.order.indexOf(anchorID)
        const to = options.order.indexOf(id)
        if (from >= 0 && to >= 0) {
          const [start, end] = from <= to ? [from, to] : [to, from]
          const next = new Set(isMode || options.additive ? ids : [])
          for (let index = start; index <= end; index += 1) {
            const item = options.order[index]
            if (item) next.add(item)
          }
          set({ ids: next })
          return
        }
      }
      if (options.additive || isMode) {
        const next = new Set(ids)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        set({ ids: next, anchorID: id })
        return
      }
      set({ ids: new Set([id]), anchorID: id })
    },

    toSelectOnly(ids) {
      set({ ids: new Set(ids), anchorID: ids.length === 1 ? ids[0] ?? null : get().anchorID })
    },

    toSelectAll(order) {
      set({ ids: new Set(order) })
    },

    toClear() {
      set({ ids: new Set(), anchorID: null })
    }
  }
})

export { useSelectionStore }
export type { SelectionState }
