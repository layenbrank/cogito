import type { SearchField } from '@/lib/workspace-git'

const GIT_SEARCH_FIELDS: { id: SearchField; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'message', label: '消息' },
  { id: 'author', label: '作者' },
  { id: 'hash', label: 'Hash' }
]

const GIT_FILE_STATUS_TONE: Record<string, string> = {
  A: 'text-emerald-600 dark:text-emerald-400',
  D: 'text-destructive',
  R: 'text-primary',
  C: 'text-primary',
  T: 'text-amber-600 dark:text-amber-400',
  M: 'text-amber-600 dark:text-amber-400'
}

function formatCommitRelativeTime(unixSeconds: number): string {
  if (!unixSeconds) return ''
  const delta = Math.max(0, Date.now() / 1000 - unixSeconds)
  if (delta < 60) return '刚刚'
  if (delta < 3600) return `${Math.floor(delta / 60)} 分钟前`
  if (delta < 86400) return `${Math.floor(delta / 3600)} 小时前`
  if (delta < 86400 * 30) return `${Math.floor(delta / 86400)} 天前`
  const date = new Date(unixSeconds * 1000)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function findAuthorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

function findGitFileName(relative: string): string {
  const slash = relative.lastIndexOf('/')
  return slash < 0 ? relative : relative.slice(slash + 1)
}

function findGitParentPath(relative: string): string {
  const slash = relative.lastIndexOf('/')
  return slash < 0 ? '' : relative.slice(0, slash)
}

export {
  GIT_SEARCH_FIELDS,
  GIT_FILE_STATUS_TONE,
  formatCommitRelativeTime,
  findAuthorInitials,
  findGitFileName,
  findGitParentPath
}
