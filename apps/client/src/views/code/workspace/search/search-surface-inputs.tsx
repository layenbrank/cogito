import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { cn } from 'cn'

import {
  FieldShell,
  SearchStatus,
  ToggleButton
} from '@/views/code/workspace/search/search-surface-parts.tsx'
import type { useSearchSurface } from '@/views/code/workspace/search/use-search-surface.ts'

type SearchSurfaceState = ReturnType<typeof useSearchSurface>

function SearchSurfaceInputs(props: SearchSurfaceState) {
  return (
    <>
      <div className="flex min-w-0 flex-col gap-1">
        <FieldShell className={!props.isQueryValid ? 'border-destructive' : undefined}>
          <input
            value={props.query}
            placeholder="搜索"
            aria-label="在工作区中查找"
            className="text-foreground placeholder:text-muted-foreground h-6 min-w-0 flex-1 bg-transparent px-1 text-xs outline-none"
            onChange={function (event) {
              props.updateQuery(event.target.value)
            }}
            onKeyDown={function (event) {
              if (event.key === 'Enter') props.onRefresh()
            }}
          />
          <ToggleButton
            icon="lucide:case-sensitive"
            label="区分大小写"
            isActive={props.isCaseSensitive}
            onClick={function () {
              props.setCaseSensitive(!props.isCaseSensitive)
            }}
          />
          <ToggleButton
            icon="lucide:whole-word"
            label="全字匹配"
            isActive={props.isWholeWord}
            onClick={function () {
              props.setWholeWord(!props.isWholeWord)
            }}
          />
          <ToggleButton
            icon="lucide:regex"
            label="使用正则表达式"
            isActive={props.isRegex}
            onClick={function () {
              props.setRegex(!props.isRegex)
            }}
          />
        </FieldShell>

        <FieldShell>
          <input
            value={props.replacement}
            placeholder="替换"
            aria-label="替换为"
            className="text-foreground placeholder:text-muted-foreground h-6 min-w-0 flex-1 bg-transparent px-1 text-xs outline-none"
            onChange={function (event) {
              props.updateReplacement(event.target.value)
            }}
          />
          <ToggleButton
            icon="lucide:case-upper"
            label="保留大小写"
            isActive={props.isPreserveCase}
            onClick={function () {
              props.setPreserveCase(!props.isPreserveCase)
            }}
          />
          <Button
            variant="ghost"
            size="icon-xs"
            type="button"
            aria-label="全部替换"
            title="全部替换"
            disabled={!props.canReplace}
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-sm',
              props.canReplace
                ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
                : 'text-muted-foreground/40 pointer-events-none'
            )}
            onClick={function () {
              props.setConfirmOpen(true)
            }}>
            <Icon
              icon="lucide:replace-all"
              className="size-3.5"
            />
          </Button>
        </FieldShell>

        <FieldShell>
          <input
            value={props.includes}
            placeholder="包含的文件，例如 *.ts, src"
            aria-label="包含的文件"
            className="text-foreground placeholder:text-muted-foreground h-6 min-w-0 flex-1 bg-transparent px-1 text-xs outline-none"
            onChange={function (event) {
              props.updateIncludes(event.target.value)
            }}
          />
        </FieldShell>
        <FieldShell>
          <input
            value={props.excludes}
            placeholder="排除的文件，例如 dist, **/*.min.js"
            aria-label="排除的文件"
            className="text-foreground placeholder:text-muted-foreground h-6 min-w-0 flex-1 bg-transparent px-1 text-xs outline-none"
            onChange={function (event) {
              props.updateExcludes(event.target.value)
            }}
          />
        </FieldShell>
      </div>

      {!props.isQueryValid ? (
        <p className="text-destructive px-1 text-[11px]">表达式无效</p>
      ) : props.trimmed && props.isQueryValid ? (
        <SearchStatus
          isSearching={props.isSearching}
          fileCount={props.groups.length}
          matchCount={props.totalMatches}
        />
      ) : null}

      {props.roots.length === 0 ? (
        <p className="text-muted-foreground px-1 text-xs">尚未打开文件夹</p>
      ) : props.trimmed && !props.isSearching && props.isQueryValid && props.hits.length === 0 ? (
        <p className="text-muted-foreground animate-in fade-in-0 motion-reduce:animate-none px-1 text-xs duration-200">
          没有匹配内容
        </p>
      ) : null}
    </>
  )
}

export { SearchSurfaceInputs }
