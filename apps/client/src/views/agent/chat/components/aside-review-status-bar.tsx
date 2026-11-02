/**
 * 审阅面板状态栏：当前文件夹 + 分支（含远端）+ 抓取 / 拉取 / 推送 / 刷新。
 *
 * 每个按钮都带文字，语义写在 title 里，避免「一个刷新图标看不懂」：
 * 抓取只更新远端记录、拉取把上游并进本地、推送把本地提交发上去，
 * 刷新只重读本地状态（会先清 Git 指纹缓存）。
 *
 * 按钮的禁用条件与理由一一对应：`behind === 0` 时拉取禁用（已是最新）、
 * `ahead === 0` 时推送禁用（没有待推送的提交）；网络动作进行中整组禁用。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { cn } from 'cn'
import { useState } from 'react'

import { WorkspaceFolderChips } from '@/views/agent/chat/components/workspace-folder-chips'
import { BranchSwitcherView } from '@/views/code/workspace/scm/branch-switcher-view.tsx'

import type { BranchesResult, UpstreamResult } from '@/lib/workspace-git'

type BusyAction = 'fetch' | 'pull' | 'push' | 'refresh' | 'checkout'

interface AsideReviewStatusBarProps {
  branch: string
  ahead: number
  behind: number
  upstream: UpstreamResult | null
  branches: BranchesResult | null
  isPending: boolean
  onCheckout: (name: string, fromRemote?: string | null) => Promise<unknown>
  onFetch: () => Promise<unknown>
  onPull: () => Promise<unknown>
  onPush: () => Promise<unknown>
  onRefresh: () => Promise<unknown>
}

function ActionButton(props: {
  icon: string
  label: string
  title: string
  isBusy: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={props.label}
      title={props.title}
      disabled={props.disabled || props.isBusy}
      className={cn(
        'hover:bg-muted hover:text-foreground text-muted-foreground h-6 shrink-0 gap-1 px-1.5 text-xs font-normal',
        props.isBusy && 'opacity-60'
      )}
      onClick={props.onClick}>
      <Icon
        icon={props.isBusy ? 'lucide:loader-circle' : props.icon}
        className={cn('size-3.5 shrink-0', props.isBusy && 'animate-spin')}
      />
      <span className="whitespace-nowrap">{props.label}</span>
    </Button>
  )
}

function AsideReviewStatusBar(props: AsideReviewStatusBarProps) {
  const [busy, updateBusy] = useState<BusyAction | null>(null)
  const upstreamName = props.upstream?.upstream ?? null
  const hasUpstream = Boolean(props.upstream?.hasUpstream && upstreamName)
  const isBusy = busy !== null
  const isLocked = isBusy || props.isPending
  const isPullIdle = !hasUpstream || props.behind === 0
  const isPushIdle = hasUpstream && props.ahead === 0

  async function run(action: BusyAction, task: () => Promise<unknown>) {
    updateBusy(action)
    try {
      await task()
    } finally {
      updateBusy(null)
    }
  }

  return (
    <div className="border-border flex shrink-0 flex-col border-b">
      <WorkspaceFolderChips />

      <div className="flex items-center gap-1 px-1.5 py-1">
        <BranchSwitcherView
          branch={props.branch}
          locals={props.branches?.branches ?? []}
          remotes={props.branches?.remotes ?? []}
          ahead={props.ahead}
          behind={props.behind}
          isBusy={props.isPending}
          isCheckoutBusy={busy === 'checkout'}
          size="sm"
          tone="header"
          className="min-w-0 flex-1"
          onCheckout={function (name, fromRemote) {
            void run('checkout', function () {
              return props.onCheckout(name, fromRemote)
            })
          }}
        />

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <ActionButton
            icon="lucide:cloud-download"
            label="抓取"
            title={
              hasUpstream
                ? `抓取远程更新：只刷新 ${upstreamName} 的远端记录，不动本地文件`
                : '抓取远程更新：只刷新远端分支记录，不动本地文件'
            }
            isBusy={busy === 'fetch'}
            disabled={isLocked}
            onClick={function () {
              void run('fetch', props.onFetch)
            }}
          />
          <ActionButton
            icon="lucide:arrow-down-to-line"
            label="拉取"
            title={
              !hasUpstream
                ? '拉取：当前分支还没有上游，先推送一次建立跟踪'
                : props.behind === 0
                  ? `拉取：已是最新（${upstreamName} 没有新提交）`
                  : `拉取：把 ${upstreamName} 的 ${props.behind} 个提交并入当前分支`
            }
            isBusy={busy === 'pull'}
            disabled={isLocked || isPullIdle}
            onClick={function () {
              void run('pull', props.onPull)
            }}
          />
          <ActionButton
            icon="lucide:arrow-up-from-line"
            label="推送"
            title={
              !hasUpstream
                ? '推送：当前分支首次推送，会同时建立上游跟踪'
                : props.ahead === 0
                  ? `推送：没有待推送的提交（${upstreamName} 已包含全部本地提交）`
                  : `推送：把本地 ${props.ahead} 个提交发到 ${upstreamName}`
            }
            isBusy={busy === 'push'}
            disabled={isLocked || !props.branch || isPushIdle}
            onClick={function () {
              void run('push', props.onPush)
            }}
          />
          <ActionButton
            icon="lucide:refresh-cw"
            label="刷新"
            title="刷新：重新读取本地改动（会先清掉 Git 状态缓存）"
            isBusy={busy === 'refresh'}
            disabled={isBusy}
            onClick={function () {
              void run('refresh', props.onRefresh)
            }}
          />
        </div>
      </div>

      <div className="text-muted-foreground flex items-center gap-2 px-2.5 pb-1 text-[11px]">
        <Icon
          icon={hasUpstream ? 'lucide:cloud' : 'lucide:cloud-off'}
          className="size-3 shrink-0 opacity-70"
        />
        <span
          className="min-w-0 truncate font-mono"
          title={hasUpstream ? (upstreamName ?? '') : '未设置上游分支'}>
          {hasUpstream ? upstreamName : '未设上游'}
        </span>
        {hasUpstream ? (
          <span className="shrink-0 tabular-nums">
            ↑{props.ahead} ↓{props.behind}
          </span>
        ) : null}
        {hasUpstream && props.ahead === 0 && props.behind === 0 ? (
          <span className="shrink-0">已同步</span>
        ) : null}
      </div>
    </div>
  )
}

export { AsideReviewStatusBar }
