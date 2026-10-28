/**
 * 诊断计数：错误 / 警告分开统计，状态栏与问题面板共用一份口径。
 *
 * Monaco 的 markers 是全局广播的，两处各自 `getModelMarkers` 再各写一次 store
 * 会互相覆盖；统一从这里取数与回写。
 */
import * as monaco from 'monaco-editor'

import { useCodeStore, type ProblemCounts } from '@/stores/code'

const EMPTY_COUNTS: ProblemCounts = { errors: 0, warnings: 0 }

function findModelMarkers(model: monaco.editor.ITextModel | null): monaco.editor.IMarker[] {
  if (!model) return []
  return monaco.editor.getModelMarkers({ resource: model.uri })
}

function countMarkers(markers: monaco.editor.IMarker[]): ProblemCounts {
  let errors = 0
  let warnings = 0
  for (const marker of markers) {
    if (marker.severity === monaco.MarkerSeverity.Error) errors += 1
    else if (marker.severity === monaco.MarkerSeverity.Warning) warnings += 1
  }
  return { errors, warnings }
}

/** 读当前 model 的诊断并写回 store；没有 model 时清零 */
function pushProblemCounts(model: monaco.editor.ITextModel | null): void {
  const markers = findModelMarkers(model)
  useCodeStore.getState().toSetProblemCounts(markers.length > 0 ? countMarkers(markers) : EMPTY_COUNTS)
}

export { EMPTY_COUNTS, findModelMarkers, countMarkers, pushProblemCounts }
