import { cn } from 'cn'
import type { ReactNode } from 'react'

interface FooterActionProps {
  children: ReactNode
  disabled?: boolean
  onClick: () => void
}

function FooterAction(props: FooterActionProps) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      className={cn(
        'rounded-md px-2 py-1 text-xs font-medium text-primary',
        'transition-[background-color,color] duration-150',
        'hover:bg-primary/10 active:bg-primary/15',
        'disabled:pointer-events-none disabled:opacity-40'
      )}
      onClick={props.onClick}>
      {props.children}
    </button>
  )
}

interface PickerFooterProps {
  allowClear?: boolean
  showNow?: boolean
  nowLabel?: string
  hasValue?: boolean
  nowDisabled?: boolean
  showConfirm?: boolean
  confirmDisabled?: boolean
  onClear?: () => void
  onNow?: () => void
  onConfirm?: () => void
}

function PickerFooter(props: PickerFooterProps) {
  const allowClear = props.allowClear !== false
  const showNow = props.showNow !== false

  return (
    <div className="flex items-center justify-between gap-2 border-t border-border/70 px-2 py-1.5">
      <div className="flex items-center gap-1">
        {allowClear ? (
          <FooterAction
            disabled={!props.hasValue}
            onClick={function () {
              props.onClear?.()
            }}>
            清除
          </FooterAction>
        ) : null}
        {showNow ? (
          <FooterAction
            disabled={props.nowDisabled}
            onClick={function () {
              props.onNow?.()
            }}>
            {props.nowLabel ?? '今天'}
          </FooterAction>
        ) : null}
      </div>
      {props.showConfirm ? (
        <FooterAction
          disabled={props.confirmDisabled}
          onClick={function () {
            props.onConfirm?.()
          }}>
          确定
        </FooterAction>
      ) : (
        <span />
      )}
    </div>
  )
}

export { PickerFooter }
