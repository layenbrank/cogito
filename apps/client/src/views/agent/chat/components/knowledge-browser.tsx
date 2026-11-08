/**
 * 知识库浏览：composer 的「知识库」按钮与右栏「知识库」页签共用同一份实现。
 *
 * 一条文档就是磁盘上的一个 Markdown 文件（`<库根>/<relPath>`）。列表解决「找得到」：
 * 库切换、全文检索、新建 / 重扫 / 删除；点开一篇进入 {@link KnowledgeDocPane} 解决
 * 「看得见、改得动」：预览、编辑正文、再挂成引用交给 agent。
 *
 * 引用仍走与文件树、`@`、`+` 面板同一条通道（`attachWorkspaceFile`），不另造上下文注入：
 * 知识库文档本来就能被 agent 读，这里只负责把**引用路径**挂上去。
 */
import { Icon } from '@iconify/react/offline'
import type { useAui } from '@assistant-ui/react'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { Input } from '@cogito/design/components/input'
import { exists, mkdir } from '@tauri-apps/plugin-fs'
import { clsx } from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { attachWorkspaceFile } from '@/features/agent/attachment.ts'
import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { joinWorkspacePath, toAgentPath } from '@/features/agent/workspace/paths.ts'
import {
  insertBase,
  listBases,
  listDocs,
  rescanBase,
  searchDocs,
  writeDoc,
  type KnowledgeBase,
  type KnowledgeDocSummary,
  type KnowledgeHit
} from '@/lib/knowledge-ipc.ts'
import { useKnowledgeStore } from '@/stores/knowledge'
import {
  buildNewDocContent,
  buildNewDocRelative
} from '@/views/agent/chat/components/knowledge-doc.ts'
import { KnowledgeDocPane } from '@/views/agent/chat/components/knowledge-doc-pane.tsx'
import { findParentDir, joinPath } from '@/views/knowledge/lib/path.ts'

type ComposerAui = ReturnType<typeof useAui>

interface KnowledgeBrowserProps {
  aui: ComposerAui
  /** 面板可见时才去读库：popover 关着、页签没选中都不该发 IPC */
  active: boolean
  /** 引用成功后的回调（popover 用它收起面板） */
  onPicked?: () => void
  className?: string
}

/** 当前打开的那篇：检索命中里没有字数 / 时间，所以字段都可选 */
interface OpenDoc {
  baseId: string
  id: string
  title: string
  relPath: string
  wordCount?: number
  updatedAt?: number
  /** 列表里点「编辑」进来时直接落在编辑态 */
  editing: boolean
}

type CreateMode = 'doc' | 'base' | null

