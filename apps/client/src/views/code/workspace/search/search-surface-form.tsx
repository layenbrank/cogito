import { SearchResults } from '@/views/code/workspace/search/results.tsx'
import { SearchSurfaceHeader } from '@/views/code/workspace/search/search-surface-header.tsx'
import { SearchSurfaceInputs } from '@/views/code/workspace/search/search-surface-inputs.tsx'
import { SearchSurfaceReplaceDialog } from '@/views/code/workspace/search/search-surface-replace-dialog.tsx'
import type { useSearchSurface } from '@/views/code/workspace/search/use-search-surface.ts'

type SearchSurfaceState = ReturnType<typeof useSearchSurface>

function SearchSurfaceForm(props: SearchSurfaceState) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SearchSurfaceHeader {...props} />

      <div className="flex min-h-0 flex-1 flex-col gap-1 p-2 pt-1">
        <SearchSurfaceInputs {...props} />

        <SearchResults
          hits={props.isActive ? props.hits : []}
          isSearching={props.isSearching}
          isTruncated={props.isActive && props.isTruncated}
          collapseToken={props.collapseToken}
          onOpen={props.onOpenHit}
        />
      </div>

      <SearchSurfaceReplaceDialog {...props} />
    </div>
  )
}

export { SearchSurfaceForm }
