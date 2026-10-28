/**
 * 左面板 · 文档页：库切换 / 检索 / 文档列表（含云端角标）/ 库级动作。
 *
 * 这里只列「库里的文档」；磁盘上的文件夹树仍在编辑器侧栏（那里能新建/重命名/删除）。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { Input } from '@cogito/design/components/input'
import { ScrollArea } from '@cogito/design/components/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Spinner } from '@cogito/design/components/spinner'
import { useState } from 'react'

import { useDockStore } from '@/features/agent/dock'
import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { useDictStore } from '@/stores/dict'
import { useKnowledgeStore } from '@/stores/knowledge'
import { DICT_TYPE, DICT_VALUE } from '@/shared/ipc/specs/dict'
import { formatTime } from '@/views/knowledge/lib/format.ts'
import { isPathInsideRoot, isSamePath } from '@/views/knowledge/lib/path.ts'
import { openPath } from '@/views/knowledge/lib/session.ts'

/** 云端角标样式按 value；文案走字典 label */
const CLOUD_BADGE_CLASS: Record<string, string> = {
  [DICT_VALUE.KNOWLEDGE_CLOUD_STATUS.PENDING]: 'text-muted-foreground',
  [DICT_VALUE.KNOWLEDGE_CLOUD_STATUS.RUNNING]:
    'text-amber-700 dark:text-amber-400',
  [DICT_VALUE.KNOWLEDGE_CLOUD_STATUS.SUCCEEDED]:
    'text-emerald-700 dark:text-emerald-400',
  [DICT_VALUE.KNOWLEDGE_CLOUD_STATUS.FAILED]: 'text-destructive'
}

function joinPath(root: string, relative: string): string {
  const base = root.replace(/[\\/]+$/, '')
  return `${base}/${relative.replace(/^[\\/]+/, '')}`
}

