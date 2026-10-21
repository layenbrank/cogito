import { Icon } from '@iconify/react/offline'
import { Link } from 'react-router-dom'

import type { ExceptionRecord } from '@/apis/exception.ts'

interface RecentExceptionsProps {
  items: ExceptionRecord[]
  isLoading: boolean
  total?: number
}

function formatRelative(ms: number) {
  const delta = Date.now() - ms
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < minute) return '刚刚'
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`
  if (delta < 7 * day) return `${Math.floor(delta / day)} 天前`
  return new Date(ms).toLocaleString()
}

function RecentExceptions(props: RecentExceptionsProps) {
  const rows = props.items.slice(0, 12)

  return (
    <section
      className="rounded-lg border border-border/80 bg-[var(--backend-surface)]"
      style={{ boxShadow: 'var(--backend-elevation-1)' }}>
      <header className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <Icon
            icon="lucide:triangle-alert"
            className="size-3.5 text-muted-foreground"
          />
          近期异常
          {props.total != null ? (
            <span className="font-normal text-muted-foreground">· 共 {props.total}</span>
          ) : null}
        </div>
        <div className="flex gap-3 text-[11px]">
          <Link
            to="/exceptions"
            className="text-[var(--backend-accent)] hover:underline">
            异常台
          </Link>
          <Link
            to="/logs"
            className="text-[var(--backend-accent)] hover:underline">
            操作日志
          </Link>
        </div>
      </header>

      {props.isLoading ? (
        <p className="px-3 py-8 text-center text-xs text-muted-foreground">加载中…</p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-1 px-3 py-10 text-center">
          <Icon
            icon="lucide:inbox"
            className="size-5 text-muted-foreground/50"
          />
          <p className="text-xs text-muted-foreground">暂无上报异常</p>
        </div>
      ) : (
        <ul className="divide-y divide-border/50">
          {rows.map(function (row) {
            return (
              <li
                key={row.id}
                className="flex items-start gap-3 px-3 py-2 text-xs hover:bg-muted/30">
                <time
                  className="w-16 shrink-0 pt-0.5 tabular-nums text-muted-foreground"
                  dateTime={new Date(row.receivedAt).toISOString()}
                  title={new Date(row.receivedAt).toLocaleString()}>
                  {formatRelative(row.receivedAt)}
                </time>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate">
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium"
                      style={{
                        color:
                          row.level === 'fatal' || row.level === 'error'
                            ? 'var(--backend-danger)'
                            : row.level === 'warning'
                              ? 'var(--backend-warn)'
                              : 'var(--backend-accent)',
                        background:
                          row.level === 'fatal' || row.level === 'error'
                            ? 'var(--backend-danger-soft)'
                            : row.level === 'warning'
                              ? 'var(--backend-warn-soft)'
                              : 'var(--backend-accent-soft)'
                      }}>
                      {row.level === 'fatal'
                        ? '致命'
                        : row.level === 'error'
                          ? '错误'
                          : row.level === 'warning'
                            ? '警告'
                            : row.level === 'info'
                              ? '信息'
                              : row.level}
                    </span>
                    <span className="truncate font-medium">{row.message}</span>
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {row.source} · {row.url}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export { RecentExceptions }
