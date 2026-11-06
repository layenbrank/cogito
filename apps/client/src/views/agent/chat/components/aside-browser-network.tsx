/**
 * 浏览器面板的「网络」视图。
 *
 * 这是纯 HTML，而原生子 webview 永远盖在 HTML 之上 —— 所以父组件切到这个视图
 * 时必须先 `browser_visible(false)` 让位，否则整页都被 browser tab 挡住。
 * 数据本身来自 Rust 侧 CDP `Network.*` 事件的聚合（`browser/network.rs`）。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  fetchBrowserInterceptStatus,
  listBrowserInterceptRules,
  listBrowserNetwork,
  setBrowserInterceptRules,
  type InterceptRule,
  type InterceptStatus,
  type NetworkEntry
} from '@/features/browser/api'

interface AsideBrowserNetworkProps {
  label: string
}

/** 字节数转人类可读 */
function formatSize(size: number | null): string {
  if (size === null || size <= 0) return '—'
  if (size < 1024) return `${Math.round(size)} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`
}

/** 状态码配色：2xx 正常、3xx 跳转、4xx/5xx 异常 */
function statusClass(status: number | null): string {
  if (status === null) return 'text-muted-foreground'
  if (status >= 500) return 'text-destructive'
  if (status >= 400) return 'text-amber-600 dark:text-amber-500'
  if (status >= 300) return 'text-sky-600 dark:text-sky-500'
  return 'text-emerald-600 dark:text-emerald-500'
}

/** 只留下路径 + 查询，host 太长会把列表挤爆 */
function shortenUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch (error) {
    console.debug('browser: 无法解析请求地址', url, error)
    return url
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch (error) {
    console.debug('browser: 无法解析请求 host', url, error)
    return ''
  }
}

