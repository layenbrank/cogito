/**
 * 侧栏搜索面板：工作区内容检索 + 批量替换。
 *
 * 检索走 Rust（能套 git 索引），替换走前端同一份正则，两者共用一套开关。
 */
import { Icon } from '@iconify/react/offline'
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
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { WorkspaceFiles, type ContentHit } from '@/lib/workspace-files'
import { cn } from 'cn'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useCodeStore } from '@/stores/code'
import { revealLocation } from '@/views/code/lib/open-file.ts'
import { isValidQuery, type SearchQuery } from '@/views/code/lib/search-query.ts'
import { replaceInFiles } from '@/views/code/lib/search.ts'
import { SearchResults, groupHits } from '@/views/code/workspace/search/results.tsx'

const SEARCH_DELAY_MS = 300

/** 三个开关共用一个按钮样式 */
function ToggleButton(props: {
  icon: string
  label: string
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      aria-pressed={props.isActive}
      title={props.label}
      className={cn(
        'flex size-6 items-center justify-center rounded-sm border border-transparent',
        props.isActive
          ? 'bg-primary/15 text-primary border-primary/30'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
      onClick={props.onClick}>
      <Icon
        icon={props.icon}
        className="size-3.5"
      />
    </button>
  )
}

function SearchPanel() {
  const workspaceRoot = useCodeStore(function (state) {
    return state.workspaceRoot
  })
  const [query, updateQuery] = useState('')
  const [isCaseSensitive, setCaseSensitive] = useState(false)
  const [isWholeWord, setWholeWord] = useState(false)
  const [isRegex, setRegex] = useState(false)
  const [isReplaceOpen, setReplaceOpen] = useState(false)
  const [replacement, updateReplacement] = useState('')
  const [hits, updateHits] = useState<ContentHit[]>([])
  const [isTruncated, setTruncated] = useState(false)
  const [isSearching, setSearching] = useState(false)
  const [isConfirmOpen, setConfirmOpen] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)

  const searchQuery: SearchQuery = useMemo(
    function () {
      return { query, isRegex, isCaseSensitive, isWholeWord }
    },
    [query, isRegex, isCaseSensitive, isWholeWord]
  )
  const isQueryValid = isValidQuery(searchQuery)
  const trimmed = query.trim()
  // 输入被清空或表达式无效时不再展示旧结果，也不必在 effect 里清 state
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
          isWholeWord
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
    [workspaceRoot, trimmed, isRegex, isCaseSensitive, isWholeWord, isQueryValid, refreshToken]
  )

  function onOpenHit(hit: ContentHit) {
    void revealLocation(hit.path, hit.line, hit.column)
  }

  async function onConfirmReplace() {
    setConfirmOpen(false)
    try {
      const outcome = await replaceInFiles({
        paths: groups.map(function (group) {
          return group.path
        }),
        query: searchQuery,
        replacement
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
      setRefreshToken(function (value) {
        return value + 1
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '替换失败')
    }
  }

  const totalMatches = isActive ? hits.length : 0
  const canReplace = totalMatches > 0 && replacement.length > 0

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex items-center gap-1">
        <Input
          value={query}
          placeholder={isRegex ? '输入正则表达式' : '输入要在文件中查找的内容'}
          aria-label="在工作区中查找"
          className={cn('h-8', !isQueryValid && 'border-destructive')}
          onChange={function (event) {
            updateQuery(event.target.value)
          }}
          onKeyDown={function (event) {
            if (event.key === 'Enter') {
              setRefreshToken(function (value) {
                return value + 1
              })
            }
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={isReplaceOpen ? '收起替换' : '展开替换'}
          aria-pressed={isReplaceOpen}
          title="替换"
          className={cn('size-6 shrink-0', isReplaceOpen && 'bg-muted text-foreground')}
          onClick={function () {
            setReplaceOpen(!isReplaceOpen)
          }}>
          <Icon
            icon="lucide:replace"
            className="size-3.5"
          />
        </Button>
      </div>

      <div className="flex items-center gap-1">
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
        <span className="text-muted-foreground ml-auto text-[11px]">
          {isSearching
            ? '搜索中…'
            : trimmed && isQueryValid
              ? `${groups.length} 个文件 ${totalMatches} 处`
              : ''}
        </span>
      </div>

      {!isQueryValid ? (
        <p className="text-destructive px-1 text-[11px]">表达式无效</p>
      ) : null}

      {isReplaceOpen ? (
        <div className="flex items-center gap-1">
          <Input
            value={replacement}
            placeholder="替换为"
            aria-label="替换为"
            className="h-8"
            onChange={function (event) {
              updateReplacement(event.target.value)
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0 text-xs"
            disabled={!canReplace}
            onClick={function () {
              setConfirmOpen(true)
            }}>
            全部替换
          </Button>
        </div>
      ) : null}

      {!workspaceRoot ? (
        <p className="text-muted-foreground px-1 text-xs">尚未打开文件夹</p>
      ) : trimmed && !isSearching && isQueryValid && hits.length === 0 ? (
        <p className="text-muted-foreground px-1 text-xs">没有匹配内容</p>
      ) : null}

      <SearchResults
        hits={isActive ? hits : []}
        query={searchQuery}
        isTruncated={isActive && isTruncated}
        onOpen={onOpenHit}
      />

      <AlertDialog
        open={isConfirmOpen}
        onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>替换全部结果？</AlertDialogTitle>
            <AlertDialogDescription>
              将在 {groups.length} 个文件的 {totalMatches} 处内容中替换为「{replacement}
              」，并直接写入磁盘。
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

export { SearchPanel }
