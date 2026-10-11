import { Badge } from '@i-thinking/design/components/badge'
import { Input } from '@i-thinking/design/components/input'
import { ScrollArea } from '@i-thinking/design/components/scroll-area'
import { useMemo, useState } from 'react'

import { useCorexStore } from '@/stores/corex.ts'

interface OrchestratorCatalogProps {
  onInsertAction: (actionId: string) => void
}

function OrchestratorCatalog(props: OrchestratorCatalogProps) {
  const catalog = useCorexStore(function (state) {
    return state.catalog
  })
  const [query, setQuery] = useState('')

  const filtered = useMemo(
    function () {
      const q = query.trim().toLowerCase()
      if (!q) return catalog
      return catalog.filter(function (entry) {
        return (
          entry.id.toLowerCase().includes(q) ||
          entry.name.toLowerCase().includes(q) ||
          entry.description.toLowerCase().includes(q)
        )
      })
    },
    [catalog, query]
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 border-r bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          动作目录
        </p>
        <span className="text-[11px] text-muted-foreground">{filtered.length}</span>
      </div>
      <Input
        value={query}
        onChange={function (event) {
          setQuery(event.target.value)
        }}
        placeholder="筛选动作…"
        className="h-8"
      />
      <ScrollArea className="min-h-0 flex-1">
        <ul className="space-y-0.5 pr-2">
          {filtered.length === 0 ? (
            <li className="px-1 py-4 text-xs text-muted-foreground">没有匹配的动作</li>
          ) : null}
          {filtered.map(function (entry) {
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className="w-full rounded-md border border-transparent px-2 py-1.5 text-left text-xs transition-colors hover:border-border hover:bg-muted/70"
                  onClick={function () {
                    props.onInsertAction(entry.id)
                  }}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate font-medium">{entry.id}</span>
                    <Badge
                      variant="outline"
                      className="shrink-0 px-1.5 py-0 text-[10px]">
                      {entry.bucket}
                    </Badge>
                  </span>
                  <span className="mt-0.5 block text-muted-foreground line-clamp-1">
                    {entry.description || '无描述'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </ScrollArea>
    </div>
  )
}

export { OrchestratorCatalog }
