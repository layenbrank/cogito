/**
 * 侧栏搜索面板：对齐 VS Code Search 视图的交互骨架。
 */
import { SearchSurfaceForm } from '@/views/code/workspace/search/search-surface-form.tsx'
import { useSearchSurface } from '@/views/code/workspace/search/use-search-surface.ts'

function SearchSurface() {
  const state = useSearchSurface()
  return <SearchSurfaceForm {...state} />
}

export { SearchSurface }
