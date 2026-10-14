import { clsx } from 'clsx'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import {
  useCallback,
  useState,
  type CompositionEvent,
  type KeyboardEvent,
  type MouseEvent,
  type SyntheticEvent
} from 'react'

import { useResize } from '@/hooks/useResize'

import '@/components/combobox/combobox.scss'

/* React 19 起 `FormEvent` 已弃用（它并不真实存在），input 事件用 SyntheticEvent 即可 */
type onUpdateEvent = (
  value: string,
  domStringified: string,
  event: SyntheticEvent<HTMLInputElement>
) => void

interface ComboboxProps {
  ref?: React.Ref<HTMLDivElement>
  value?: string
  placeholder?: string
  className?: string
  offset?: number
  classNames?: {
    root?: string
    trigger?: string
    section?: string
  }
  prefix?: React.ReactNode
  suffix?: React.ReactNode
  section: React.ReactNode
  visible?: boolean
  onUpdate?: onUpdateEvent
  onClick?: (event: MouseEvent<HTMLDivElement>) => void
}

function Provider(props: ComboboxProps) {
  const [offsetY, updateOffsetY] = useState(0)
  const [isComposing, onUpdateComposing] = useState(false)
  const ResizableRef = useResize<HTMLDivElement>(function (value) {
    updateOffsetY(value.height)
  })

  const { ref: propsRef } = props
  const setRef = useCallback(
    function (node: HTMLDivElement | null) {
      ;(ResizableRef).current = node
      if (typeof propsRef === 'function') {
        propsRef(node)
      } else if (propsRef) {
        ;(propsRef).current = node
      }
    },
    [ResizableRef, propsRef]
  )

  function onUpdate(event: SyntheticEvent<HTMLInputElement>) {
    if (isComposing) return

    const target = event.currentTarget
    const value = target.value ?? ''
    const DOMStringified = target.innerHTML ?? ''

    props.onUpdate?.(value, DOMStringified, event)
  }

  function onCompositionBegin() {
    onUpdateComposing(true)
  }

  function onCompositionFinal(event: CompositionEvent<HTMLInputElement>) {
    const target = event.currentTarget
    onUpdateComposing(function () {
      return false
    })
    // 输入法输入结束后，获取最终内容并触发更新
    const value = target.value ?? ''
    const DOMStringified = target.innerHTML ?? ''

    props.onUpdate?.(value, DOMStringified, event)
  }

  function onRootKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!props.onClick) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    props.onClick(event as unknown as MouseEvent<HTMLDivElement>)
  }

  return (
    <div
      role={props.onClick ? 'button' : undefined}
      tabIndex={props.onClick ? 0 : undefined}
      onClick={props.onClick}
      onKeyDown={props.onClick ? onRootKeyDown : undefined}
      ref={setRef}
      style={{
        // '--combobox-height': `${DOMRect?.height ?? 0}px`,
        '--combobox-section-offset': `${props.offset ?? offsetY}px`
      }}
      className={clsx([
        'combobox',
        props.className,
        props.classNames?.root,
        {
          'is-active': props.visible
        }
      ])}>
      <div
        data-region="false"
        className={clsx(['combobox-composer'])}>
        {props.prefix}
        <input
          type="text"
          onInput={onUpdate}
          value={props.value}
          placeholder={props.placeholder}
          onCompositionEnd={onCompositionFinal}
          onCompositionStart={onCompositionBegin}
          className={clsx(['combobox-trigger', props.classNames?.trigger])}
        />
        {props.suffix}
      </div>
      <AnimatePresence>
        {props.visible && (
          <m.div
            key="combobox-section" // 必须设置key，用于识别组件身份
            initial={{
              opacity: 0,
              scaleY: 0.6, // 从 0.6 而不是 0，减少“突然出现”感
              y: -4
            }}
            animate={{
              opacity: 1,
              scaleY: 1,
              y: 0
            }}
            exit={{
              opacity: 0,
              scaleY: 0.85, // exit 时不要缩得太小，更优雅
              y: -2
            }}
            transition={{
              duration: 0.26,
              ease: [0.22, 1, 0.36, 1]
            }}
            style={{ transformOrigin: 'top' }}
            className={clsx(['combobox-section', props.classNames?.section])}>
            {props.section}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}

interface SeriesOption {
  label: string
  value: string
  key: string
  mark?: React.ReactNode
}

interface SeriesProps {
  options: SeriesOption[]
  single?: (option: SeriesOption) => React.ReactNode
}

function Series(props: SeriesProps) {
  return (
    <div className="combobox-series">
      {props.options.map(function (option) {
        return (
          <div
            key={option.key}
            datatype={option.value}
            className="combobox-fragment">
            {props.single?.(option) ?? (
              <Rollback.Fragment
                label={option.label}
                value={option.value}
                mark={option.mark}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

interface FragmentProps {
  label: string
  value: string
  mark: React.ReactNode
}

const Rollback = {
  Fragment(option: FragmentProps) {
    return (
      <>
        {option.mark}
        <span> {option.label} </span>
      </>
    )
  }
}

export { Provider, Series, type ComboboxProps, type SeriesOption, type SeriesProps }
