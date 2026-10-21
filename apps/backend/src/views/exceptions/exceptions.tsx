import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@i-thinking/design/components/select'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useState } from 'react'
import { toast } from 'sonner'

import {
  DELETE_EXCEPTION,
  GET_EXCEPTION,
  GET_EXCEPTIONS,
  GET_EXCEPTION_GROUPS,
  GET_EXCEPTION_SOURCES,
  GET_EXCEPTION_SUMMARY,
  type ExceptionRecord
} from '@/apis/exception.ts'
import { ConfirmDialog } from '@/components/console/confirm-dialog.tsx'
import { ConsolePage } from '@/components/console/console-page.tsx'
import { DataTable, TableFooter } from '@/components/console/data-table.tsx'
import { EntitySheet } from '@/components/console/entity-sheet.tsx'
import { FilterBar } from '@/components/console/filter-bar.tsx'
import { QueryState } from '@/components/console/query-state.tsx'
import { RefreshButton } from '@/components/console/refresh-button.tsx'
import { HttpError } from '@/utils/http/errors.ts'

const PAGE_SIZE = 20

const LEVEL_LABELS: Record<string, string> = {
  fatal: '致命',
  error: '错误',
  warning: '警告',
  info: '信息'
}

const LEVEL_OPTIONS = [
  { value: 'fatal', label: '致命' },
  { value: 'error', label: '错误' },
  { value: 'warning', label: '警告' },
  { value: 'info', label: '信息' }
] as const

const SUMMARY_METRICS = [
  { key: 'total', label: '合计', accent: 'var(--backend-accent)', filter: '' },
  { key: 'fatal', label: '致命', accent: 'var(--backend-danger)', filter: 'fatal' },
  { key: 'error', label: '错误', accent: 'var(--backend-danger)', filter: 'error' },
  { key: 'warning', label: '警告', accent: 'var(--backend-warn)', filter: 'warning' }
] as const

function findLevelLabel(level: string) {
  return LEVEL_LABELS[level.toLowerCase()] ?? level
}

function findLevelTone(level: string) {
  const key = level.toLowerCase()
  if (key === 'fatal' || key === 'error') {
    return {
      color: 'var(--backend-danger)',
      background: 'var(--backend-danger-soft)'
    }
  }
  if (key === 'warning') {
    return {
      color: 'var(--backend-warn)',
      background: 'var(--backend-warn-soft)'
    }
  }
  return {
    color: 'var(--backend-accent)',
    background: 'var(--backend-accent-soft)'
  }
}

function LevelBadge(props: { level: string }) {
  const tone = findLevelTone(props.level)
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
      style={{ color: tone.color, background: tone.background }}>
      {findLevelLabel(props.level)}
    </span>
  )
}

