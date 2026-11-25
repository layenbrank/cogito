/**
 * 侧栏 · 文档页：搜索 / 新建文档 / 文档列表 / 空间级动作。
 *
 * 空间切换在 `SpaceSwitcher`（侧栏顶行）；这里只列「这个空间里的文档」，
 * 磁盘文件夹树在「文件」视图（同一条侧栏的另一个 tab）。
 */
import { DocsTabScroll } from '@/views/knowledge/surface/docs-tab-scroll.tsx'
import { DocsTabToolbar } from '@/views/knowledge/surface/docs-tab-toolbar.tsx'
import { useDocsTab } from '@/views/knowledge/surface/use-docs-tab.ts'

function DocsTab() {
  const state = useDocsTab()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <DocsTabToolbar {...state} />
      <DocsTabScroll
        docs={state.docs}
        hits={state.hits}
        isLoading={state.isLoading}
        openDoc={state.openDoc}
      />
    </div>
  )
}

export { DocsTab }
