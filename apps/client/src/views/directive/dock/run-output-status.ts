import type { RunSelection } from './use-run-selection.ts'

function findRunProgress(selected: RunSelection['selected'], stepCount: number): number {
  if (!selected) return 0
  if (stepCount > 0) {
    return Math.min(100, (selected.doneSteps / stepCount) * 100)
  }
  if (selected.status === 'ok') return 100
  if (selected.status === 'running') return 8
  return 0
}

export { findRunProgress }
