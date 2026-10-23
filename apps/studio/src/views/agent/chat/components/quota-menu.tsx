import { Icon } from '@iconify/react/offline'
import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from '@cogito/design/components/popover'
import { Progress } from '@cogito/design/components/progress'
import { Skeleton } from '@cogito/design/components/skeleton'
import { useNavigate } from 'react-router-dom'

import { useAccountSession } from '@/features/account/session.ts'
import { formatTokens, toQuotaView, type QuotaView } from '@/features/quota/quota.ts'
import { RefreshButton } from '@/features/quota/refresh-button.tsx'
import { useInvalidateQuota, useSelfQuota } from '@/features/quota/usage.ts'
import { HttpError } from '@/utils/http.errors.ts'
import { formatClock, formatDateTime } from '@/views/agent/settings/components/format.ts'

/**
 * 左栏底栏的额度入口，排在设置齿轮左边。
 *
 * 数字只用服务端那份只读镜像（`GET /gateway/quota/me`）—— 与发送前的拦截同一个口径，
 * 界面上「还剩多少」和「还能不能发」因此不会各说各话。未登录时不发这个请求：平台模型本来
 * 就要登录，登录入口在齿轮菜单里。
 *
 * 为什么不并进齿轮菜单：额度是每天都想扫一眼的数，藏进两级面板就没人看了。触发器上的百分比
 * 就是那个「一眼」。
 */

const QUOTA_SECTION = '/agent/settings?section=quota'
const ACCOUNT_SECTION = '/agent/settings?section=account'

/** 触发器上的提示：把百分比的来源写清楚，免得被当成「剩余」 */
function findTriggerTitle(view: QuotaView | null): string {
  if (!view) return '额度与用量'
  return `今日平台模型 token 已用 ${view.percent}%（${formatTokens(view.used)} / ${formatTokens(view.limit)}）`
}

function QuotaPanel() {
  const navigate = useNavigate()
  const quotaQuery = useSelfQuota()
  const refreshQuota = useInvalidateQuota()
  const view = toQuotaView(quotaQuery.data)

  // 「更新于」是这一屏的自证：手动刷新与对话结束后的自动刷新都会把它往前推一格
  const stampText = quotaQuery.isFetching
    ? '刷新中…'
    : quotaQuery.dataUpdatedAt > 0
      ? `更新于 ${formatClock(quotaQuery.dataUpdatedAt)}`
      : null

  return (
    <div className="flex flex-col gap-3">
      <PopoverHeader>
        <div className="flex items-center justify-between gap-2">
          <PopoverTitle className="text-sm">平台模型额度</PopoverTitle>
          <div className="flex items-center gap-1">
            {view ? (
              <Badge variant="secondary">
                {view.plan ? `${view.sourceLabel} · ${view.plan}` : view.sourceLabel}
              </Badge>
            ) : null}
            <RefreshButton
              iconOnly
              isFetching={quotaQuery.isFetching}
              label={stampText ? `刷新 · ${stampText}` : '刷新'}
              onRefresh={function () {
                void refreshQuota()
              }}
            />
          </div>
        </div>
        <PopoverDescription className="text-xs">
          按 UTC 日窗计 token，与发送前的拦截判定同一口径。
        </PopoverDescription>
      </PopoverHeader>

      {quotaQuery.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-24" />
        </div>
      ) : null}

      {quotaQuery.isError ? (
        <div className="flex flex-col gap-2">
          <p className="text-destructive text-xs leading-relaxed">
            {`额度读取失败：${HttpError(quotaQuery.error).message}`}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={function () {
              void quotaQuery.refetch()
            }}>
            重试
          </Button>
        </div>
      ) : null}

      {view ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Progress value={view.percent} />
            <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs tabular-nums">
              <span>
                {`今日已用 ${formatTokens(view.used)} / ${formatTokens(view.limit)} tokens`}
              </span>
              {stampText ? <span>{stampText}</span> : null}
            </div>
          </div>

          <dl className="flex flex-col gap-1 text-xs">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">剩余</dt>
              <dd className="tabular-nums">{`${formatTokens(view.remaining)} tokens`}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">重置</dt>
              <dd className="tabular-nums">{formatDateTime(view.resetsAt)}</dd>
            </div>
          </dl>

          {view.exhausted ? (
            <p className="text-destructive text-xs leading-relaxed">
              今日额度已用尽，平台模型的新请求会被服务端拒绝。
            </p>
          ) : null}
        </>
      ) : null}

      <p className="text-muted-foreground text-xs leading-relaxed">
        本机模型与自备密钥的模型不占额度。
      </p>

      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={function () {
          void navigate(QUOTA_SECTION)
        }}>
        用量、档位与订单
      </Button>
    </div>
  )
}

function SignedOutPanel() {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col gap-3">
      <PopoverHeader>
        <PopoverTitle className="text-sm">平台模型额度</PopoverTitle>
        <PopoverDescription className="text-xs">
          未登录：平台模型用不了，现在只能用本机模型或自备密钥的模型。
        </PopoverDescription>
      </PopoverHeader>

      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={function () {
          void navigate(ACCOUNT_SECTION)
        }}>
        去登录
      </Button>
    </div>
  )
}

export function QuotaMenu() {
  const session = useAccountSession()
  const signedIn = Boolean(session.token)
  // 没登录就不去问：网关只会回 401，界面也没有可展示的数字
  const quotaQuery = useSelfQuota(null, signedIn)
  const view = toQuotaView(quotaQuery.data)

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground h-8 shrink-0 gap-1 rounded-md px-2"
            aria-label="额度与用量"
            title={findTriggerTitle(view)}
          />
        }>
        <Icon
          icon="lucide:gauge"
          className="size-4"
        />
        {view ? (
          <span
            className={
              view.exhausted ? 'text-destructive text-xs tabular-nums' : 'text-xs tabular-nums'
            }>
            {`${view.percent}%`}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end">
        {signedIn ? <QuotaPanel /> : <SignedOutPanel />}
      </PopoverContent>
    </Popover>
  )
}
