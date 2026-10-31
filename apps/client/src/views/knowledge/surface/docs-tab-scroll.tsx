import { Button } from '@cogito/design/components/button'
import { ScrollArea } from '@cogito/design/components/scroll-area'

import { DICT_TYPE, DICT_VALUE } from '@/shared/ipc/specs/dict'
import { formatTime } from '@/views/knowledge/lib/format.ts'
import type { useDocsTab } from '@/views/knowledge/surface/use-docs-tab.ts'

/** 云端角标样式按 value；文案走字典 label */
const CLOUD_BADGE_CLASS: Record<string, string> = {
  [DICT_VALUE.KNOWLEDGE_CLOUD_STATUS.PENDING]: 'text-muted-foreground',
  [DICT_VALUE.KNOWLEDGE_CLOUD_STATUS.RUNNING]:
    'text-amber-700 dark:text-amber-400',
  [DICT_VALUE.KNOWLEDGE_CLOUD_STATUS.SUCCEEDED]:
    'text-emerald-700 dark:text-emerald-400',
  [DICT_VALUE.KNOWLEDGE_CLOUD_STATUS.FAILED]: 'text-destructive'
}

type DocsTabState = ReturnType<typeof useDocsTab>

function DocsTabScroll(props: DocsTabState) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      {props.hits.length > 0 ? (
        <ul className="mb-2 flex flex-col gap-0.5">
          <li className="px-1 text-[11px] text-muted-foreground">
            命中 {props.hits.length}
            {props.counts.cloud > 0 ? `（本地 ${props.counts.local} · 云端 ${props.counts.cloud}）` : ''}
            {props.cloudState === 'unavailable' ? ' · 云端暂不可用' : ''}
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
        <p className="text-muted-foreground px-1 py-2 text-xs">暂无文档</p>
      ) : null}
      <ul className="flex flex-col gap-0.5">
        {props.docs.map(function (doc) {
          const cloudStatus = props.cloudStates[doc.id]?.status ?? ''
          const badgeClass = CLOUD_BADGE_CLASS[cloudStatus]
          const badgeLabel = badgeClass
            ? props.findLabel(DICT_TYPE.KNOWLEDGE_CLOUD_STATUS, cloudStatus)
            : null
          return (
            <li key={doc.id}>
              <Button
                variant="ghost"
                type="button"
                className="h-auto w-full rounded-md px-1.5 py-1 text-left hover:bg-muted"
                onClick={function () {
                  void props.openDoc(doc.relPath)
                }}>
                <span className="flex items-center gap-1">
                  <span className="truncate text-xs">{doc.title}</span>
                  {badgeLabel ? (
                    <span
                      className={`shrink-0 text-[10px] ${badgeClass}`}
                      title={props.cloudStates[doc.id]?.error ?? undefined}>
                      {badgeLabel}
                    </span>
                  ) : null}
                </span>
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
