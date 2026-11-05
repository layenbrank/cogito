/**
 * 交互 PTY 多 tab（右栏终端面板 / 底部 Dock 共用）。
 *
 * **最近 N 个 tab 常驻挂载**（LRU，默认 4 个），非 active 只改 `opacity` / `pointer-events`：
 * 切页签不再卸载 xterm 实例，也就不会「重新 attach → replay 为空 → 只剩光标」。
 * Rust 侧会话与 scrollback 本来就不随视图回收，所以保活只是让画面也不丢。
 *
 * 早期版本只挂 active tab：每次切换都 remount + attach，画面完全依赖 replay，
 * 这就是「切一下终端就空白」的直接原因。
 *
 * `activeId` 失效时回落第一个 tab，避免「有 tab 却无视图」。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Terminal } from '@/lib/terminal'
import { useTerminalStore } from '@/stores/terminal'

import { TerminalView } from './terminal-view'

/** 常驻挂载的页签上限：再多就退化成「切一次重建一次」，内存也不值得 */
const MAX_MOUNTED = 4

interface TerminalTabsProps {
  cwd?: string | null
  emptyCwdMessage?: string
  /**
   * 宿主面板是否真正可见（右栏 mode===terminal）。
   * false 时**仍然挂载**（保活），只是不抢焦点：宿主用的是 `opacity-0` 覆盖层，
   * 容器仍有真实尺寸，提前 fit 不会量出 0 列。
   */
  paneVisible?: boolean
}

function TerminalTabs(props: TerminalTabsProps) {
  const tabs = useTerminalStore(function (state) {
    return state.tabs
  })
  const storeActiveId = useTerminalStore(function (state) {
    return state.activeId
  })
  const emptyCwdMessage = props.emptyCwdMessage ?? '请先设置工作目录'
  const paneVisible = props.paneVisible !== false
  /** activeId 失效时回落第一个：绝不让「有 tab 但一个都不 active」把面板渲染成空白 */
  const activeId =
    storeActiveId &&
    tabs.some(function (tab) {
      return tab.id === storeActiveId
    })
      ? storeActiveId
      : (tabs[0]?.id ?? null)

  /** 最近使用的 id 列表（最近的在前），只保留还存在的、且不超过 MAX_MOUNTED */
  const [mountedIds, setMountedIds] = useState<string[]>([])
  useEffect(
    function () {
      setMountedIds(function (previous) {
        const alive = previous.filter(function (id) {
          return tabs.some(function (tab) {
            return tab.id === id
          })
        })
        const next = activeId
          ? [activeId, ...alive.filter(function (id) {
              return id !== activeId
            })].slice(0, MAX_MOUNTED)
          : alive.slice(0, MAX_MOUNTED)
        const isSame =
          next.length === previous.length &&
          next.every(function (id, index) {
            return id === previous[index]
          })
        return isSame ? previous : next
      })
    },
    [activeId, tabs]
  )

  function handleNewTab() {
    if (!props.cwd) {
      toast.error(emptyCwdMessage)
      return
    }
    useTerminalStore.getState().newTab(props.cwd, { reveal: false })
  }

  function handleCloseTab(id: string) {
    // 关 UI tab 同时杀 Rust 会话，否则刷新后 list 仍能看到孤儿 PTY
    void Terminal.kill(id).catch(function (error) {
      console.warn('[terminal] kill 失败:', id, error)
    })
    useTerminalStore.getState().removeTab(id)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border flex shrink-0 items-center gap-1 overflow-x-auto border-b px-1.5 py-1">
        {tabs.map(function (tab) {
          const active = tab.id === activeId
          const isAgent = tab.origin === 'agent'
          return (
            <div
              key={tab.id}
              className={clsx(
                'flex shrink-0 items-center gap-0.5 rounded-md border border-transparent',
                active ? 'bg-muted border-border/60' : 'hover:bg-muted/60'
              )}>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                title={`${tab.title}${isAgent ? '（agent 会话）' : ''}\n${tab.cwd}`}
                className={clsx(
                  'h-6 justify-start gap-1.5 rounded-md px-2',
                  active ? 'text-foreground' : 'text-muted-foreground'
                )}
                onClick={function () {
                  useTerminalStore.getState().writeActive(tab.id)
                }}>
                <Icon
                  icon={isAgent ? 'lucide:bot' : 'lucide:terminal'}
                  className={clsx('size-3 shrink-0', isAgent && 'text-primary')}
                />
                <span className="max-w-32 truncate">{tab.title}</span>
                {tab.restored && !tab.exited ? (
                  <Icon
                    icon="lucide:history"
                    className="size-3 shrink-0 opacity-60"
                    aria-label="恢复的会话"
                  />
                ) : null}
                {tab.exited ? (
                  <span className="text-muted-foreground/80 text-[10px]">已退出</span>
                ) : null}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="关闭"
                title="关闭这个终端"
                className="text-muted-foreground hover:text-foreground size-5 shrink-0"
                onClick={function (event) {
                  event.stopPropagation()
                  handleCloseTab(tab.id)
                }}>
                <Icon
                  icon="lucide:x"
                  className="size-3"
                />
              </Button>
            </div>
          )
        })}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="新建终端"
          title="新建交互终端"
          className="text-muted-foreground hover:text-foreground size-6 shrink-0"
          onClick={handleNewTab}>
          <Icon
            icon="lucide:plus"
            className="size-3.5"
          />
        </Button>
      </div>

      <div
        className="relative min-h-0 flex-1"
        data-pane-visible={paneVisible ? 'true' : 'false'}>
        {tabs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <Icon
              icon="lucide:terminal"
              className="text-muted-foreground/50 size-7"
            />
            <p className="text-muted-foreground text-xs leading-relaxed">
              还没有终端会话
              <br />
              点右上角 <span className="text-foreground font-medium">+</span>{' '}
              新建一个，agent 跑命令时也会自动出现在这里
            </p>
          </div>
        ) : null}
        {/*
         * 常驻挂载：每个挂过的 tab 一个绝对定位层，非 active 的用 opacity-0 隐藏。
         * 不用 display:none / visibility:hidden —— 那会让 xterm 的 canvas 量到 0 宽，
         * 切回来不重绘（右栏 aside 里同样的取舍，见 aside.tsx 注释）。
         */}
        {tabs.map(function (tab) {
          if (!mountedIds.includes(tab.id)) return null
          const isActive = tab.id === activeId
          return (
            <div
              key={tab.id}
              className={clsx('absolute inset-0 z-10', !isActive && 'pointer-events-none opacity-0')}
              aria-hidden={!isActive}
              data-terminal-tab={tab.id}>
              <TerminalView
                id={tab.id}
                cwd={tab.cwd}
                active={isActive && paneVisible}
                origin={tab.origin}
                restored={tab.restored}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export { MAX_MOUNTED, TerminalTabs }
export type { TerminalTabsProps }
