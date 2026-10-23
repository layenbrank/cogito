import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import { Progress } from '@cogito/design/components/progress'
import { Skeleton } from '@cogito/design/components/skeleton'
import { useNavigate } from 'react-router-dom'

import { useAccountSession } from '@/features/account/session.ts'
import { formatUsage, useThreadUsage, useUsageLedger } from '@/features/chat/usage.ts'
import { formatTokens, toQuotaView } from '@/features/quota/quota.ts'
import { RefreshButton } from '@/features/quota/refresh-button.tsx'
import { useInvalidateQuota, useSelfQuota } from '@/features/quota/usage.ts'
import { HttpError } from '@/utils/http.errors.ts'
import { AsideCard, AsideHint, AsideRow } from './aside-ui.tsx'
import { formatClock, formatDateTime } from '@/views/agent/settings/components/format.ts'

/**
 * 用量与额度 —— **两个口径分开标名**，这是这一屏最容易出错的地方：
 *
 * - 本机账本：studio 自己记的（重启不清零，成功 / 取消 / 失败都算一次）。它回答「这台机器花了多少」。
 * - 平台额度：服务端 `GET /gateway/quota/me` 的只读镜像。它回答「平台模型今天还能发多少」，
 *   与发送前的拦截同一口径，但**不含本机模型与自备密钥的模型**。
 *
 * 两个数放在一起而不写清来源，用户必然把它们当同一个数（这正是调研里要避免的坑）。
 */

const QUOTA_SECTION = '/agent/settings?section=quota'
const ACCOUNT_SECTION = '/agent/settings?section=account'

export function AsideUsage(props: { sessionID: string | null }) {
  const ledger = useUsageLedger(props.sessionID)
  const messageUsage = useThreadUsage()

  const session = ledger.data?.session
  const today = ledger.data?.today
  const hasSessionLedger = (session?.runs ?? 0) > 0
  const fallbackText = formatUsage(messageUsage)

  // 账本里没有这个会话时退回消息口径：更早的会话没赶上记账，显示成「没花过」是错的
  const sessionText = hasSessionLedger ? formatUsage(session) : fallbackText
  const todayText = (today?.runs ?? 0) > 0 ? formatUsage(today) : null

  return (
    <AsideCard
      id="usage"
      label="用量（本机账本）"
      action={
        <RefreshButton
          iconOnly
          isFetching={ledger.isFetching}
          label="刷新用量"
          onRefresh={function () {
            void ledger.refetch()
          }}
        />
      }>
      {ledger.isError ? (
        <div className="flex items-center justify-between gap-2">
          <AsideHint>账本读取失败。</AsideHint>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={function () {
              void ledger.refetch()
            }}>
            重试
          </Button>
        </div>
      ) : sessionText || todayText ? (
        <>
          <AsideRow
            label={hasSessionLedger ? '本会话累计' : '本会话（消息口径）'}
            title={sessionText ?? undefined}>
            {sessionText ?? '—'}
          </AsideRow>
          <AsideRow
            label="今日累计"
            title={todayText ?? undefined}>
            {todayText ?? '—'}
          </AsideRow>
          {!hasSessionLedger && fallbackText ? (
            <AsideHint>账本里还没有这个会话的记录，上面按消息上标的用量显示。</AsideHint>
          ) : null}
          <AsideHint>成功、取消、失败都记一笔；本机模型与平台模型一起算。</AsideHint>
        </>
      ) : ledger.isPending ? (
        <AsideHint>读取中…</AsideHint>
      ) : (
        <AsideHint>发一条消息后开始统计。</AsideHint>
      )}
    </AsideCard>
  )
}

export function AsideQuota() {
  const navigate = useNavigate()
  const session = useAccountSession()
  const signedIn = Boolean(session.token)
  const quotaQuery = useSelfQuota(null, signedIn)
  const refreshQuota = useInvalidateQuota()
  const view = toQuotaView(quotaQuery.data)

  // 卡片没地方摆「更新于」，就把它挂到刷新按钮的 title 上（同一个口径的数字与时间戳挨在一起）
  const stampText =
    quotaQuery.dataUpdatedAt > 0 ? `更新于 ${formatClock(quotaQuery.dataUpdatedAt)}` : null

  return (
    <AsideCard
      id="quota"
      label="平台额度"
      action={
        <div className="flex items-center gap-1">
          {view ? (
            <Badge variant="secondary">
              {view.plan ? `${view.sourceLabel} · ${view.plan}` : view.sourceLabel}
            </Badge>
          ) : null}
          {signedIn ? (
            <RefreshButton
              iconOnly
              isFetching={quotaQuery.isFetching}
              label={stampText ? `刷新 · ${stampText}` : '刷新'}
              onRefresh={function () {
                void refreshQuota()
              }}
            />
          ) : null}
        </div>
      }>
      {!signedIn ? (
        <>
          <AsideHint>未登录：平台模型用不了，现在只能用本机模型或自备密钥的模型。</AsideHint>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={function () {
              void navigate(ACCOUNT_SECTION)
            }}>
            去登录
          </Button>
        </>
      ) : quotaQuery.isPending ? (
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-3.5 w-32" />
        </div>
      ) : quotaQuery.isError ? (
        <>
          <AsideHint>{`额度读取失败：${HttpError(quotaQuery.error).message}`}</AsideHint>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={function () {
              void quotaQuery.refetch()
            }}>
            重试
          </Button>
        </>
      ) : view ? (
        <>
          <Progress value={view.percent} />
          <AsideRow label={`今日已用（${view.scopeLabel}）`}>
            {`${formatTokens(view.used)} / ${formatTokens(view.limit)}`}
          </AsideRow>
          <AsideRow label="剩余">{`${formatTokens(view.remaining)} tokens`}</AsideRow>
          <AsideRow label="重置">{formatDateTime(view.resetsAt)}</AsideRow>
          {view.exhausted ? (
            <AsideHint>今日额度已用尽，平台模型的新请求会被服务端拒绝。</AsideHint>
          ) : null}
          <AsideHint>
            按 UTC 日窗计 token，与发送前的拦截同一口径；本机模型与自备密钥的模型不占额度。
          </AsideHint>
        </>
      ) : (
        <AsideHint>暂时读不到额度。</AsideHint>
      )}

      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="text-muted-foreground hover:text-foreground self-start"
        onClick={function () {
          void navigate(QUOTA_SECTION)
        }}>
        用量、档位与订单
      </Button>
    </AsideCard>
  )
}
