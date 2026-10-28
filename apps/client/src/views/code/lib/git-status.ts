/**
 * `git status --porcelain` 的分组规则（纯函数，便于单测）。
 *
 * 一个文件同时有暂存与未暂存改动时会出现在两组里，这与 VS Code 的行为一致。
 */
import type { StatusEntry } from '@/lib/workspace-git'

interface GitGroups {
  staged: StatusEntry[]
  changed: StatusEntry[]
  untracked: StatusEntry[]
}

const IGNORED = ' '

function isUntracked(entry: StatusEntry): boolean {
  return entry.indexStatus === '?' || entry.worktreeStatus === '?'
}

function isIgnored(entry: StatusEntry): boolean {
  return entry.indexStatus === '!' || entry.worktreeStatus === '!'
}

function hasStaged(entry: StatusEntry): boolean {
  return entry.indexStatus !== IGNORED && !isUntracked(entry) && !isIgnored(entry)
}

function hasWorktreeChange(entry: StatusEntry): boolean {
  return entry.worktreeStatus !== IGNORED && !isUntracked(entry) && !isIgnored(entry)
}

function groupEntries(entries: StatusEntry[]): GitGroups {
  const groups: GitGroups = { staged: [], changed: [], untracked: [] }
  for (const entry of entries) {
    if (isIgnored(entry)) continue
    if (isUntracked(entry)) {
      groups.untracked.push(entry)
      continue
    }
    if (hasStaged(entry)) groups.staged.push(entry)
    if (hasWorktreeChange(entry)) groups.changed.push(entry)
  }
  return groups
}

/** 状态字符 → 展示用的单字母（暂存区优先） */
function findStatusBadge(entry: StatusEntry): string {
  const letter = hasStaged(entry) ? entry.indexStatus : entry.worktreeStatus
  const table: Record<string, string> = {
    M: 'M',
    A: 'A',
    D: 'D',
    R: 'R',
    C: 'C',
    T: 'T',
    U: 'U'
  }
  return table[letter] ?? '?'
}

export { groupEntries, findStatusBadge }
export type { GitGroups }
