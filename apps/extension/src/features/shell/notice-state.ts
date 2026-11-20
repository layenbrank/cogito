import { create } from 'zustand'

interface NoticeState {
  message: string | null
  show: (message: string) => void
}

let timer = 0

export const useNotice = create<NoticeState>(function (set) {
  return {
    message: null,
    show(message) {
      window.clearTimeout(timer)
      set({ message })
      timer = window.setTimeout(function () {
        set({ message: null })
      }, 2400)
    }
  }
})

export function notify(message: string): void {
  useNotice.getState().show(message)
}
