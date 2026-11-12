/**
 * 输入区「思考强度」：和模型分开、常驻在 composer 里（对齐 VS Code Copilot）。
 *
 * 为什么不塞进模型浮层：切模型和切档位是两件事 —— 模型是「用谁」，
 * 档位是「这次让它想多久」，后者用户会频繁动。混在一个浮层里，
 * 每次调档位都要先打开模型列表，顺带把「用哪个模型」重新看一遍。
 *
 * 模型不支持思考（`canThink` 为假）时整块不渲染：宁可不出现，
 * 也不摆一个点了没反应的禁用项 —— 会让人以为是自己没配对。
 *
 * 浮层外观与「执行模式」弹框同一套（`approval-switch.module.scss`：无边框 + 软阴影壳 +
 * 图标/标题/说明/勾选四件套）：选中态靠行尾的勾，**不用 radio 圈** ——
 * 圆圈在菜单里既是单选记号又像未完成的空状态，和旁边真正的开关读起来像两种控件。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { cn } from 'cn'
import { useState } from 'react'

import { applyThinkingToOpenSessions } from '@/features/agent/acp/session'
import {
  canThink,
  findModelKey,
  THINKING_OPTIONS,
  useModelThinking,
  writeModelThinking
} from '@/features/agent/model/model-prefs'
import { useThinkingCapability } from '@/features/agent/model/thinking-capability'
import { resolveThinkingValue } from '@/features/agent/model/thinking-effort-map'
import type { ThinkingLevel } from '@/features/persist'
import { useProviderStore } from '@/stores/provider'

// 与执行模式 / 审批选择器共用同一个浮层壳（无边框 + 软阴影）
import styles from './approval-switch.module.scss'

/**
 * 档位 → 行首图标：和执行模式弹框一样，每行一个语义图标。
 * 「关」用断电、「极致」用火苗，档位高低一眼能排出来，不需要再画刻度。
 */
const LEVEL_ICONS: Record<ThinkingLevel, string> = {
  off: 'lucide:power-off',
  low: 'lucide:feather',
  medium: 'lucide:brain',
  high: 'lucide:zap',
  max: 'lucide:flame'
}

function ComposerThinking() {
  const activeProvider = useProviderStore(function (state) {
    return state.providers.find(function (provider) {
      return provider.id === state.activeProviderID && provider.enabled
    })
  })
  const [open, updateOpen] = useState(false)

  const providerID = activeProvider?.id ?? ''
  const model = activeProvider?.model?.trim() ?? ''
  const key = findModelKey(providerID, model)
  // 会话真给过 thinking 选项就以它为准；还没建过会话时才退回名字启发式
  const capability = useThinkingCapability(key)
  const supported = Boolean(providerID && model) && (capability ? true : canThink(model))

  /**
   * 订阅偏好本身，而不是自己存一份 draft：右栏仪表改的是同一档，
   * 以前这里不重渲染、按钮上还写着旧档位；现在两边同源，改一处两处一起变。
   */
  const selected = useModelThinking(providerID, model)
  const option =
    THINKING_OPTIONS.find(function (item) {
      return item.value === selected
    }) ?? THINKING_OPTIONS[0]
  /** 这一档到模型那儿会变成什么：菜单里如实写出来，避免「点了没差别」 */
  const dispatch = resolveThinkingValue(selected, capability?.values ?? null)

  if (!supported) return null

  function select(next: ThinkingLevel) {
    if (!providerID || !model) return
    // 与右栏仪表同一份偏好：写完之后广播，两边同时变。
    // 下发也一起做 —— 这一层刻意不挂 AUI 上下文（要能在单测 / 别的壳里渲染），
    // 拿不到 threadID，所以按模型推给它所有开着的会话。
    // 先等写完再下发：applyGooseThinking 读的就是这份偏好，差一个 tick 就会推上一档出去。
    void Promise.resolve(writeModelThinking(providerID, model, next)).then(function () {
      return applyThinkingToOpenSessions(providerID, model)
    })
  }

  const dispatchNote = capability
    ? `实际下发：${dispatch.value}${dispatch.degraded ? '（本模型没有这一档，落到了相邻档）' : ''}`
    : '发过一条消息后，这里会显示该模型实际接受哪些档位。'

  return (
    <DropdownMenu
      open={open}
      onOpenChange={updateOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`思考强度：${option.label}`}
            title={`思考强度：${option.label} · ${option.hint}`}
            className={cn(
              'text-muted-foreground h-7 shrink-0 gap-1 px-2 text-xs',
              // 关闭档给一点「没开」的视觉落差，但仍可点
              option.value === 'off' && 'opacity-70'
            )}
          />
        }>
        <Icon
          icon="lucide:brain"
          className="size-3.5 shrink-0"
        />
        {/* 窄的 composer 只留图标（title 里有全量说明），宽了再补档位名 */}
        <span className="hidden @min-[36rem]:inline">{option.label}</span>
        <Icon
          icon="lucide:chevrons-up-down"
          className="size-3 shrink-0 opacity-55"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={8}
        className={styles.surface}>
        {THINKING_OPTIONS.map(function (item) {
          const active = item.value === selected
          return (
            <DropdownMenuItem
              key={item.value}
              className={styles.row}
              onClick={function () {
                select(item.value)
              }}>
              <Icon
                icon={LEVEL_ICONS[item.value]}
                className={styles.icon}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={styles.label}>{item.label}</span>
                <span className={styles.hint}>{item.hint}</span>
              </span>
              {active ? (
                <Icon
                  icon="lucide:check"
                  className={styles.check}
                />
              ) : (
                <span className={styles.checkSlot} />
              )}
            </DropdownMenuItem>
          )
        })}

        {/* 与执行模式弹框的脚注同一位置同一字号：这里解释的是「你选的这档实际变成了什么」 */}
        <div className="border-border/70 mt-1 flex flex-col gap-1 border-t px-2 pt-2 pb-1">
          <p className="text-muted-foreground/80 text-[11px] leading-snug">{dispatchNote}</p>
          <p className="text-muted-foreground/80 text-[11px] leading-snug">
            档位越高，回答前推演越多、也越慢；按模型保存，换模型互不影响。
          </p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { ComposerThinking, LEVEL_ICONS }
