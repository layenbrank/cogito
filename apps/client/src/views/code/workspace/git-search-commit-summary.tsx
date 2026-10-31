import { Badge } from '@cogito/design/components/badge'
import { Separator } from '@cogito/design/components/separator'

import type { useCodeGitStore } from '@/stores/code-git'
import { formatCommitRelativeTime, findAuthorInitials } from '@/views/code/workspace/git-search-format.ts'

type CommitHit = ReturnType<typeof useCodeGitStore.getState>['searchHits'][number]

interface GitSearchCommitSummaryProps {
  hit: CommitHit
  onCopySha: (oid: string) => void
}

function GitSearchCommitSummary(props: GitSearchCommitSummaryProps) {
  const hit = props.hit
  return (
    <div className="border-border/40 bg-muted/20 flex shrink-0 flex-col gap-1 border-b px-2.5 py-2">
      <p className="text-foreground line-clamp-2 text-sm leading-5 font-medium">
        {hit.subject || '(无说明)'}
      </p>
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="bg-muted text-muted-foreground flex size-6 items-center justify-center rounded-full text-xs font-semibold">
          {findAuthorInitials(hit.authorName)}
        </span>
        <span>{hit.authorName}</span>
        <Separator
          orientation="vertical"
          className="h-3.5"
        />
        <span>{formatCommitRelativeTime(hit.committedAt)}</span>
        <Separator
          orientation="vertical"
          className="h-3.5"
        />
        <button
          type="button"
          className="hover:text-foreground font-mono text-xs tabular-nums underline-offset-2 hover:underline"
          title="点击复制完整 SHA"
          onClick={function () {
            props.onCopySha(hit.oid)
          }}>
          {hit.short}
        </button>
        {hit.parentOid ? (
          <>
            <Separator
              orientation="vertical"
              className="h-3.5"
            />
            <span className="font-mono text-xs tabular-nums opacity-70">
              {hit.parentOid.slice(0, 7)}..{hit.short}
            </span>
          </>
        ) : (
          <Badge
            variant="secondary"
            className="h-5 rounded-sm px-1.5 text-xs">
            根提交
          </Badge>
        )}
      </div>
    </div>
  )
}

export { GitSearchCommitSummary }
