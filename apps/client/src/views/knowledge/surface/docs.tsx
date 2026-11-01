/**
 * 左面板 · 文档页：库切换 / 本地检索 / 文档列表 / 库级动作。
 *
 * 这里只列「库里的文档」；磁盘上的文件夹树仍在编辑器侧栏（那里能新建/重命名/删除）。
 */
import { DocsTabScroll } from '@/views/knowledge/surface/docs-tab-scroll.tsx'
import { DocsTabToolbar } from '@/views/knowledge/surface/docs-tab-toolbar.tsx'
import { useDocsTab } from '@/views/knowledge/surface/use-docs-tab.ts'

function DocsTab() {
  const state = useDocsTab()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <DocsTabToolbar {...state} />
      <DocsTabScroll {...state} />
    </div>
  )
}

export { DocsTab }
