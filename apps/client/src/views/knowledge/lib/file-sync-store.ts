/**
 * File Sync 任务态（P1）：与 ingest Activity 并列展示 rename/delete 清理结果。
 * P0 仍由 sources-watch 直接处理；本 store 供 Activity 扩展与后续 Rust 队列接入。
 */
import { create } from 'zustand'

type FileSyncKind = 'create' | 'modify' | 'delete' | 'rename'
type FileSyncStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'ignored'

interface FileSyncTask {
  id: string
  kind: FileSyncKind
  path: string
  status: FileSyncStatus
  error?: string
  at: number
}

interface FileSyncState {
  tasks: FileSyncTask[]
  pushTask: (input: Omit<FileSyncTask, 'id' | 'at' | 'status'> & { status?: FileSyncStatus }) => void
  retry: (id: string) => void
  ignore: (id: string) => void
  clearDone: () => void
}

const useFileSyncStore = create<FileSyncState>(function (set, get) {
  return {
    tasks: [],
    pushTask: function (input) {
      const id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `fsync-${Date.now()}`
      set({
        tasks: [
          {
            id,
            kind: input.kind,
            path: input.path,
            status: input.status ?? 'succeeded',
            error: input.error,
            at: Date.now()
          },
          ...get().tasks
        ].slice(0, 100)
      })
    },
    retry: function (id) {
      set({
        tasks: get().tasks.map(function (task) {
          if (task.id !== id) return task
          return { ...task, status: 'pending', error: undefined }
        })
      })
    },
    ignore: function (id) {
      set({
        tasks: get().tasks.map(function (task) {
          if (task.id !== id) return task
          return { ...task, status: 'ignored' }
        })
      })
    },
    clearDone: function () {
      set({
        tasks: get().tasks.filter(function (task) {
          return task.status !== 'succeeded' && task.status !== 'ignored'
        })
      })
    }
  }
})

export { useFileSyncStore }
export type { FileSyncKind, FileSyncStatus, FileSyncTask }
