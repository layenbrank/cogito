import { useCodeGitStore } from '@/stores/code-git'
import { useCodeStore } from '@/stores/code'
import { requestCloseTabs } from '@/views/code/lib/close-tabs.ts'
import type { DiffLayout } from '@/views/code/workspace/diff-host-layout.ts'

function findModeHint(
  diff: NonNullable<ReturnType<typeof useCodeGitStore.getState>['diff']>,
  layout: DiffLayout
) {
  const layoutHint = layout === 'sideBySide' ? '并排' : '单列'
  const revHint = diff.newOid
    ? `${(diff.oldOid || '∅').slice(0, 7)} ↔ ${diff.newOid.slice(0, 7)}`
    : 'HEAD ↔ 工作区'
  if (diff.isIdentical) return '内容相同（仅换行差异已忽略）'
  if (diff.mode === 'hunks') return `大改动 · hunks · ${layoutHint}`
  return `${revHint} · ${layoutHint}`
}

function onOpenInEditor() {
  const diff = useCodeGitStore.getState().diff
  const repoRoot = useCodeGitStore.getState().repoRoot
  if (!diff || !repoRoot) return
  const absolute = `${repoRoot.replace(/[\\/]+$/, '')}/${diff.relative}`
  useCodeStore.getState().toOpenTab({ path: absolute })
}

function onCloseDiffTab() {
  const active = useCodeStore.getState().tabs.find(function (tab) {
    return tab.id === useCodeStore.getState().activeTabId
  })
  if (active?.kind === 'diff') {
    requestCloseTabs([active.id])
    return
  }
  useCodeGitStore.getState().toCloseDiff()
}

export { findModeHint, onCloseDiffTab, onOpenInEditor }
