/**
 * 侧栏搜索面板：对齐 VS Code Search 视图的交互骨架。
 *
 * 检索走 Rust（能套 git 索引 + include/exclude）；替换走前端同一份正则。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@cogito/design/components/alert-dialog'
import { WorkspaceFiles, type ContentHit } from '@/lib/workspace-files'
import { cn } from 'cn'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { useCodeStore } from '@/stores/code'
import { revealLocation } from '@/views/code/lib/open-file.ts'
import { isValidQuery, type SearchQuery } from '@/views/code/lib/search-query.ts'
import { replaceInFiles } from '@/views/code/lib/search.ts'
import { SearchResults, groupHits } from '@/views/code/workspace/search/results.tsx'

const SEARCH_DELAY_MS = 300

function ToggleButton(props: {
  icon: string
  label: string
  isActive: boolean
  onClick: () => void
}) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      type="button"
      aria-label={props.label}
      aria-pressed={props.isActive}
      title={props.label}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-sm border border-transparent',
        props.isActive
          ? 'bg-primary/15 text-primary border-primary/30'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
      onClick={props.onClick}>
      <Icon
        icon={props.icon}
        className="size-3.5"
      />
    </Button>
  )
}

function HeaderAction(props: {
  icon: string
  label: string
  isDisabled?: boolean
  onClick(): void
}) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      type="button"
      aria-label={props.label}
      title={props.label}
      disabled={props.isDisabled}
      className={cn(
        'hover:bg-muted hover:text-foreground text-muted-foreground flex size-5 items-center justify-center rounded-sm',
        props.isDisabled && 'pointer-events-none opacity-40'
      )}
      onClick={function () {
        props.onClick()
      }}>
      <Icon
        icon={props.icon}
        className="size-3.5"
      />
    </Button>
  )
}

function FieldShell(props: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'border-input bg-background focus-within:border-ring flex min-h-7 items-center gap-0.5 rounded-md border px-1',
        props.className
      )}>
      {props.children}
    </div>
  )
}

function SearchSurface() {
  const workspaceRoot = useCodeStore(function (state) {
    return state.workspaceRoot
  })
  const [query, updateQuery] = useState('')
  const [isCaseSensitive, setCaseSensitive] = useState(false)
  const [isWholeWord, setWholeWord] = useState(false)
  const [isRegex, setRegex] = useState(false)
  const [isReplaceOpen, setReplaceOpen] = useState(false)
  const [isDetailsOpen, setDetailsOpen] = useState(false)
  const [replacement, updateReplacement] = useState('')
  const [isPreserveCase, setPreserveCase] = useState(false)
  const [includes, updateIncludes] = useState('')
  const [excludes, updateExcludes] = useState('')
  const [hits, updateHits] = useState<ContentHit[]>([])
  const [isTruncated, setTruncated] = useState(false)
  const [isSearching, setSearching] = useState(false)
  const [isConfirmOpen, setConfirmOpen] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const [collapseToken, setCollapseToken] = useState(0)

  const searchQuery: SearchQuery = useMemo(
    function () {
      return { query, isRegex, isCaseSensitive, isWholeWord }
    },
    [query, isRegex, isCaseSensitive, isWholeWord]
  )
  const isQueryValid = isValidQuery(searchQuery)
  const trimmed = query.trim()
  const isActive = Boolean(trimmed) && isQueryValid
  const groups = useMemo(
    function () {
      return groupHits(isActive ? hits : [])
    },
    [hits, isActive]
  )

  useEffect(
    function () {
      if (!workspaceRoot || !trimmed || !isQueryValid) return
      let cancelled = false
      const timer = window.setTimeout(function () {
        setSearching(true)
        void WorkspaceFiles.content({
          root: workspaceRoot,
          query: trimmed,
          isRegex,
          isCaseSensitive,
          isWholeWord,
          includes,
          excludes
        })
          .then(function (result) {
            if (cancelled) return
            updateHits(result.hits)
            setTruncated(result.isTruncated)
          })
          .catch(function (error: unknown) {
            if (cancelled) return
            updateHits([])
            setTruncated(false)
            toast.error(error instanceof Error ? error.message : '搜索失败')
          })
          .finally(function () {
            if (!cancelled) setSearching(false)
          })
      }, SEARCH_DELAY_MS)
      return function () {
        cancelled = true
        window.clearTimeout(timer)
      }
    },
    [
      workspaceRoot,
      trimmed,
      isRegex,
      isCaseSensitive,
      isWholeWord,
      isQueryValid,
      refreshToken,
      includes,
      excludes
    ]
  )

  function onOpenHit(hit: ContentHit) {
    void revealLocation(hit.path, hit.line, hit.column)
  }

  function onClear() {
    updateQuery('')
    updateReplacement('')
    updateHits([])
    setTruncated(false)
  }

  function onRefresh() {
    setRefreshToken(function (value) {
      return value + 1
    })
  }

  function onCollapseAll() {
    setCollapseToken(function (value) {
      return value + 1
    })
  }

  async function onConfirmReplace() {
    setConfirmOpen(false)
    try {
      const outcome = await replaceInFiles({
        paths: groups.map(function (group) {
          return group.path
        }),
        query: searchQuery,
        replacement,
        isPreserveCase
      })
      const total = outcome.changed.reduce(function (sum, item) {
        return sum + item.count
      }, 0)
      if (outcome.failed.length > 0) {
        toast.error(`${outcome.failed.length} 个文件替换失败，${total} 处已替换`)
      } else if (total > 0) {
        toast.success(`已在 ${outcome.changed.length} 个文件中替换 ${total} 处`)
      } else {
        toast.message('没有可替换的内容')
      }
      useCodeStore.getState().toBumpTree()
      onRefresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '替换失败')
    }
  }

  const totalMatches = isActive ? hits.length : 0
  const canReplace = totalMatches > 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border/60 text-muted-foreground flex h-7 shrink-0 items-center gap-2 px-3 text-xs font-semibold tracking-wider uppercase">
        <span className="truncate">搜索</span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <HeaderAction
            icon="lucide:refresh-cw"
            label="刷新"
            isDisabled={!trimmed || !isQueryValid}
            onClick={onRefresh}
          />
          <HeaderAction
            icon="lucide:list-x"
            label="清除搜索结果"
            isDisabled={!trimmed && hits.length === 0}
            onClick={onClear}
          />
          <HeaderAction
            icon="lucide:fold-vertical"
            label="折叠全部"
            isDisabled={groups.length === 0}
            onClick={onCollapseAll}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2 pt-1">
        <div className="flex items-start gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            type="button"
            aria-label={isReplaceOpen ? '收起替换' : '展开替换'}
            aria-pressed={isReplaceOpen}
            title="切换替换"
            className="text-muted-foreground hover:text-foreground mt-1 flex size-5 shrink-0 items-center justify-center"
            onClick={function () {
              setReplaceOpen(!isReplaceOpen)
            }}>
            <Icon
              icon={isReplaceOpen ? 'lucide:chevron-down' : 'lucide:chevron-right'}
              className="size-3.5"
            />
          </Button>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <FieldShell className={!isQueryValid ? 'border-destructive' : undefined}>
              <input
                value={query}
                placeholder="搜索"
                aria-label="在工作区中查找"
                className="text-foreground placeholder:text-muted-foreground h-6 min-w-0 flex-1 bg-transparent px-1 text-xs outline-none"
                onChange={function (event) {
                  updateQuery(event.target.value)
                }}
                onKeyDown={function (event) {
                  if (event.key === 'Enter') onRefresh()
                }}
              />
              <ToggleButton
                icon="lucide:case-sensitive"
                label="区分大小写"
                isActive={isCaseSensitive}
                onClick={function () {
                  setCaseSensitive(!isCaseSensitive)
                }}
              />
              <ToggleButton
                icon="lucide:whole-word"
                label="全字匹配"
                isActive={isWholeWord}
                onClick={function () {
                  setWholeWord(!isWholeWord)
                }}
              />
              <ToggleButton
                icon="lucide:regex"
                label="使用正则表达式"
                isActive={isRegex}
                onClick={function () {
                  setRegex(!isRegex)
                }}
              />
            </FieldShell>

            {isReplaceOpen ? (
              <FieldShell>
                <input
                  value={replacement}
                  placeholder="替换"
                  aria-label="替换为"
                  className="text-foreground placeholder:text-muted-foreground h-6 min-w-0 flex-1 bg-transparent px-1 text-xs outline-none"
                  onChange={function (event) {
                    updateReplacement(event.target.value)
                  }}
                />
                <ToggleButton
                  icon="lucide:case-upper"
                  label="保留大小写"
                  isActive={isPreserveCase}
                  onClick={function () {
                    setPreserveCase(!isPreserveCase)
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  type="button"
                  aria-label="全部替换"
                  title="全部替换"
                  disabled={!canReplace}
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-sm',
                    canReplace
                      ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      : 'text-muted-foreground/40 pointer-events-none'
                  )}
                  onClick={function () {
                    setConfirmOpen(true)
                  }}>
                  <Icon
                    icon="lucide:replace-all"
                    className="size-3.5"
                  />
                </Button>
              </FieldShell>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-end px-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            type="button"
            aria-label={isDetailsOpen ? '收起文件筛选' : '展开文件筛选'}
            aria-pressed={isDetailsOpen}
            title="切换搜索详细信息"
            className={cn(
              'text-muted-foreground hover:bg-muted hover:text-foreground flex size-5 items-center justify-center rounded-sm',
              isDetailsOpen && 'bg-muted text-foreground'
            )}
            onClick={function () {
              setDetailsOpen(!isDetailsOpen)
            }}>
            <Icon
              icon="lucide:ellipsis"
              className="size-3.5"
            />
          </Button>
        </div>

        {isDetailsOpen ? (
          <div className="flex flex-col gap-1.5 pl-[22px]">
            <label className="flex flex-col gap-0.5">
              <span className="text-muted-foreground text-[11px]">包含的文件</span>
              <FieldShell>
                <input
                  value={includes}
                  placeholder="例如 *.ts, src"
                  aria-label="包含的文件"
                  className="text-foreground placeholder:text-muted-foreground h-6 min-w-0 flex-1 bg-transparent px-1 text-xs outline-none"
                  onChange={function (event) {
                    updateIncludes(event.target.value)
                  }}
                />
              </FieldShell>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-muted-foreground text-[11px]">排除的文件</span>
              <FieldShell>
                <input
                  value={excludes}
                  placeholder="例如 dist, **/*.min.js"
                  aria-label="排除的文件"
                  className="text-foreground placeholder:text-muted-foreground h-6 min-w-0 flex-1 bg-transparent px-1 text-xs outline-none"
                  onChange={function (event) {
                    updateExcludes(event.target.value)
                  }}
                />
              </FieldShell>
            </label>
          </div>
        ) : null}

        {!isQueryValid ? (
          <p className="text-destructive px-1 text-[11px]">表达式无效</p>
        ) : (
          <p className="text-muted-foreground px-1 text-[11px]">
            {isSearching
              ? '搜索中…'
              : trimmed && isQueryValid
                ? `${groups.length} 个文件，${totalMatches} 个结果`
                : '\u00a0'}
          </p>
        )}

        {!workspaceRoot ? (
          <p className="text-muted-foreground px-1 text-xs">尚未打开文件夹</p>
        ) : trimmed && !isSearching && isQueryValid && hits.length === 0 ? (
          <p className="text-muted-foreground px-1 text-xs">没有匹配内容</p>
        ) : null}

        <SearchResults
          hits={isActive ? hits : []}
          query={searchQuery}
          isTruncated={isActive && isTruncated}
          collapseToken={collapseToken}
          onOpen={onOpenHit}
        />
      </div>

      <AlertDialog
        open={isConfirmOpen}
        onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>替换全部结果？</AlertDialogTitle>
            <AlertDialogDescription>
              将在 {groups.length} 个文件的 {totalMatches} 处内容中替换为「{replacement}
              」{isPreserveCase ? '（保留大小写）' : ''}，并直接写入磁盘。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={function () {
                void onConfirmReplace()
              }}>
              替换
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export { SearchSurface }