export default function ExceptionsView() {
  const queryClient = useQueryClient()
  const [tab, updateTab] = useState<'events' | 'groups'>('groups')
  const [q, updateQ] = useState('')
  const [level, updateLevel] = useState('')
  const [source, updateSource] = useState('')
  const [fingerprint, updateFingerprint] = useState('')
  const [page, updatePage] = useState(1)
  const [detailID, updateDetailID] = useState<string | null>(null)
  const [pendingDelete, updatePendingDelete] = useState<ExceptionRecord | null>(null)

  const filter = {
    q: q.trim() || undefined,
    level: level || undefined,
    source: source || undefined,
    fingerprint: fingerprint || undefined,
    take: PAGE_SIZE,
    skip: (page - 1) * PAGE_SIZE
  }

  const summary = useQuery({
    queryKey: ['exception-summary', filter.source, filter.q],
    queryFn: function () {
      return GET_EXCEPTION_SUMMARY({
        source: filter.source,
        q: filter.q
      })
    }
  })

  const sources = useQuery({
    queryKey: ['exception-sources'],
    queryFn: GET_EXCEPTION_SOURCES
  })

  const events = useQuery({
    queryKey: ['exceptions', filter],
    queryFn: function () {
      return GET_EXCEPTIONS(filter)
    },
    enabled: tab === 'events'
  })

  const groups = useQuery({
    queryKey: ['exception-groups', filter.q, filter.level, filter.source, filter.take, filter.skip],
    queryFn: function () {
      return GET_EXCEPTION_GROUPS({
        q: filter.q,
        level: filter.level,
        source: filter.source,
        take: filter.take,
        skip: filter.skip
      })
    },
    enabled: tab === 'groups'
  })

  const detail = useQuery({
    queryKey: ['exception', detailID],
    queryFn: function () {
      return GET_EXCEPTION(detailID!)
    },
    enabled: Boolean(detailID)
  })

  const remove = useMutation({
    mutationFn: DELETE_EXCEPTION,
    onSuccess() {
      toast.success('已删除')
      updatePendingDelete(null)
      updateDetailID(null)
      void queryClient.invalidateQueries({ queryKey: ['exceptions'] })
      void queryClient.invalidateQueries({ queryKey: ['exception-groups'] })
      void queryClient.invalidateQueries({ queryKey: ['exception-summary'] })
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const eventTotal = events.data?.total ?? 0
  const groupTotal = groups.data?.total ?? 0
  const eventPages = Math.max(1, Math.ceil(eventTotal / PAGE_SIZE))
  const groupPages = Math.max(1, Math.ceil(groupTotal / PAGE_SIZE))
  const listError = tab === 'groups' ? groups.error : events.error
  const isListLoading = tab === 'groups' ? groups.isLoading : events.isLoading
  const isListError = tab === 'groups' ? groups.isError : events.isError

  function resetPage() {
    updatePage(1)
  }

  function openGroupEvents(fp: string) {
    updateFingerprint(fp)
    updateTab('events')
    resetPage()
  }

  function findSummaryCount(key: string) {
    if (key === 'total') return summary.data?.total ?? 0
    return summary.data?.byLevel?.[key] ?? 0
  }

  function toggleLevelFilter(next: string) {
    resetPage()
    updateLevel(function (current) {
      return current === next ? '' : next
    })
  }

  return (
    <ConsolePage bare>
      <div className="flex min-h-full flex-1 flex-col gap-3">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/60">
          <div className="flex gap-1">
            {(
              [
                { id: 'groups' as const, label: '问题分组' },
                { id: 'events' as const, label: '事件列表' }
              ] as const
            ).map(function (item) {
              const active = tab === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  className={clsx(
                    '-mb-px border-b-2 px-3 py-2.5 text-sm transition',
                    active
                      ? 'border-[var(--backend-accent)] font-medium text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                  onClick={function () {
                    updateTab(item.id)
                    if (item.id === 'groups') updateFingerprint('')
                    resetPage()
                  }}>
                  {item.label}
                </button>
              )
            })}
          </div>
          {fingerprint ? (
            <Button
              variant="ghost"
              onClick={function () {
                updateFingerprint('')
              }}>
              清除分组筛选
            </Button>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2.5">
          <FilterBar>
            <Input
              className="h-10 max-w-sm"
              placeholder="搜索消息 / 地址"
              aria-label="搜索"
              value={q}
              onChange={function (event) {
                resetPage()
                updateQ(event.target.value)
              }}
            />
            <Select
              value={level || null}
              onValueChange={function (value) {
                resetPage()
                updateLevel(value ?? '')
              }}>
              <SelectTrigger className="h-10 w-36">
                <SelectValue placeholder="全部级别" />
              </SelectTrigger>
              <SelectContent>
                {LEVEL_OPTIONS.map(function (option) {
                  return (
                    <SelectItem
                      key={option.value}
                      value={option.value}>
                      {option.label}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            <Select
              value={source || null}
              onValueChange={function (value) {
                resetPage()
                updateSource(value ?? '')
              }}>
              <SelectTrigger className="h-10 w-40">
                <SelectValue placeholder="全部来源" />
              </SelectTrigger>
              <SelectContent>
                {(sources.data ?? []).map(function (item) {
                  return (
                    <SelectItem
                      key={item}
                      value={item}>
                      {item}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            {level || source ? (
              <Button
                variant="ghost"
                onClick={function () {
                  resetPage()
                  updateLevel('')
                  updateSource('')
                }}>
                清空筛选
              </Button>
            ) : null}
          </FilterBar>
          <RefreshButton
            isFetching={tab === 'groups' ? groups.isFetching : events.isFetching}
            onRefresh={function () {
              if (tab === 'groups') void groups.refetch()
              else void events.refetch()
              void summary.refetch()
            }}
          />
        </div>

        <div
          className="grid shrink-0 grid-cols-2 overflow-hidden rounded-lg border border-border/70 bg-[var(--backend-surface)] sm:grid-cols-4"
          style={{ boxShadow: 'var(--backend-elevation-1)' }}>
          {SUMMARY_METRICS.map(function (metric, index) {
            const active = metric.filter ? level === metric.filter : !level
            return (
              <button
                key={metric.key}
                type="button"
                className={clsx(
                  'px-3 py-3 text-left transition hover:bg-muted/30',
                  index > 0 && 'border-l border-border/60',
                  active && 'bg-[var(--backend-accent-soft)]/40'
                )}
                onClick={function () {
                  toggleLevelFilter(metric.filter)
                }}>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: metric.accent, opacity: active ? 1 : 0.55 }}
                    aria-hidden
                  />
                  {metric.label}
                </p>
                <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">
                  {summary.isLoading ? '…' : findSummaryCount(metric.key).toLocaleString()}
                </p>
              </button>
            )
          })}
        </div>

        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/70 bg-[var(--backend-surface)]"
          style={{ boxShadow: 'var(--backend-elevation-1)' }}>
          <QueryState
            isLoading={isListLoading}
            isError={isListError}
            error={listError}
            onRetry={function () {
              if (tab === 'groups') void groups.refetch()
              else void events.refetch()
            }}>
            {tab === 'groups' ? (
              <>
                <DataTable
                  columns={[
                    {
                      key: 'level',
                      title: '级别',
                      render(row) {
                        return <LevelBadge level={row.level} />
                      }
                    },
                    {
                      key: 'message',
                      title: '消息',
                      className: 'max-w-md',
                      render(row) {
                        return (
                          <div className="min-w-0">
                            <p className="truncate font-medium">{row.message}</p>
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {row.source} · {row.url}
                            </p>
                          </div>
                        )
                      }
                    },
                    {
                      key: 'count',
                      title: '次数',
                      className: 'tabular-nums',
                      render(row) {
                        return row.count
                      }
                    },
                    {
                      key: 'last',
                      title: '最近',
                      className: 'whitespace-nowrap text-muted-foreground',
                      render(row) {
                        return new Date(row.lastSeen).toLocaleString()
                      }
                    },
                    {
                      key: 'actions',
                      title: '操作',
                      render(row) {
                        return (
                          <Button
                            variant="outline"
                            onClick={function (event) {
                              event.stopPropagation()
                              openGroupEvents(row.fingerprint)
                            }}>
                            查看事件
                          </Button>
                        )
                      }
                    }
                  ]}
                  rows={groups.data?.items ?? []}
                  rowKey={function (row) {
                    return row.fingerprint
                  }}
                  emptyTitle="暂无异常分组"
                  onRowClick={function (row) {
                    openGroupEvents(row.fingerprint)
                  }}
                />
                <TableFooter
                  count={groupTotal}
                  page={page}
                  total={groupPages}
                  isFetching={groups.isFetching}
                  onPage={updatePage}
                />
              </>
            ) : (
              <>
                <DataTable
                  columns={[
                    {
                      key: 'time',
                      title: '时间',
                      className: 'whitespace-nowrap text-muted-foreground',
                      render(row) {
                        return new Date(row.receivedAt).toLocaleString()
                      }
                    },
                    {
                      key: 'level',
                      title: '级别',
                      render(row) {
                        return <LevelBadge level={row.level} />
                      }
                    },
                    {
                      key: 'message',
                      title: '消息',
                      className: 'max-w-sm',
                      render(row) {
                        return (
                          <div className="min-w-0">
                            <p className="truncate font-medium">{row.message}</p>
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {row.source}
                              {row.method ? ` · ${row.method}` : ''}
                              {row.status != null ? ` ${row.status}` : ''}
                            </p>
                          </div>
                        )
                      }
                    },
                    {
                      key: 'env',
                      title: '环境',
                      className: 'text-xs text-muted-foreground',
                      render(row) {
                        return row.environment ?? '—'
                      }
                    },
                    {
                      key: 'actions',
                      title: '操作',
                      render(row) {
                        return (
                          <div className="flex gap-1.5">
                            <Button
                              variant="outline"
                              onClick={function (event) {
                                event.stopPropagation()
                                updateDetailID(row.id)
                              }}>
                              详情
                            </Button>
                            <Button
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={function (event) {
                                event.stopPropagation()
                                updatePendingDelete(row)
                              }}>
                              删除
                            </Button>
                          </div>
                        )
                      }
                    }
                  ]}
                  rows={events.data?.items ?? []}
                  rowKey={function (row) {
                    return row.id
                  }}
                  emptyTitle="暂无异常事件"
                  onRowClick={function (row) {
                    updateDetailID(row.id)
                  }}
                />
                <TableFooter
                  count={eventTotal}
                  page={page}
                  total={eventPages}
                  isFetching={events.isFetching}
                  onPage={updatePage}
                />
              </>
            )}
          </QueryState>
        </div>
      </div>

      <EntitySheet
        open={Boolean(detailID)}
        title="异常详情"
        description="只读事件；删除不可恢复。"
        onOpenChange={function (open) {
          if (!open) updateDetailID(null)
        }}>
        {detail.isLoading ? (
          <p className="text-sm text-muted-foreground">加载中…</p>
        ) : detail.data ? (
          <ExceptionDetail
            row={detail.data}
            onDelete={function () {
              updatePendingDelete(detail.data!)
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">加载失败</p>
        )}
      </EntitySheet>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除该异常事件？"
        description="硬删除后无法恢复，问题计数会随之变化。"
        confirmLabel="删除"
        destructive
        isPending={remove.isPending}
        onOpenChange={function (open) {
          if (!open) updatePendingDelete(null)
        }}
        onConfirm={function () {
          if (pendingDelete) remove.mutate(pendingDelete.id)
        }}
      />
    </ConsolePage>
  )
}

function ExceptionDetail(props: { row: ExceptionRecord; onDelete(): void }) {
  const row = props.row
  return (
    <div className="space-y-3 text-sm">
      <LevelBadge level={row.level} />
      <p className="font-medium break-words">{row.message}</p>
      <dl className="grid gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">来源</dt>
          <dd className="mt-0.5">{row.source}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">地址</dt>
          <dd className="mt-0.5 break-all font-mono">{row.url}</dd>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <dt className="text-muted-foreground">发生时间</dt>
            <dd className="mt-0.5">{new Date(row.timestamp).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">入库时间</dt>
            <dd className="mt-0.5">{new Date(row.receivedAt).toLocaleString()}</dd>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <dt className="text-muted-foreground">环境</dt>
            <dd className="mt-0.5">{row.environment ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">版本</dt>
            <dd className="mt-0.5">{row.release ?? '—'}</dd>
          </div>
        </div>
        {row.stack ? (
          <div>
            <dt className="text-muted-foreground">堆栈</dt>
            <dd className="mt-0.5 max-h-48 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[11px] whitespace-pre-wrap">
              {row.stack}
            </dd>
          </div>
        ) : null}
      </dl>
      <Button
        size="sm"
        variant="destructive"
        onClick={props.onDelete}>
        删除事件
      </Button>
    </div>
  )
}
