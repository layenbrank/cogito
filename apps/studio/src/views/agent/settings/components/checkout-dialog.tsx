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
import { Separator } from '@cogito/design/components/separator'
import { Spinner } from '@cogito/design/components/spinner'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import type { PaymentCatalog, PaymentChannel } from '@/apis/payment.ts'
import {
  describePlan,
  findChannelLabel,
  findDefaultChannel,
  findOrderStatusLabel,
  formatCountdown,
  isOrderClosed,
  isOrderPaid,
  isOrderPending,
  sortChannels
} from '@/features/payment/checkout.ts'
import {
  useCloseOrder,
  useCreateOrder,
  usePaymentOrder,
  useSyncOrder
} from '@/features/payment/orders.ts'
import { HttpError } from '@/utils/http.errors.ts'

/**
 * 收银台：档位 → 渠道 → 扫码 → 核销。
 *
 * 三条不可动摇的规则（对应 `services/payment`）：
 * 1. **价格来自服务端**：这里只展示 `catalog` 里的金额，客户端没有改价的口子；
 * 2. **付款不等于开通**：开通发生在服务端验签并核对金额之后，所以界面等的不是「用户点了确认」，
 *    而是订单状态真的变成 `PAID`；
 * 3. **渠道不可用就不给按钮**：没配好凭据的渠道显示原因并置灰，不摆一个点不动的假二维码。
 *
 * 状态推进只有两个来源：轮询（快）与 `sync`（兜底 —— 回调丢了真去上游查单）。倒计时结束不代表
 * 订单失效，只是不再自动问了，服务端会在下次查单时惰性关单。
 */

const QR_SIZE = 180

/**
 * 收银台里跟「当前档位」绑定的状态：选了哪个渠道、下了哪笔单。
 *
 * 它们都随档位一起记录，切换档位时旧值自然不再成立（见下面的 `live`），所以不需要再用一个
 * effect 去「清空状态」；关闭时在事件里清一次即可。
 */
interface CheckoutSession {
  plan: string | null
  channel: string | null
  orderNo: string | null
}

const EMPTY_SESSION: CheckoutSession = { plan: null, channel: null, orderNo: null }

interface CheckoutDialogProps {
  tenantID: string
  catalog: PaymentCatalog
  /** 要买的档位名；null = 收起 */
  planName: string | null
  onOpenChange: (open: boolean) => void
}

