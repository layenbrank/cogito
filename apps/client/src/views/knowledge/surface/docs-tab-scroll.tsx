import { Button } from '@cogito/design/components/button'
import { ScrollArea } from '@cogito/design/components/scroll-area'

import { formatTime } from '@/views/knowledge/lib/format.ts'
import type { useDocsTab } from '@/views/knowledge/surface/use-docs-tab.ts'

type DocsTabState = ReturnType<typeof useDocsTab>

function DocsTabScroll(props: DocsTabState) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      {props.hits.length > 0 ? (
        <ul className="mb-2 flex flex-col gap-0.5">
          <li className="px-1 text-[11px] text-muted-foreground">
            命中 {props.hits.length}
          </li>
          {props.hits.map(function (hit) {
            return (
              <li key={hit.docId}>
                <Button
                  variant="ghost"
                  type="button"
                  className="h-auto w-full rounded-md px-1.5 py-1 text-left hover:bg-muted"
                  onClick={function () {
                    void props.openDoc(hit.relPath)
                  }}>
                  <span className="block truncate text-xs">{hit.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {hit.snippet}
                  </span>
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}

      <p className="px-1 pb-1 text-[11px] text-muted-foreground">文档 {props.docs.length}</p>
      {props.docs.length === 0 && !props.isLoading ? (
        <div className="text-muted-foreground space-y-1 px-1 py-2 text-xs">
          <p>暂无文档</p>
          <p className="text-[11px] leading-relaxed">
            可在「来源」放入资料后 ingest，或点上方「生成」让助手直接写 wiki 页。
          </p>
        </div>
      ) : null}
      <ul className="flex flex-col gap-0.5">
        {props.docs.map(function (doc) {
          return (
            <li key={doc.id}>
              <Button
                variant="ghost"
                type="button"
                className="h-auto w-full rounded-md px-1.5 py-1 text-left hover:bg-muted"
                onClick={function () {
                  void props.openDoc(doc.relPath)
                }}>
                <span className="block truncate text-xs">{doc.title}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {doc.relPath} · {doc.wordCount} 字 · {formatTime(doc.updatedAt)}
                </span>
              </Button>
            </li>
          )
        })}
      </ul>
    </ScrollArea>
  )
}

export { DocsTabScroll }
