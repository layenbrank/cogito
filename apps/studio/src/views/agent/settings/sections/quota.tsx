import { Icon } from '@iconify/react/offline'
import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import { Progress } from '@cogito/design/components/progress'
import { Skeleton } from '@cogito/design/components/skeleton'
import { useState } from 'react'
import { toast } from 'sonner'

import type { GatewaySelfQuota } from '@/apis/gateway.ts'
import type { PaymentOrder } from '@/apis/payment.ts'
import { useIsAdmin } from '@/features/account/session.ts'
import {
  describePlan,
  findChannelLabel,
  findOrderStatusLabel,
  formatMoney
} from '@/features/payment/checkout.ts'
import { usePaymentCatalog, useTenantOrders } from '@/features/payment/orders.ts'
import { formatTokens, toQuotaView } from '@/features/quota/quota.ts'
import { RefreshButton } from '@/features/quota/refresh-button.tsx'
import {
  useActiveTenant,
  useCancelSubscription,
  useGatewayPlans,
  useInvalidateQuota,
  useSelfQuota,
  useSubscribe,
  useTenantSubscriptions
} from '@/features/quota/usage.ts'
import { HttpError } from '@/utils/http.errors.ts'
import { CheckoutDialog } from '@/views/agent/settings/components/checkout-dialog.tsx'
import { formatClock, formatDateTime } from '@/views/agent/settings/components/format.ts'
import { SettingRow, SettingsSection } from '@/views/agent/settings/components/section.tsx'
import {
  DataTable,
  TableLoading,
  type TableColumn
} from '@/views/agent/settings/components/table.tsx'

/**
 * 个人 · 额度：平台模型（`/gateway`）的日 token 配额、档位订阅与支付订单。
 *
 * 上限、今日已用、重置时刻一律取服务端的只读镜像（`GET /gateway/quota/me`）。归属租户还是账号、
 * 模型有没有单独覆盖、Redis 日窗计数是多少，只有服务端算得准，所以这里不再自己汇总 —— 以前那份
 * 汇总要读管理员接口，普通账号只会看到「暂不可得」。真正拦请求的是服务端，界面负责让用户提前知道
 * 还剩多少、以及去哪加量。
 *
 * 档位与价格来自 `GET /tenants/{id}/pay/catalog`（服务端 `pay.plans`）：**价格只在服务端**，界面
 * 只负责把「多少钱、给多少配额、多久」摆出来并把人送进收银台。开通发生在服务端验签之后，所以这里
 * 没有「点了就生效」的按钮 —— 唯一的例外是平台管理员（`can_manage` 旁路），保留「直接开通」用于
 * 客服代开与本地联调。
 *
 * 渠道没配好凭据时（本机常见）目录里 `enabled=false` 并带原因，界面如实置灰，不摆假二维码。
 */

/** 计费归属给人看：有租户身份报租户类型，没有就是账号级 */
function findScopeText(quota: GatewaySelfQuota): string {
  if (!quota.tenantID) return '登录账号'
  return `${quota.tenantType === 'TEAM' ? '团队租户' : '个人租户'} · ${quota.tenantID}`
}

