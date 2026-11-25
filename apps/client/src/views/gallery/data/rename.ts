import {
  POST_MEDIA_RENAME_APPLY,
  POST_MEDIA_RENAME_PLAN,
  POST_MEDIA_RENAME_UNDO
} from '@/apis/media'

/**
 * 批量重命名的前端入口。真正的校验 / 改文件 / 迁移日志全在 Rust
 * （`media/rename.rs`）：渲染进程只负责收集模板、展示预览、确认执行。
 */
interface RenameOptions {
  template?: string
  place?: string
  start?: number
}

interface RenamePlanRow {
  id: string
  fromPath: string
  fromName: string
  toName: string
  toPath: string
  capturedAt: number
  warnings: string[]
}

interface RenameConflict {
  id: string
  code: string
  message: string
}

interface RenamePlan {
  rows: RenamePlanRow[]
  conflicts: RenameConflict[]
  skipped: string[]
}

interface RenameResult {
  renamed: string[]
  sidecars: number
  journalPath: string
}

interface RenameUndoResult {
  restored: string[]
  journalPath: string
}

function planRename(ids: string[], options: RenameOptions = {}): Promise<RenamePlan> {
  return POST_MEDIA_RENAME_PLAN<RenamePlan>({
    ids,
    template: options.template ?? null,
    place: options.place ?? null,
    start: options.start ?? null
  })
}

function applyRename(rows: { id: string; toName: string }[]): Promise<RenameResult> {
  return POST_MEDIA_RENAME_APPLY<RenameResult>({ rows })
}

/** 撤销一次批量改名：只吃 apply 返回的日志路径，文件被外部动过会整批拒绝 */
function undoRename(journalPath: string): Promise<RenameUndoResult> {
  return POST_MEDIA_RENAME_UNDO<RenameUndoResult>({ journalPath })
}

export { applyRename, planRename, undoRename }
export type {
  RenameConflict,
  RenamePlan,
  RenamePlanRow,
  RenameResult,
  RenameUndoResult
}