const KnowledgeBrowser = function KnowledgeBrowser(props: KnowledgeBrowserProps) {
  const navigate = useNavigate()
  const { primaryRootPath } = useActiveWorkspace()
  const [bases, updateBases] = useState<KnowledgeBase[]>([])
  const [baseID, updateBaseID] = useState<string | null>(null)
  const [docs, updateDocs] = useState<KnowledgeDocSummary[]>([])
  const [query, updateQuery] = useState('')
  const [hits, updateHits] = useState<KnowledgeHit[]>([])
  const [isSearching, updateSearching] = useState(false)
  const [isLoading, updateLoading] = useState(false)
  const [error, updateError] = useState<string | null>(null)
  /** 列表重拉信号：保存 / 删除 / 新建 / 重扫之后自增 */
  const [docsToken, updateDocsToken] = useState(0)

  const [open, updateOpen] = useState<OpenDoc | null>(null)
  const [createMode, updateCreateMode] = useState<CreateMode>(null)
  const [createName, updateCreateName] = useState('')
  const [isCreating, updateCreating] = useState(false)

  // 库列表：面板第一次打开时读一次（切会话 / 重挂载都会重新走这里）
  useEffect(
    function () {
      if (!props.active) return
      let cancelled = false
      async function load() {
        try {
          updateLoading(true)
          updateError(null)
          const rows = await listBases()
          if (cancelled) return
          updateBases(rows)
          updateBaseID(function (current) {
            if (current && rows.some((row) => row.id === current)) return current
            return rows[0]?.id ?? null
          })
        } catch (cause) {
          if (cancelled) return
          console.warn('[knowledge-browser] 读取知识库失败', cause)
          updateBases([])
          updateError(cause instanceof Error ? cause.message : '读取知识库失败')
        } finally {
          if (!cancelled) updateLoading(false)
        }
      }
      void load()
      return function () {
        cancelled = true
      }
    },
    [props.active]
  )

  // 文档列表：跟着当前库走
  useEffect(
    function () {
      // 库切没了就什么都不读：列表在渲染时按 baseID 兜空，不在这里 setState
      if (!props.active || !baseID) return
      const currentBaseID = baseID
      let cancelled = false
      async function load() {
        try {
          updateLoading(true)
          updateError(null)
          const rows = await listDocs(currentBaseID)
          if (!cancelled) updateDocs(rows)
        } catch (cause) {
          if (cancelled) return
          console.warn('[knowledge-browser] 读取文档失败', cause)
          updateDocs([])
          updateError(cause instanceof Error ? cause.message : '读取文档列表失败')
        } finally {
          if (!cancelled) updateLoading(false)
        }
      }
      void load()
      return function () {
        cancelled = true
      }
    },
    [props.active, baseID, docsToken]
  )

  /**
   * 全文检索：输入停 220ms 再打 IPC（本地 FTS，中文 1–2 字也能命中）。
   * 标题过滤交给服务端一起做，列表侧不再各留一套过滤规则。
   */
  useEffect(
    function () {
      const needle = query.trim()
      if (!props.active || !baseID || !needle) {
        updateHits([])
        updateSearching(false)
        return
      }
      let cancelled = false
      updateSearching(true)
      const timer = window.setTimeout(function () {
        void searchDocs(needle, baseID, 20)
          .then(function (rows) {
            if (!cancelled) updateHits(rows)
          })
          .catch(function (cause: unknown) {
            // 检索失败不该挡住列表：清掉命中，回到浏览态
            console.warn('[knowledge-browser] 检索失败', cause)
            if (!cancelled) updateHits([])
          })
          .finally(function () {
            if (!cancelled) updateSearching(false)
          })
      }, 220)
      return function () {
        cancelled = true
        window.clearTimeout(timer)
      }
    },
    [props.active, baseID, query]
  )

  const baseById = useMemo(
    function () {
      const map = new Map<string, KnowledgeBase>()
      for (const base of bases) map.set(base.id, base)
      return map
    },
    [bases]
  )
  const currentBase = baseID ? (baseById.get(baseID) ?? null) : null
  const isSearchMode = query.trim().length > 0
  const visible = baseID ? docs : []
  const openBase = open ? (baseById.get(open.baseId) ?? null) : null

  function refreshDocs() {
    updateDocsToken(function (value) {
      return value + 1
    })
  }

  function closeCreate() {
    updateCreateMode(null)
    updateCreateName('')
  }

  /**
   * 打开知识库整窗；给了库 + 库内路径就直达那篇。
   * 先记下目标：编辑器挂载前就能显示标题 / 骨架，随后 bootstrap 按 `?url=` 加载正文。
   */
  function openKnowledgeView(base: KnowledgeBase | null, relPath?: string) {
    if (!base || !relPath) {
      void navigate('/knowledge')
      return
    }
    const absolute = joinPath(base.rootPath, relPath)
    useKnowledgeStore.getState().toBeginOpen(absolute)
    void navigate(`/knowledge?url=${encodeURIComponent(absolute)}`)
  }

  function attach(target: { relPath: string; title: string }, base: KnowledgeBase) {
    // 库根可能不在工作区内：`toAgentPath` 对工作区外的路径原样给绝对路径
    const reference = toAgentPath(joinWorkspacePath(base.rootPath, target.relPath), primaryRootPath)
    void attachWorkspaceFile(props.aui, reference)
      .then(function () {
        toast.success(`已引用「${target.title}」`)
        props.onPicked?.()
      })
      .catch(function (cause: unknown) {
        console.warn('[knowledge-browser] 引用文档失败', cause)
        toast.error(cause instanceof Error ? cause.message : '引用失败')
      })
  }

  function attachCurrent() {
    if (!open || !openBase) return
    attach(open, openBase)
  }

  /** 列表行 / 命中行的引用：按文档自己的库拼路径，不假设它属于当前库 */
  function attachDoc(doc: KnowledgeDocSummary) {
    const base = baseById.get(doc.baseId)
    if (!base) {
      toast.error('这份文档所属的知识库已不在列表里')
      return
    }
    attach(doc, base)
  }

  function openDoc(doc: KnowledgeDocSummary, editing = false) {
    updateOpen({
      baseId: doc.baseId,
      id: doc.id,
      title: doc.title,
      relPath: doc.relPath,
      wordCount: doc.wordCount,
      updatedAt: doc.updatedAt,
      editing
    })
  }

  function openHit(hit: KnowledgeHit) {
    if (!baseID) return
    updateOpen({
      baseId: baseID,
      id: hit.docId,
      title: hit.title,
      relPath: hit.relPath,
      editing: false
    })
  }

  /** 新建文档：先落盘 + 落库，成功后直接进编辑态（空文件预览没有意义） */
  async function createDoc() {
    const title = createName.trim()
    if (!title || !currentBase) return
    updateCreating(true)
    try {
      const absolute = await findFreeDocPath(currentBase.rootPath, title)
      const outcome = await writeDoc({
        path: absolute,
        content: buildNewDocContent(title),
        force: true
      })
      const doc = outcome.doc
      if (!doc) throw new Error('新文档没有写进知识库')
      closeCreate()
      refreshDocs()
      updateOpen({
        baseId: doc.baseId,
        id: doc.id,
        title: doc.title,
        relPath: doc.relPath,
        wordCount: doc.wordCount,
        updatedAt: doc.updatedAt,
        editing: true
      })
      toast.success(`已新建「${doc.title}」`)
    } catch (cause) {
      console.warn('[knowledge-browser] 新建文档失败', cause)
      toast.error(cause instanceof Error ? cause.message : '新建文档失败')
    } finally {
      updateCreating(false)
    }
  }

  /** 新建知识库：后端自己定库根，建完立刻切过去 */
  async function createBase() {
    const name = createName.trim()
    if (!name) return
    updateCreating(true)
    try {
      const base = await insertBase(name)
      closeCreate()
      updateBases(function (current) {
        return current.some((row) => row.id === base.id) ? current : [...current, base]
      })
      updateBaseID(base.id)
      toast.success(`已新建知识库「${base.name}」`)
    } catch (cause) {
      console.warn('[knowledge-browser] 新建知识库失败', cause)
      toast.error(cause instanceof Error ? cause.message : '新建知识库失败')
    } finally {
      updateCreating(false)
    }
  }

  /** 重扫：磁盘上被别处加进来 / 改过的文件重新入库 */
  function rescan() {
    if (!baseID) return
    void rescanBase(baseID)
      .then(function (count) {
        refreshDocs()
        toast.success(`已重新扫描，更新 ${count} 篇`)
      })
      .catch(function (cause: unknown) {
        console.warn('[knowledge-browser] 重扫失败', cause)
        toast.error(cause instanceof Error ? cause.message : '重扫失败')
      })
  }

  function submitCreate() {
    if (isCreating) return
    if (createMode === 'doc') {
      void createDoc()
      return
    }
    if (createMode === 'base') {
      void createBase()
    }
  }

  if (open && openBase) {
    return (
      <div className={clsx('flex min-h-0 flex-1 flex-col', props.className)}>
        <KnowledgeDocPane
          key={`${open.baseId}:${open.relPath}`}
          base={openBase}
          doc={{ id: open.id, title: open.title, relPath: open.relPath }}
          initialEditing={open.editing}
          wordCount={open.wordCount}
          updatedAt={open.updatedAt}
          onBack={function () {
            updateOpen(null)
          }}
          onAttach={attachCurrent}
          onOpenInKnowledge={function () {
            openKnowledgeView(openBase, open.relPath)
          }}
          onSaved={function (doc) {
            updateOpen(function (current) {
              if (!current) return current
              return { ...current, title: doc.title, relPath: doc.relPath }
            })
            refreshDocs()
          }}
          onDeleted={function () {
            updateOpen(null)
            refreshDocs()
          }}
        />
      </div>
    )
  }

  return (
    <div className={clsx('flex min-h-0 flex-1 flex-col', props.className)}>
      {bases.length > 1 ? (
        <div className="border-border/60 flex shrink-0 gap-1 overflow-x-auto border-b p-1.5">
          {bases.map(function (base) {
            const isActive = base.id === baseID
            return (
              <Button
                key={base.id}
                type="button"
                variant="ghost"
                className={clsx(
                  'h-6 shrink-0 rounded-md px-2 text-xs font-normal',
                  isActive ? 'bg-muted font-medium' : 'text-muted-foreground'
                )}
                onClick={function () {
                  updateBaseID(base.id)
                }}>
                {base.name}
              </Button>
            )
          })}
        </div>
      ) : null}

      <div className="border-border/60 flex shrink-0 items-center gap-1 border-b p-1.5">
        <Input
          value={query}
          placeholder="全文检索文档"
          aria-label="检索知识库文档"
          title="全文检索；1–2 字中文也能命中"
          className="h-7 flex-1 text-xs"
          onChange={function (event) {
            updateQuery(event.target.value)
          }}
        />
        {query ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="清除检索"
            title="清除检索"
            className="size-7 shrink-0"
            onClick={function () {
              updateQuery('')
            }}>
            <Icon
              icon="lucide:x"
              className="size-3.5"
            />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="新建文档"
          title="新建文档"
          className="size-7 shrink-0"
          disabled={!baseID}
          onClick={function () {
            updateCreateMode('doc')
            updateCreateName('')
          }}>
          <Icon
            icon="lucide:file-plus"
            className="size-3.5"
          />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="知识库操作"
                title="知识库操作"
                className="size-7 shrink-0"
              />
            }>
            <Icon
              icon="lucide:ellipsis"
              className="size-3.5"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-36">
            <DropdownMenuItem
              onClick={function () {
                updateCreateMode('base')
                updateCreateName('')
              }}>
              <Icon
                icon="lucide:library-big"
                className="size-3.5"
              />
              新建知识库
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!baseID}
              onClick={rescan}>
              <Icon
                icon="lucide:refresh-cw"
                className="size-3.5"
              />
              重扫当前库
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!baseID}
              onClick={function () {
                openKnowledgeView(currentBase)
              }}>
              <Icon
                icon="lucide:external-link"
                className="size-3.5"
              />
              在知识库中打开
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {createMode ? (
        <div className="border-border/60 flex shrink-0 items-center gap-1 border-b p-1.5">
          <Input
            autoFocus
            value={createName}
            aria-label={createMode === 'doc' ? '新文档标题' : '新知识库名称'}
            placeholder={createMode === 'doc' ? '新文档标题，回车创建' : '新知识库名称，回车创建'}
            className="h-7 flex-1 text-xs"
            onChange={function (event) {
              updateCreateName(event.target.value)
            }}
            onKeyDown={function (event) {
              if (event.key === 'Escape') {
                closeCreate()
                return
              }
              if (event.key !== 'Enter') return
              submitCreate()
            }}
          />
          <Button
            type="button"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={!createName.trim() || isCreating}
            onClick={submitCreate}>
            {isCreating ? '创建中…' : '创建'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="取消"
            title="取消"
            className="size-7"
            onClick={closeCreate}>
            <Icon
              icon="lucide:x"
              className="size-3.5"
            />
          </Button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {(isLoading || isSearching) && visible.length === 0 ? (
          <p className="text-muted-foreground flex items-center gap-1.5 p-2.5 text-xs">
            <Icon
              icon="lucide:loader-circle"
              className="size-3.5 animate-spin"
            />
            {isSearching ? '检索中…' : '读取中…'}
          </p>
        ) : null}

        {error && !isLoading ? (
          <p className="text-muted-foreground p-2.5 text-xs">{error}</p>
        ) : null}

        {isSearchMode ? (
          <>
            {hits.length > 0 ? (
              <p className="text-muted-foreground px-2 py-1 text-[11px]">命中 {hits.length} 篇</p>
            ) : null}
            {hits.map(function (hit) {
              return (
                <Button
                  key={hit.docId}
                  type="button"
                  variant="ghost"
                  className="hover:bg-muted/60 h-auto w-full flex-col items-stretch justify-start gap-0.5 rounded-md px-2 py-1.5 text-start whitespace-normal"
                  title={hit.relPath}
                  onClick={function () {
                    openHit(hit)
                  }}>
                  <span className="flex w-full min-w-0 items-center gap-2">
                    <Icon
                      icon="lucide:file-text"
                      className="text-muted-foreground size-3.5 shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{hit.title}</span>
                  </span>
                  <span className="text-muted-foreground w-full truncate text-start text-[11px]">
                    {hit.snippet || hit.relPath}
                  </span>
                </Button>
              )
            })}
          </>
        ) : (
          visible.map(function (doc) {
            return (
              <div
                key={doc.id}
                className="group hover:bg-muted/60 flex items-center gap-0.5 rounded-md">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto min-w-0 flex-1 items-start justify-start gap-2 px-2 py-1.5 text-xs font-normal hover:bg-transparent"
                  title={doc.relPath}
                  onClick={function () {
                    openDoc(doc)
                  }}>
                  <Icon
                    icon="lucide:file-text"
                    className="text-muted-foreground mt-0.5 size-3.5 shrink-0"
                  />
                  <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                    <span className="w-full truncate text-start">{doc.title}</span>
                    <span className="text-muted-foreground w-full truncate text-start text-[11px]">
                      {doc.relPath}
                      {doc.wordCount > 0 ? ` · ${doc.wordCount} 字` : ''}
                    </span>
                  </span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`引用「${doc.title}」`}
                  title="引用到对话"
                  className="size-6 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                  onClick={function () {
                    attachDoc(doc)
                  }}>
                  <Icon
                    icon="lucide:message-square-plus"
                    className="size-3.5"
                  />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`「${doc.title}」的更多操作`}
                        title="更多操作"
                        className="size-6 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                      />
                    }>
                    <Icon
                      icon="lucide:ellipsis"
                      className="size-3.5"
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="min-w-36">
                    <DropdownMenuItem
                      onClick={function () {
                        openDoc(doc)
                      }}>
                      <Icon
                        icon="lucide:eye"
                        className="size-3.5"
                      />
                      预览
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={function () {
                        openDoc(doc, true)
                      }}>
                      <Icon
                        icon="lucide:pencil"
                        className="size-3.5"
                      />
                      编辑正文
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={function () {
                        const base = baseById.get(doc.baseId)
                        if (!base) {
                          toast.error('这份文档所属的知识库已不在列表里')
                          return
                        }
                        openKnowledgeView(base, doc.relPath)
                      }}>
                      <Icon
                        icon="lucide:external-link"
                        className="size-3.5"
                      />
                      在知识库中打开
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )
          })
        )}

        {!isLoading && !error && !isSearchMode && visible.length === 0 ? (
          <p className="text-muted-foreground p-2.5 text-xs">
            {bases.length === 0 ? '还没有知识库：用上方「⋯」新建一个' : '这个库还没有文档'}
          </p>
        ) : null}

        {!isLoading && isSearchMode && hits.length === 0 && !isSearching ? (
          <p className="text-muted-foreground p-2.5 text-xs">没有匹配的文档</p>
        ) : null}
      </div>

      <div className="border-border/60 flex shrink-0 items-center justify-between gap-2 border-t px-2.5 py-1.5">
        <span className="text-muted-foreground truncate text-xs">
          {currentBase ? `${currentBase.name} · ${visible.length} 篇` : '未选择知识库'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground h-6 gap-1 px-1.5 text-xs"
          onClick={function () {
            openKnowledgeView(currentBase)
          }}>
          <Icon
            icon="lucide:library"
            className="size-3.5"
          />
          打开知识库
        </Button>
      </div>
    </div>
  )
}

/**
 * 新文档落点：同名文件已存在时顺延 `-2`、`-3`…，绝不覆盖别人已有正文。
 * `exists` 只看文件在不在；父目录由调用方建（见 createDoc）。
 */
async function findFreeDocPath(rootPath: string, title: string): Promise<string> {
  // 库目录被删 / 盘没挂上：不要凭空 mkdir 出一个空库，直接让用户去检查设置
  if (!(await exists(rootPath))) {
    throw new Error('知识库目录不存在，请先在知识库里检查库设置')
  }
  for (let index = 1; index < 100; index += 1) {
    const absolute = joinPath(rootPath, buildNewDocRelative(title, index))
    if (await exists(absolute)) continue
    const parent = findParentDir(absolute)
    if (parent) await mkdir(parent, { recursive: true })
    return absolute
  }
  throw new Error('同名文档太多了，换个标题再建')
}

export { KnowledgeBrowser }
export type { KnowledgeBrowserProps }