export function CheckoutDialog(props: CheckoutDialogProps) {
  const open = props.planName !== null
  const plan =
    props.catalog.plans.find(function (item) {
      return item.plan === props.planName
    }) ?? null

  const [session, updateSession] = useState<CheckoutSession>(EMPTY_SESSION)
  const [now, updateNow] = useState(Date.now)

  /** 当前档位下的有效状态；档位变了就退回空状态 */
  const live = session.plan === props.planName ? session : EMPTY_SESSION
  const activeChannel = live.channel ?? findDefaultChannel(props.catalog.channels)

  const create = useCreateOrder(props.tenantID)
  const order = usePaymentOrder(props.tenantID, live.orderNo)
  const sync = useSyncOrder(props.tenantID)
  const close = useCloseOrder(props.tenantID)

  /** 写状态时一并写上当前档位，换档位后旧值自动失效 */
  function patchSession(next: Partial<CheckoutSession>) {
    updateSession({ plan: props.planName, channel: live.channel, orderNo: live.orderNo, ...next })
  }

  /** 关闭收银台时把这一单从界面状态里摘掉，下次打开是干净的一单 */
  function handleOpenChange(next: boolean) {
    if (!next) updateSession(EMPTY_SESSION)
    props.onOpenChange(next)
  }

  useEffect(
    function () {
      if (!open) return
      const timer = window.setInterval(function () {
        updateNow(Date.now())
      }, 1000)
      return function () {
        window.clearInterval(timer)
      }
    },
    [open]
  )

  const current = order.data ?? null
  const channels = sortChannels(props.catalog.channels)
  const paid = current !== null && isOrderPaid(current)
  const pending = current !== null && isOrderPending(current)
  const expired = pending && now >= current.orderExpiresAt
  const dead = current !== null && !paid && !pending
  const countdown = current ? formatCountdown(current.orderExpiresAt, now) : ''

  function startPayment() {
    if (!plan || !activeChannel) return
    create.mutate(
      { plan: plan.plan, channel: activeChannel as PaymentChannel },
      {
        onSuccess: function (item) {
          patchSession({ orderNo: item.orderNo })
        },
        onError: function (error) {
          toast.error(HttpError(error).message || '下单失败')
        }
      }
    )
  }

  function refreshPayment() {
    if (!live.orderNo) return
    sync.mutate(live.orderNo, {
      onSuccess: function (item) {
        if (isOrderPaid(item)) toast.success('支付成功，配额已升级')
        else if (isOrderClosed(item)) toast.warning('订单已关闭，请重新下单')
        else toast.info('还没收到支付结果')
      },
      onError: function (error) {
        toast.error(HttpError(error).message || '查单失败')
      }
    })
  }

  function abortPayment() {
    if (!live.orderNo) return
    close.mutate(live.orderNo, {
      onSuccess: function () {
        toast.info('订单已关闭')
      },
      onError: function (error) {
        toast.error(HttpError(error).message || '关单失败')
      }
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{plan ? `购买「${plan.label || plan.plan}」` : '购买档位'}</DialogTitle>
          <DialogDescription>
            {paid
              ? '支付已完成，配额已按新档位生效。'
              : '付款在手机上完成，桌面端只等结果。支付成功由服务端验签后开通，中途关掉这个窗口不影响支付。'}
          </DialogDescription>
        </DialogHeader>

        {plan ? (
          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
            <span className="text-sm font-medium">{plan.plan}</span>
            <span className="text-muted-foreground text-xs">{describePlan(plan)}</span>
          </div>
        ) : null}

        {plan && !plan.purchasable ? (
          <p className="text-destructive text-xs leading-relaxed">
            {plan.reason ?? '该档位暂不可购买'}
          </p>
        ) : null}

        {current === null && plan && plan.purchasable ? (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium">选择支付方式</span>
            {channels.length === 0 ? (
              <p className="text-muted-foreground text-xs leading-relaxed">
                服务端还没配置任何支付渠道（`pay.channels`），暂时无法在线支付。
              </p>
            ) : null}
            {channels.map(function (item) {
              const selected = item.code === activeChannel
              return (
                <Button
                  key={item.code}
                  type="button"
                  variant="outline"
                  disabled={!item.enabled}
                  onClick={function () {
                    patchSession({ channel: item.code, orderNo: null })
                  }}
                  className={
                    'justify-between gap-3 px-3 py-2 text-left text-sm ' +
                    (selected && item.enabled ? 'border-primary bg-accent' : '')
                  }>
                  <span>{findChannelLabel(item.code)}</span>
                  {item.enabled ? (
                    selected ? (
                      <Badge variant="secondary">已选</Badge>
                    ) : null
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      {item.reason ?? '未配置'}
                    </span>
                  )}
                </Button>
              )
            })}
          </div>
        ) : null}

        {current ? (
          <div className="flex flex-col gap-3">
            <Separator />
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground font-mono">{current.orderNo}</span>
              <Badge variant={paid ? 'default' : pending ? 'secondary' : 'outline'}>
                {findOrderStatusLabel(current.status)}
              </Badge>
            </div>

            {pending ? (
              <div className="flex flex-col items-center gap-3 py-2">
                {current.codeUrl ? (
                  <div className="rounded-md bg-white p-3">
                    <QRCodeSVG
                      value={current.codeUrl}
                      size={QR_SIZE}
                      level="M"
                    />
                  </div>
                ) : (
                  <p className="text-muted-foreground px-2 text-center text-xs leading-relaxed">
                    渠道没有返回支付链接。点「刷新支付状态」重新向渠道要一次，或关掉重下单。
                  </p>
                )}
                <span className="text-muted-foreground text-xs">
                  {expired
                    ? '二维码已过期，请重新下单'
                    : `用${findChannelLabel(current.channel)}扫码付款 · 剩余 ${countdown}`}
                </span>
              </div>
            ) : null}

            {paid ? (
              <div className="flex items-center gap-2 py-2 text-sm">
                <Icon icon="lucide:circle-check" className="text-primary size-4" />
                已开通「{current.plan}」，当天配额即按新档位计算。
              </div>
            ) : null}

            {dead ? <p className="text-muted-foreground py-2 text-xs">该订单已结束。</p> : null}
          </div>
        ) : null}

        <DialogFooter className="sm:justify-between">
          <span className="text-muted-foreground text-xs">
            {props.catalog.orderTtlSecs > 0
              ? `订单 ${Math.round(props.catalog.orderTtlSecs / 60)} 分钟内有效，过期自动关单`
              : ''}
          </span>
          <div className="flex items-center gap-2">
            {pending ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={close.isPending}
                  onClick={abortPayment}>
                  取消订单
                </Button>
                <Button
                  type="button"
                  disabled={sync.isPending}
                  onClick={refreshPayment}>
                  {sync.isPending ? <Spinner /> : null}
                  刷新支付状态
                </Button>
              </>
            ) : null}

            {!current && plan ? (
              <Button
                type="button"
                disabled={create.isPending || !plan.purchasable || !activeChannel}
                onClick={startPayment}>
                {create.isPending ? <Spinner /> : null}
                去支付
              </Button>
            ) : null}

            {dead || (pending && expired) ? (
              <Button
                type="button"
                variant="outline"
                onClick={function () {
                  patchSession({ orderNo: null })
                }}>
                重新下单
              </Button>
            ) : null}

            {paid ? (
              <Button
                type="button"
                onClick={function () {
                  handleOpenChange(false)
                }}>
                知道了
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
