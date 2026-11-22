import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { clsx } from 'clsx'
import { useEffect, useState } from 'react'

import {
  countBookmarkLinks,
  fetchBookmarkTree,
  filterBookmarkTree,
  type BookmarkNode
} from '@/features/bookmarks/tree.ts'
import { insertNavigation, type InsertResult } from '@/features/mirror/insert.ts'
import { useMirrorStore } from '@/features/mirror/store.ts'
import { parseSiteUrl } from '@/features/mirror/url.ts'
import { findSiteMark } from '@/features/magnetic-tile/mark.ts'
import { notify } from '@/features/shell/notice-state.ts'
import { openSite } from '@/features/shell/open-site.ts'
import { ReturnBar } from '@/features/shell/return-bar.tsx'

type Status = 'loading' | 'ready' | 'error'

const PAGE_SIZE = 80

const RESULT_TEXT: Record<InsertResult, string> = {
  added: '已加到镜像',
  duplicate: '镜像里已经有这个链接',
  missing: '还没有镜像，稍后再试'
}

/** 浏览器书签树：文件夹默认收起，链接可以另开标签或加到镜像 */
export default function Bookmarks() {
  const tiles = useMirrorStore(function (state) {
    return state.tiles
  })
  const initialize = useMirrorStore(function (state) {
    return state.initialize
  })
  const [nodes, updateNodes] = useState<BookmarkNode[]>([])
  const [keyword, updateKeyword] = useState('')
  const [status, updateStatus] = useState<Status>('loading')

  useEffect(function () {
    initialize()
  }, [initialize])

  useEffect(function () {
    void fetchBookmarkTree()
      .then(function (tree) {
        updateNodes(tree)
        updateStatus('ready')
      })
      .catch(function (error: unknown) {
        console.error('[bookmark] 读取书签失败', error)
        updateStatus('error')
      })
  }, [])

  const visible = filterBookmarkTree(nodes, keyword)
  const mounted = new Set(
    tiles.flatMap(function (tile) {
      if (!tile.url) return []
      return [parseSiteUrl(tile.url) ?? tile.url]
    })
  )

  async function mount(node: BookmarkNode): Promise<void> {
    if (!node.url) return

    try {
      const result = await insertNavigation(
        {
          title: node.title || node.url,
          url: node.url,
          size: 2,
          shape: 'square',
          direction: 'horizontal'
        },
        { skipSameUrl: true }
      )
      notify(RESULT_TEXT[result])
    } catch (error) {
      console.error('[bookmark] 加到镜像失败', error)
      notify('没有加到镜像')
    }
  }

  return (
    <div className={clsx('flex h-full min-h-0 flex-col gap-3 overflow-hidden bg-background/80 p-6')}>
      <ReturnBar title="书签库" />
      <Input
        value={keyword}
        placeholder="搜索书签"
        aria-label="搜索书签"
        onChange={function (event) {
          updateKeyword(event.target.value)
        }}
      />

      {status === 'error' ? (
        <p className={clsx('text-sm text-destructive')}>书签读取失败，请在扩展详情里允许「书签」权限后重试。</p>
      ) : null}
      {status === 'loading' ? <p className={clsx('text-sm text-muted-foreground')}>正在读取书签…</p> : null}

      <div className={clsx('min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-1')}>
        {visible.map(function (node) {
          return (
            <BookmarkBranch
              key={node.id}
              node={node}
              depth={0}
              forceOpen={Boolean(keyword.trim())}
              mounted={mounted}
              onMount={function (item) {
                void mount(item)
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

function BookmarkBranch(props: {
  node: BookmarkNode
  depth: number
  forceOpen: boolean
  mounted: Set<string>
  onMount: (node: BookmarkNode) => void
}) {
  const node = props.node
  const [isOpen, updateOpen] = useState(false)
  const [shown, updateShown] = useState(PAGE_SIZE)
  const expanded = props.forceOpen || !node.title || isOpen

  if (node.url) {
    const mark = findSiteMark(node.url)
    const isMounted = props.mounted.has(parseSiteUrl(node.url) ?? node.url)

    return (
      <div
        className={clsx('flex items-center gap-2 py-1')}
        style={{ paddingLeft: props.depth * 12 }}>
        {mark ? (
          <img
            src={mark}
            alt=""
            className={clsx('size-4 shrink-0')}
          />
        ) : null}
        <button
          type="button"
          className={clsx('min-w-0 flex-1 truncate text-left text-sm text-foreground')}
          onClick={function () {
            if (node.url) openSite(node.url, 'tab')
          }}>
          {node.title || node.url}
        </button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={isMounted}
          onClick={function () {
            props.onMount(node)
          }}>
          {isMounted ? '已在镜像' : '加到镜像'}
        </Button>
      </div>
    )
  }

  const children = node.children ?? []
  const visibleChildren = expanded ? children.slice(0, shown) : []

  return (
    <section style={{ paddingLeft: props.depth ? 12 : 0 }}>
      {node.title ? (
        <button
          type="button"
          className={clsx('flex w-full items-center gap-2 py-2 text-left text-sm font-medium')}
          aria-expanded={expanded}
          onClick={function () {
            updateOpen(function (current) {
              return !current
            })
          }}>
          <span className={clsx('text-muted-foreground')}>{expanded ? '▾' : '▸'}</span>
          <span className={clsx('truncate')}>{node.title}</span>
          <span className={clsx('text-xs text-muted-foreground')}>{countBookmarkLinks(node)}</span>
        </button>
      ) : null}
      {visibleChildren.map(function (child) {
        return (
          <BookmarkBranch
            key={child.id}
            node={child}
            depth={props.depth + (node.title ? 1 : 0)}
            forceOpen={props.forceOpen}
            mounted={props.mounted}
            onMount={props.onMount}
          />
        )
      })}
      {expanded && children.length > shown ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={function () {
            updateShown(function (current) {
              return current + PAGE_SIZE
            })
          }}>
          还有 {children.length - shown} 项
        </Button>
      ) : null}
    </section>
  )
}