function AsideBrowserNetwork(props: AsideBrowserNetworkProps) {
  const [entries, updateEntries] = useState<NetworkEntry[]>([])
  const [filter, updateFilter] = useState('')
  const [busy, updateBusy] = useState(false)
  const [rules, updateRules] = useState<InterceptRule[]>([])
  /** 拦截实测计数：paused > 0 才说明 requestPaused 真的来了 */
  const [status, updateStatus] = useState<InterceptStatus | null>(null)
  /** 过滤输入要不要传给后端：交给后端能拿到完整列表再筛，前端只负责展示 */
  const filterRef = useRef('')
  filterRef.current = filter

  const refresh = useCallback(
    function () {
      updateBusy(true)
      void fetchBrowserInterceptStatus(props.label)
        .then(updateStatus)
        .catch(function (error) {
          console.warn('browser: 读取拦截计数失败', error)
        })
      void listBrowserNetwork(props.label, filterRef.current || undefined, 300)
        .then(updateEntries)
        .catch(function (error) {
          toast.error(error instanceof Error ? error.message : String(error))
        })
        .finally(function () {
          updateBusy(false)
        })
    },
    [props.label]
  )

  // 进视图拉一次；之后靠「刷新」按钮，不做轮询（每条请求都要过一次 IPC 不划算）
  useEffect(
    function () {
      refresh()
      // 规则可能已被 agent 改过，UI 不能自己凭空认为“没拦截”
      void listBrowserInterceptRules(props.label)
        .then(updateRules)
        .catch(function (error) {
          console.warn('browser: 读取拦截规则失败', error)
        })
    },
    [refresh, props.label]
  )

  function applyRules(next: InterceptRule[]) {
    updateRules(next)
    void setBrowserInterceptRules(props.label, next)
      .then(function (result) {
        updateStatus(result)
        toast.success(
          result.rules === 0
            ? '已关闭拦截'
            : `拦截生效：${result.rules} 条规则 · 暂停 ${result.paused} / 命中 ${result.matched}`
        )
      })
      .catch(function (error) {
        toast.error(error instanceof Error ? error.message : String(error))
      })
  }

  /** 把一条请求加成 block 规则；重复点击同一个 URL 视为取消 */
  function toggleBlock(entry: NetworkEntry) {
    const exists = rules.some(function (rule) {
      return rule.pattern === entry.url && rule.action === 'block'
    })
    if (exists) {
      applyRules(
        rules.filter(function (rule) {
          return !(rule.pattern === entry.url && rule.action === 'block')
        })
      )
      return
    }
    applyRules([...rules, { pattern: entry.url, action: 'block' }])
  }

  function isBlocked(url: string): boolean {
    return rules.some(function (rule) {
      return rule.pattern === url && rule.action === 'block'
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5">
        <input
          value={filter}
          onChange={function (event) {
            updateFilter(event.target.value)
          }}
          onKeyDown={function (event) {
            if (event.key === 'Enter') refresh()
          }}
          placeholder="按 URL 过滤，回车应用"
          spellCheck={false}
          className="placeholder:text-muted-foreground/70 bg-muted/40 focus:bg-muted/60 min-w-0 flex-1 rounded-md px-2 py-1 text-xs outline-hidden transition-colors"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="刷新"
          title="刷新"
          className="text-muted-foreground hover:text-foreground size-6 shrink-0"
          onClick={refresh}>
          <Icon
            icon="lucide:refresh-cw"
            className={clsx('size-3.5', busy && 'animate-spin')}
          />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="清空拦截规则"
          title="清空所有拦截规则"
          disabled={rules.length === 0}
          className="text-muted-foreground hover:text-foreground size-6 shrink-0"
          onClick={function () {
            applyRules([])
          }}>
          <Icon
            icon="lucide:shield-off"
            className="size-3.5"
          />
        </Button>
      </div>

      {rules.length > 0 ? (
        <div className="text-muted-foreground shrink-0 border-b px-2 py-1 text-xs">
          拦截中：{rules.length} 条 · 暂停 {status?.paused ?? 0} / 命中 {status?.matched ?? 0}
          {status && status.paused === 0
            ? ' · 还没收到暂停事件（先点刷新；页面还没发请求也会是 0）'
            : ' · 命中即掐断（在请求列表里再点一次可取消）'}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {entries.length === 0 ? (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-1 px-4 text-center text-xs">
            <Icon
              icon="lucide:activity"
              className="size-5 opacity-60"
            />
            <span>{busy ? '读取中…' : '还没有记录到请求'}</span>
            <span className="opacity-70">只有本次打开标签页之后发生的请求才会出现在这里</span>
          </div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <tbody>
              {entries.map(function (entry) {
                const blocked = isBlocked(entry.url)
                return (
                  <tr
                    key={entry.id}
                    title={`${entry.method} ${entry.url}`}
                    className={clsx(
                      'group border-b border-border/40 last:border-0 hover:bg-muted/40',
                      blocked && 'opacity-50'
                    )}>
                    <td className="w-12 shrink-0 px-2 py-1 font-mono text-xs uppercase">
                      {entry.method}
                    </td>
                    <td
                      className={clsx(
                        'w-10 shrink-0 px-1 py-1 text-center font-mono text-xs',
                        statusClass(entry.status)
                      )}>
                      {entry.status ?? '—'}
                    </td>
                    <td className="min-w-0 px-1 py-1">
                      <div className="truncate">{shortenUrl(entry.url)}</div>
                      <div className="text-muted-foreground/70 truncate text-xs">
                        {hostOf(entry.url)}
                      </div>
                    </td>
                    <td className="text-muted-foreground w-14 shrink-0 px-1 py-1 text-end font-mono text-xs">
                      {formatSize(entry.size)}
                    </td>
                    <td className="text-muted-foreground w-14 shrink-0 px-1 py-1 text-end font-mono text-xs">
                      {formatDuration(entry.durationMs)}
                    </td>
                    <td className="w-7 shrink-0 px-1 py-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={blocked ? '取消屏蔽' : '屏蔽这个请求'}
                        title={blocked ? '取消屏蔽' : '屏蔽这个请求'}
                        className={clsx(
                          'size-5 opacity-0 transition-opacity group-hover:opacity-100',
                          blocked
                            ? 'text-destructive opacity-100'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                        onClick={function () {
                          toggleBlock(entry)
                        }}>
                        <Icon
                          icon={blocked ? 'lucide:shield-off' : 'lucide:ban'}
                          className="size-3"
                        />
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export { AsideBrowserNetwork }
