import type { ContentHit } from '@/lib/workspace-files'

interface FileGroup {
  relative: string
  path: string
  hits: ContentHit[]
}

function groupHits(hits: ContentHit[]): FileGroup[] {
  const groups: FileGroup[] = []
  const byRelative = new Map<string, FileGroup>()
  for (const hit of hits) {
    let group = byRelative.get(hit.relative)
    if (!group) {
      group = { relative: hit.relative, path: hit.path, hits: [] }
      byRelative.set(hit.relative, group)
      groups.push(group)
    }
    group.hits.push(hit)
  }
  return groups
}

export { groupHits }
export type { FileGroup }