export function QuotaSection() {
  const admin = useIsAdmin()
  const quotaQuery = useSelfQuota()
  const refreshQuota = useInvalidateQuota()
  const plansQuery = useGatewayPlans()
  const activeTenant = useActiveTenant()
  const tenantID = activeTenant.tenant ? activeTenant.tenant.id : null
  const subscriptionsQuery = useTenantSubscriptions(tenantID)

  const catalogQuery = usePaymentCatalog(tenantID)
  const ordersQuery = useTenantOrders(tenantID)
  const subscribe = useSubscribe(tenantID)
  const cancel = useCancelSubscription(tenantID)

  const [removingID, updateRemovingID] = useState<string | null>(null)
  const [checkoutPlan, updateCheckoutPlan] = useState<string | null>(null)

  const quota = quotaQuery.data
  const view = toQuotaView(quota)
  // 「这屏数字是什么时候的」：手动刷新与对话结束后的自动刷新都会把它往前推一格
  const stampText = quotaQuery.isFetching
    ? '刷新中…'
    : quotaQuery.dataUpdatedAt > 0
      ? `更新于 ${formatClock(quotaQuery.dataUpdatedAt)}`
      : null
  const catalog = catalogQuery.data
  const orders = ordersQuery.data ?? []
  const subscriptions = subscriptionsQuery.data ?? []
  const active = subscriptions.find(function (item) {
    return item.status === 'ACTIVE'
  })

  /** 平台管理员的手工开通：客服代开与本地联调用，普通人走收银台 */
  function grantPlan(plan: string) {
    subscribe.mutate(
      { plan: plan },
      {
        onSuccess: function () {
          toast.success(`已开通「${plan}」档位`)
        },
        onError: function (error) {
          toast.error(HttpError(error).message || '开通失败')
        }
      }
    )
  }

  const orderColumns: TableColumn<PaymentOrder>[] = [
    {
      key: 'no',
      title: '订单号',
      render: function (row) {
        return <span className="font-mono text-xs">{row.orderNo}</span>
      }
    },
    {
      key: 'plan',
      title: '档位',
      render: function (row) {
        return row.plan
      }
    },
    {
      key: 'channel',
      title: '渠道',
      render: function (row) {
        return findChannelLabel(row.channel)
      }
    },
    {
      key: 'amount',
      title: '金额',
      render: function (row) {
        return <span className="tabular-nums">{formatMoney(row.amount, row.currency)}</span>
      }
    },
    {
      key: 'status',
      title: '状态',
      render: function (row) {
        return (
          <Badge variant={row.status === 'PAID' ? 'default' : 'outline'}>
            {findOrderStatusLabel(row.status)}
          </Badge>
        )
      }
    },
    {
      key: 'created',
      title: '创建时间',
      render: function (row) {
        return (
          <span className="text-muted-foreground text-xs tabular-nums">
            {formatDateTime(row.createdAt)}
          </span>
        )
      }
    }
  ]

  function removeActive() {
    if (!removingID) return

    cancel.mutate(removingID, {
      onSuccess: function () {
        toast.success('已取消订阅，配额回落免费档')
        updateRemovingID(null)
      },
      onError: function (error) {
        toast.error(HttpError(error).message || '取消失败')
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title="额度"
        hint="平台模型按 UTC 日窗计 token；本地模型、自备密钥的模型不占配额。"
        action={
          <RefreshButton
            isFetching={quotaQuery.isFetching}
            label={stampText ? `刷新 · ${stampText}` : '刷新'}
            onRefresh={function () {
              void refreshQuota()
            }}
          />
        }>
        {quotaQuery.isPending ? (
          <div className="flex flex-col gap-2 py-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-64" />
          </div>
        ) : null}

        {quotaQuery.isError ? (
          <div className="flex items-center justify-between gap-4 py-3.5">
            <span className="text-destructive text-sm">
              {`配额读取失败：${HttpError(quotaQuery.error).message}`}
            </span>
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

        {quota && view ? (
          <>
            <SettingRow
              label="计费归属"
              hint="平台模型的用量记在这上面，服务端按它记账。"
              control={
                <span className="text-muted-foreground font-mono text-xs">
                  {findScopeText(quota)}
                </span>
              }
            />
            <SettingRow
              label="配额来源"
              hint="单模型的 dailyTokenQuota 会顶掉档位；没有订阅就是免费档，没有租户身份走全局兜底。"
              control={
                <Badge variant={view.fromModel ? 'default' : 'secondary'}>
                  {view.plan ? `${view.sourceLabel} · ${view.plan}` : view.sourceLabel}
                </Badge>
              }
            />
            <SettingRow
              label="日配额上限"
              hint="UTC 零点重置；触顶后平台模型的新请求会被服务端拒绝。"
              control={
                <span className="text-sm tabular-nums">{formatTokens(view.limit)} tokens</span>
              }
            />
            <SettingRow
              label="今日已用"
              hint="服务端日窗计数，与拦截判定用的是同一份数字。"
              control={
                <span className="text-sm tabular-nums">{formatTokens(view.used)} tokens</span>
              }
            />
            <SettingRow
              label="重置时刻"
              hint="按 UTC 零点滚动，显示为本地时间。"
              control={
                <span className="text-muted-foreground text-xs tabular-nums">
                  {formatDateTime(view.resetsAt)}
                </span>
              }
            />
            <div className="flex flex-col gap-1.5 py-2.5">
              <Progress value={view.percent} />
              <span className="text-muted-foreground text-xs leading-relaxed">
                {`${view.percent}% · 剩余 ${formatTokens(view.remaining)} tokens`}
                {view.exhausted ? ' · 配额已用尽，平台模型暂不可用' : ''}
                {stampText ? ` · ${stampText}` : ''}
              </span>
            </div>
          </>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title="订阅"
        hint="订阅立即生效，并顶掉该租户仍生效的旧订阅；取消后配额立刻回落免费档。">
        {activeTenant.isError ? (
          <div className="py-3.5 text-sm text-destructive">租户信息加载失败，读不到订阅状态</div>
        ) : null}

        {!activeTenant.isError && !activeTenant.tenant ? (
          <div className="py-3.5 text-sm text-muted-foreground">
            当前账号没有个人租户，额度按账号 / 全局配额计算，没有可单独开通的档位。
          </div>
        ) : null}

        {activeTenant.tenant ? (
          <SettingRow
            label="生效订阅"
            hint="取消后配额立刻回落免费档，已用掉的 token 不退还；已有对话不受影响。"
            control={
              <div className="flex items-center gap-3">
                <span className="text-sm">
                  {subscriptionsQuery.isPending
                    ? '读取中…'
                    : active
                      ? `${active.plan} · ${active.expiresAt === null ? '永久有效' : formatDateTime(active.expiresAt)}`
                      : '无（免费档）'}
                </span>
                {active ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={function () {
                      updateRemovingID(active.id)
                    }}>
                    <Icon icon="lucide:trash" />
                    取消订阅
                  </Button>
                ) : null}
              </div>
            }
          />
        ) : null}
      </SettingsSection>

      <SettingsSection
        title="购买档位"
        hint={
          plansQuery.data
            ? `价格与生效时长由服务端定价（免费档基线 ${formatTokens(plansQuery.data.freeDailyTokenQuota)} tokens/天），付款成功后才开通。`
            : '价格与生效时长由服务端定价，付款成功后才开通。'
        }>
        {!activeTenant.tenant && !activeTenant.isLoading ? (
          <div className="text-muted-foreground py-3.5 text-sm">
            当前账号还没有租户身份，平台模型按账号 / 全局配额计算，没有可购买的档位。
          </div>
        ) : null}

        {catalogQuery.isPending && activeTenant.tenant ? (
          <Skeleton className="my-3 h-9 w-full" />
        ) : null}

        {catalogQuery.isError ? (
          <div className="flex items-center justify-between gap-4 py-3.5">
            <span className="text-destructive text-sm">
              {`档位目录读取失败：${HttpError(catalogQuery.error).message}`}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={function () {
                void catalogQuery.refetch()
              }}>
              重试
            </Button>
          </div>
        ) : null}

        {catalog && catalog.plans.length === 0 ? (
          <div className="text-muted-foreground py-3.5 text-sm leading-relaxed">
            服务端还没配置可售档位（pay.plans 为空），目前只有免费档可用。
          </div>
        ) : null}

        {catalog
          ? catalog.plans.map(function (plan) {
              const current = (catalog.currentPlan ?? (active ? active.plan : null)) === plan.plan

              return (
                <div
                  key={plan.plan}
                  className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium">{plan.label || plan.plan}</span>
                    <span className="text-muted-foreground text-xs leading-relaxed">
                      {describePlan(plan)}
                      {plan.purchasable ? '' : ` · ${plan.reason ?? '暂不可购买'}`}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {current ? <Badge variant="secondary">当前档位</Badge> : null}

                    {!current && plan.purchasable ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={function () {
                          updateCheckoutPlan(plan.plan)
                        }}>
                        去支付
                      </Button>
                    ) : null}

                    {admin && !current ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={subscribe.isPending || !tenantID}
                        onClick={function () {
                          grantPlan(plan.plan)
                        }}>
                        直接开通
                      </Button>
                    ) : null}
                  </div>
                </div>
              )
            })
          : null}
      </SettingsSection>

      <SettingsSection
        title="订单历史"
        hint="服务端只返回最近若干笔；支付结果以服务端核销为准，回调丢失时可以进收银台手动查单。">
        {!tenantID && !activeTenant.isLoading ? (
          <div className="text-muted-foreground py-3.5 text-sm">没有租户身份，查不到订单。</div>
        ) : null}

        {tenantID && ordersQuery.isPending ? <TableLoading label="读取订单…" /> : null}

        {ordersQuery.isError ? (
          <div className="flex items-center justify-between gap-4 py-3.5">
            <span className="text-destructive text-sm">
              {`订单读取失败：${HttpError(ordersQuery.error).message}`}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={function () {
                void ordersQuery.refetch()
              }}>
              重试
            </Button>
          </div>
        ) : null}

        {ordersQuery.isSuccess && tenantID ? (
          <div className="py-3">
            <DataTable
              columns={orderColumns}
              rows={orders}
              rowKey={function (row) {
                return row.orderNo
              }}
              empty="还没有支付订单。"
            />
          </div>
        ) : null}
      </SettingsSection>

      {tenantID && catalog ? (
        <CheckoutDialog
          tenantID={tenantID}
          catalog={catalog}
          planName={checkoutPlan}
          onOpenChange={function (open) {
            if (!open) updateCheckoutPlan(null)
          }}
        />
      ) : null}

      <Dialog
        open={removingID !== null}
        onOpenChange={function (open) {
          if (!open && !cancel.isPending) updateRemovingID(null)
        }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>取消订阅</DialogTitle>
            <DialogDescription>
              {active
                ? `取消「${active.plan}」后配额立刻回落免费档，已用掉的 token 不会退还。`
                : '取消后配额立刻回落免费档。'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={cancel.isPending}
              onClick={function () {
                updateRemovingID(null)
              }}>
              再想想
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={cancel.isPending}
              onClick={removeActive}>
              取消订阅
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
