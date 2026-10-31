import {
  HeaderAction
} from '@/views/code/workspace/search/search-surface-parts.tsx'
import type { useSearchSurface } from '@/views/code/workspace/search/use-search-surface.ts'

type SearchSurfaceState = ReturnType<typeof useSearchSurface>

function SearchSurfaceHeader(props: SearchSurfaceState) {
  return (
    <div className="border-border/60 text-muted-foreground flex h-7 shrink-0 items-center gap-2 px-3 text-xs font-semibold tracking-wider uppercase">
      <span className="truncate">搜索</span>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <HeaderAction
          icon="lucide:refresh-cw"
          label="刷新"
          isDisabled={!props.trimmed || !props.isQueryValid}
          isSpinning={props.isSearching}
          onClick={props.onRefresh}
        />
        <HeaderAction
          icon="lucide:list-x"
          label="清除搜索结果"
          isDisabled={!props.trimmed && props.hits.length === 0}
          onClick={props.onClear}
        />
        <HeaderAction
          icon="lucide:fold-vertical"
          label="折叠全部"
          isDisabled={props.groups.length === 0}
          onClick={props.onCollapseAll}
        />
      </div>
    </div>
  )
}

export { SearchSurfaceHeader }
