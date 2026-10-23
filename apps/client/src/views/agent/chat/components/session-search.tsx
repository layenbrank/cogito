/**
 * Qoder 式会话搜索弹框：无边框 Input + 键盘导航 + 结果列表
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '@cogito/design/components/dialog'
import { Input } from '@cogito/design/components/input'
import { clsx } from 'clsx'
import dayjs from 'dayjs'
import { throttle } from 'lodash-es'
import { useEffect, useMemo, useRef, useState } from 'react'

import styles from './session-search.module.scss'
import { useAgentStore, type Session, type Workspace } from '@/stores/agent.ts'

interface SessionSearchHit {
  session: Session
  workspaceTitle: string
  pathHint: string
}

interface SessionSearchProps {
  open: boolean
  onClose: () => void
  onSelect: (session: Session) => void
}

const NAVIGATE_THROTTLE_MS = 80

function truncatePath(path: string, max = 28) {
  if (path.length <= max) return path
  return path.slice(0, max - 1) + '…'
}

function SessionSearch(props: SessionSearchProps) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={function (open) {
        if (!open) props.onClose()
      }}>
      {props.open ? (
        <SessionSearchPanel
          onClose={props.onClose}
          onSelect={props.onSelect}
        />
      ) : null}
    </Dialog>
  )
}

function SessionSearchPanel(props: Pick<SessionSearchProps, 'onClose' | 'onSelect'>) {
  const sessions = useAgentStore(function (state) {
    return state.sessions
  })
  const workspaces = useAgentStore(function (state) {
    return state.workspaces
  })
  const workspaceFolders = useAgentStore(function (state) {
    return state.workspaceFolders
  })

  const [keyword, updateKeyword] = useState('')
  const [navigation, updateNavigation] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const hitsLengthRef = useRef(0)

  const workspaceByID = useMemo(
    function () {
      const map = new Map<string, Workspace>()
      workspaces.forEach(function (workspace) {
        map.set(workspace.id, workspace)
      })
      return map
    },
    [workspaces]
  )

  const primaryPathByWorkspace = useMemo(
    function () {
      const map = new Map<string, string>()
      workspaceFolders.forEach(function (folder) {
        const current = map.get(folder.workspaceID)
        if (!current || folder.isPrimary) {
          map.set(folder.workspaceID, folder.path)
        }
      })
      return map
    },
    [workspaceFolders]
  )

  const hits: SessionSearchHit[] = useMemo(
    function () {
      const lower = keyword.trim().toLowerCase()
      const filtered = sessions
        .filter(function (session) {
          if (!lower) return true
          return session.title.toLowerCase().includes(lower)
        })
        .toSorted(function (a, b) {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
          return b.updatedAt - a.updatedAt
        })

      return filtered.map(function (session) {
        const workspace = session.workspaceID ? workspaceByID.get(session.workspaceID) : undefined
        const path = session.workspaceID
          ? primaryPathByWorkspace.get(session.workspaceID)
          : undefined
        const workspaceTitle = workspace?.title || '未分组'
        const pathHint = path
          ? `${workspaceTitle} · 本地 · ${truncatePath(path)}`
          : `${workspaceTitle} · 本地`
        return { session, workspaceTitle, pathHint }
      })
    },
    [sessions, keyword, workspaceByID, primaryPathByWorkspace]
  )

  useEffect(
    function () {
      hitsLengthRef.current = hits.length
    },
    [hits.length]
  )

  useEffect(
    function () {
      queueMicrotask(function () {
        inputRef.current?.select()
      })
    },
    []
  )

  const navigatePrev = useMemo(function () {
    return throttle(
      function () {
        updateNavigation(function (index) {
          const length = hitsLengthRef.current
          if (length <= 0) return 0
          return index <= 0 ? length - 1 : index - 1
        })
      },
      NAVIGATE_THROTTLE_MS,
      { leading: true, trailing: false }
    )
  }, [])

  const navigateNext = useMemo(function () {
    return throttle(
      function () {
        updateNavigation(function (index) {
          const length = hitsLengthRef.current
          if (length <= 0) return 0
          return index >= length - 1 ? 0 : index + 1
        })
      },
      NAVIGATE_THROTTLE_MS,
      { leading: true, trailing: false }
    )
  }, [])

  useEffect(
    function () {
      return function () {
        navigatePrev.cancel()
        navigateNext.cancel()
      }
    },
    [navigatePrev, navigateNext]
  )

  function openHit(hit?: SessionSearchHit) {
    const target = hit ?? hits[navigation]
    if (!target) return
    props.onSelect(target.session)
    props.onClose()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      navigatePrev()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      navigateNext()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      openHit()
    }
  }

  return (
    <DialogContent
      showCloseButton={false}
      className={styles.modal}>
        <DialogTitle className="sr-only">搜索任务</DialogTitle>
        <DialogDescription className="sr-only">按任务标题搜索本地任务并打开</DialogDescription>

        <div className={styles.inputRow}>
          <div className={styles.inputWrap}>
            <Icon
              icon="lucide:search"
              className={styles.searchIcon}
            />
            <Input
              ref={inputRef}
              value={keyword}
              placeholder="搜索任务标题或任务内容..."
              className={styles.input}
              onChange={function (event) {
                updateKeyword(event.target.value)
                // 关键词变了，命中项跟着换，导航位置回到第一条
                updateNavigation(0)
              }}
              onKeyDown={onKeyDown}
            />
          </div>
        </div>

        <div className={`${styles.metaRow} flex items-center justify-between`}>
          <span className={`${styles.metaLabel} text-muted-foreground`}>所有任务</span>
          <div className={`${styles.hints} text-muted-foreground flex items-center gap-2`}>
            <div className="flex items-center gap-1">
              <kbd className={styles.kbd}>↑</kbd>
              <kbd className={styles.kbd}>↓</kbd>
              <span>选择</span>
            </div>
            <div className="flex items-center gap-1">
              <kbd className={styles.kbd}>Enter</kbd>
              <span>打开</span>
            </div>
            <span>{hits.length} 个</span>
          </div>
        </div>

        <div className={styles.list}>
          {hits.length === 0 ? (
            <p className={styles.empty}>{keyword.trim() ? '无匹配任务' : '暂无任务'}</p>
          ) : (
            hits.map(function (hit, index) {
              const active = index === navigation
              return (
                <Button
                  key={hit.session.id}
                  type="button"
                  variant="ghost"
                  className={clsx(styles.hit, active && styles.hitActive)}
                  onMouseEnter={function () {
                    updateNavigation(index)
                  }}
                  onClick={function () {
                    openHit(hit)
                  }}>
                  <span className={styles.hitInner}>
                    <span className={styles.hitTitle}>{hit.session.title}</span>
                    <span className={styles.hitMeta}>{hit.pathHint}</span>
                    <span className={styles.hitDate}>
                      {dayjs(hit.session.updatedAt).format('M月D日')}
                    </span>
                  </span>
                </Button>
              )
            })
          )}
        </div>
    </DialogContent>
  )
}

export { SessionSearch }
export type { SessionSearchProps, SessionSearchHit }
