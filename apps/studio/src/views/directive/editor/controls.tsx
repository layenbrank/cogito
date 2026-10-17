import { Input } from '@i-thinking/design/components/input'
import { Label } from '@i-thinking/design/components/label'
import { Textarea } from '@i-thinking/design/components/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@i-thinking/design/components/tooltip'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import {
  cloneElement,
  isValidElement,
  useId,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'

/**
 * 侧栏与步骤表单共用的紧凑控件（Input / Textarea）。
 * Select 默认已走 design FIELD_SHELL（白底 + shadow-xs），Trigger 只需补 text-xs / w-full。
 */
const CONTROL_CLASS = 'h-8 rounded-lg bg-background text-xs text-foreground shadow-xs'

/**
 * 多行输入：固定最小高度，内容超出时在框内滚。
 * `field-sizing-fixed` 关掉 content 自适应，避免长文本把整卡撑爆。
 */
const TEXTAREA_CLASS =
  'field-sizing-fixed min-h-37.5 resize-none overflow-y-auto overscroll-auto rounded-lg bg-background text-xs text-foreground shadow-xs'

/** 步骤卡片外壳：与指令墙白卡同一套圆角 / 轻阴影 */
const STEP_CARD_CLASS =
  'gap-3 rounded-2xl border-border/70 py-3 shadow-xs transition-[border-color,box-shadow] duration-200 hover:border-border hover:shadow-sm'

/** 侧栏内嵌条目（输入声明 / 变量 / 触发器）；`@container` 给窄栏折行用 */
const ITEM_CARD_CLASS =
  '@container flex flex-col gap-2 rounded-xl border border-border/70 bg-background p-2.5'

interface FieldProps {
  label: string
  /** 悬停才出现的补充说明；关闭时卸载，不占文档流 */
  hint?: string
  required?: boolean
  children: ReactNode
  className?: string
}

interface SectionProps {
  icon: ReactNode
  title: string
  /** 标题旁补充说明，收进 tooltip，不挤标题行 */
  hint?: string
  count?: number
  /** 标题色块；不传则用中性灰 */
  tileClass?: string
  children: ReactNode
}

interface GlyphProps {
  icon: string
  className?: string
}

/** 离线 Iconify（mdi / ant-design / lucide 已在 renderer 注册）；默认对齐 Button 的 svg size-4 */
function Glyph(props: GlyphProps) {
  return (
    <Icon
      icon={props.icon}
      className={cn('size-4 shrink-0', props.className)}
    />
  )
}

/**
 * 说明气泡：打开才挂载 Content，关掉即销毁 ——
 * 上百张卡片/字段时别让 Portal 节点常驻。
 */
function HintTooltip(props: { hint: string; label: string }) {
  const [isOpen, updateOpen] = useState(false)

  return (
    <TooltipProvider delay={280}>
      <Tooltip
        open={isOpen}
        onOpenChange={updateOpen}>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full text-foreground/45 hover:text-foreground"
              aria-label={props.label}
              onPointerDown={function (event) {
                // 不抢焦点，避免 textarea 失焦
                event.preventDefault()
              }}>
              <Icon
                icon="mdi:information-outline"
                className="size-3.5"
              />
            </button>
          }
        />
        {isOpen ? (
          <TooltipContent
            side="top"
            className="max-w-64 text-left text-balance">
            {props.hint}
          </TooltipContent>
        ) : null}
      </Tooltip>
    </TooltipProvider>
  )
}

/** 内嵌条目卡顶行：左可放类型徽标，右放删除 / 必填等操作 */
interface ItemCardActionRowProps {
  leading?: ReactNode
  children: ReactNode
}

function ItemCardActionRow(props: ItemCardActionRowProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2',
        props.leading ? 'justify-between' : 'justify-end'
      )}>
      {props.leading}
      <div className="flex shrink-0 items-center gap-1">{props.children}</div>
    </div>
  )
}

function Field(props: FieldProps) {
  const fallbackId = useId()
  const child = props.children
  const canBind =
    isValidElement(child) &&
    (child.type === Input || child.type === Textarea || typeof child.type === 'string')
  const hasId = canBind ? (child.props as { id?: string }).id : undefined
  const controlId = hasId ?? fallbackId
  const control = canBind
    ? cloneElement(child as ReactElement<{ id?: string }>, { id: controlId })
    : child

  return (
    <div className={cn('flex min-w-0 flex-col gap-1', props.className)}>
      <span className="inline-flex h-4 min-w-0 items-center gap-1 text-xs font-medium tracking-wide text-foreground">
        {canBind ? (
          <Label
            htmlFor={controlId}
            className="truncate leading-none">
            {props.label}
          </Label>
        ) : (
          <span className="truncate leading-none">{props.label}</span>
        )}
        {props.required ? <span className="text-destructive">*</span> : null}
        {props.hint ? (
          <HintTooltip
            hint={props.hint}
            label={`${props.label} 说明`}
          />
        ) : null}
      </span>
      {control}
    </div>
  )
}

/**
 * 元信息分区：白卡浮在浅底上（对齐快捷指令「分组块」），标题用色块图标扫一眼认区。
 */
function Section(props: SectionProps) {
  return (
    <section className="flex flex-col rounded-2xl border border-border/60 bg-card shadow-xs">
      <header className="flex items-center gap-2 border-b border-border/40 px-3.5 py-2.5">
        <span
          className={cn(
            'inline-flex size-7 shrink-0 items-center justify-center rounded-lg [&_svg]:size-3.5',
            props.tileClass ?? 'bg-secondary text-secondary-foreground'
          )}>
          {props.icon}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-semibold tracking-tight text-foreground">
            {props.title}
          </span>
          {props.count !== undefined ? (
            <span className="rounded-full bg-secondary px-1.5 py-0.5 text-xs font-medium tabular-nums text-secondary-foreground">
              {props.count}
            </span>
          ) : null}
          {props.hint ? (
            <HintTooltip
              hint={props.hint}
              label={`${props.title} 说明`}
            />
          ) : null}
        </div>
      </header>
      <div className="flex flex-col gap-2.5 px-3.5 py-3">{props.children}</div>
    </section>
  )
}

export {
  CONTROL_CLASS,
  Field,
  Glyph,
  HintTooltip,
  ITEM_CARD_CLASS,
  ItemCardActionRow,
  Section,
  STEP_CARD_CLASS,
  TEXTAREA_CLASS
}