function DocsTab() {
  const bases = useKnowledgeBaseStore(function (state) {
    return state.bases
  })
  const activeBaseID = useKnowledgeBaseStore(function (state) {
    return state.activeBaseID
  })
  const docs = useKnowledgeBaseStore(function (state) {
    return state.docs
  })
  const hits = useKnowledgeBaseStore(function (state) {
    return state.hits
  })
  const counts = useKnowledgeBaseStore(function (state) {
    return state.counts
  })
  const cloudState = useKnowledgeBaseStore(function (state) {
    return state.cloudState
  })
  const cloudStates = useKnowledgeBaseStore(function (state) {
    return state.cloudStates
  })
  const query = useKnowledgeBaseStore(function (state) {
    return state.query
  })
  const isLoading = useKnowledgeBaseStore(function (state) {
    return state.isLoading
  })
  const isSyncingCloud = useKnowledgeBaseStore(function (state) {
    return state.isSyncingCloud
  })
  const error = useKnowledgeBaseStore(function (state) {
    return state.error
  })
  const selectBase = useKnowledgeBaseStore(function (state) {
    return state.selectBase
  })
  const setQuery = useKnowledgeBaseStore(function (state) {
    return state.setQuery
  })
  const runSearch = useKnowledgeBaseStore(function (state) {
    return state.runSearch
  })
  const clearSearch = useKnowledgeBaseStore(function (state) {
    return state.clearSearch
  })
  const create = useKnowledgeBaseStore(function (state) {
    return state.create
  })
  const rescan = useKnowledgeBaseStore(function (state) {
    return state.rescan
  })
  const syncCloud = useKnowledgeBaseStore(function (state) {
    return state.syncCloud
  })
  const exportBundle = useKnowledgeBaseStore(function (state) {
    return state.exportBundle
  })
  const findLabel = useDictStore(function (state) {
    return state.findLabel
  })

  const [newName, setNewName] = useState('')
  const [isCreating, toSetCreating] = useState(false)

  const activeBase = bases.find(function (base) {
    return base.id === activeBaseID
  })

  async function openDoc(relative: string) {
    if (!activeBase) return
    const absolute = joinPath(activeBase.rootPath, relative)
    const workspace = useKnowledgeStore.getState()
    // 当前工作区已覆盖该文件：只打开。否则对齐到该库并落盘，避免冲掉用户文件夹时误改根。
    const isInsideWorkspace =
      Boolean(workspace.rootDir) && isPathInsideRoot(workspace.rootDir!, absolute)
    if (!isInsideWorkspace && !isSamePath(workspace.rootDir, activeBase.rootPath)) {
      workspace.toSetRootDir(activeBase.rootPath, { persist: true })
      workspace.toBumpTree()
    }
    await openPath(absolute)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-1">
        <Select
          value={activeBaseID ?? undefined}
          onValueChange={function (value) {
            if (typeof value === 'string') void selectBase(value)
          }}>
          <SelectTrigger
            size="sm"
            className="min-w-0 flex-1">
            <SelectValue placeholder="选择知识库" />
          </SelectTrigger>
          <SelectContent>
            {bases.map(function (base) {
              return (
                <SelectItem
                  key={base.id}
                  value={base.id}>
                  {base.name}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="ghost"
          title="新建知识库"
          onClick={function () {
            toSetCreating(!isCreating)
          }}>
          <Icon
            icon="lucide:plus"
            className="size-3.5"
          />
        </Button>
      </div>

      {isCreating ? (
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            value={newName}
            placeholder="知识库名称"
            className="h-7 text-xs"
            onChange={function (event) {
              setNewName(event.target.value)
            }}
            onKeyDown={function (event) {
              if (event.key !== 'Enter' || !newName.trim()) return
              void create(newName.trim()).then(function (ok) {
                if (ok) {
                  setNewName('')
                  toSetCreating(false)
                }
              })
            }}
          />
          <Button
            size="sm"
            disabled={!newName.trim()}
            onClick={function () {
              void create(newName.trim()).then(function (ok) {
                if (ok) {
                  setNewName('')
                  toSetCreating(false)
                }
              })
            }}>
            建
          </Button>
        </div>
      ) : null}

      <form
        className="flex items-center gap-1"
        onSubmit={function (event) {
          event.preventDefault()
          void runSearch()
        }}>
        <Input
          value={query}
          placeholder="检索（1–2 字也能命中）"
          className="h-7 text-xs"
          onChange={function (event) {
            setQuery(event.target.value)
          }}
        />
        {hits.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={clearSearch}>
            清除
          </Button>
        ) : null}
      </form>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 gap-1 px-1.5 text-[11px] font-normal"
          title="让助手按主题写一篇新文档"
          onClick={function () {
            useDockStore.getState().toOpen('new-doc')
          }}>
          <Icon
            icon="lucide:sparkles"
            className="size-3"
          />
          生成
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 px-0"
                title="库操作"
              />
            }>
            <Icon
              icon="lucide:ellipsis"
              className="size-3.5"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-32">
            <DropdownMenuItem
              disabled={isSyncingCloud || !activeBase || docs.length === 0}
              onClick={function () {
                void syncCloud()
              }}>
              <Icon
                icon="lucide:cloud-upload"
                className="size-3.5"
              />
              上云
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={isLoading || !activeBaseID}
              onClick={function () {
                void rescan()
              }}>
              <Icon
                icon="lucide:refresh-cw"
                className="size-3.5"
              />
              重扫
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!activeBase || docs.length === 0}
              onClick={function () {
                void exportBundle()
              }}>
              <Icon
                icon="lucide:archive"
                className="size-3.5"
              />
              导出
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {isLoading ? <Spinner className="ml-auto size-3" /> : null}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {hits.length > 0 ? (
          <ul className="mb-2 flex flex-col gap-0.5">
            <li className="px-1 text-[11px] text-muted-foreground">
              命中 {hits.length}
              {counts.cloud > 0 ? `（本地 ${counts.local} · 云端 ${counts.cloud}）` : ''}
              {cloudState === 'unavailable' ? ' · 云端暂不可用' : ''}
            </li>
            {hits.map(function (hit) {
              return (
                <li key={hit.docId}>
                  <button
                    type="button"
                    className="w-full rounded-md px-1.5 py-1 text-left hover:bg-muted"
                    onClick={function () {
                      void openDoc(hit.relPath)
                    }}>
                    <span className="block truncate text-xs">{hit.title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {hit.snippet}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}

        <p className="px-1 pb-1 text-[11px] text-muted-foreground">文档 {docs.length}</p>
        {docs.length === 0 && !isLoading ? (
          <p className="px-1 py-2 text-[11px] text-muted-foreground">
            还没有文档。点「生成」让助手写，或在编辑器里新建后保存到库目录。
          </p>
        ) : null}
        <ul className="flex flex-col gap-0.5">
          {docs.map(function (doc) {
            const cloudStatus = cloudStates[doc.id]?.status ?? ''
            const badgeClass = CLOUD_BADGE_CLASS[cloudStatus]
            const badgeLabel = badgeClass
              ? findLabel(DICT_TYPE.KNOWLEDGE_CLOUD_STATUS, cloudStatus)
              : null
            return (
              <li key={doc.id}>
                <button
                  type="button"
                  className="w-full rounded-md px-1.5 py-1 text-left hover:bg-muted"
                  onClick={function () {
                    void openDoc(doc.relPath)
                  }}>
                  <span className="flex items-center gap-1">
                    <span className="truncate text-xs">{doc.title}</span>
                    {badgeLabel ? (
                      <span
                        className={`shrink-0 text-[10px] ${badgeClass}`}
                        title={cloudStates[doc.id]?.error ?? undefined}>
                        {badgeLabel}
                      </span>
                    ) : null}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {doc.relPath} · {doc.wordCount} 字 · {formatTime(doc.updatedAt)}
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

export { DocsTab }
