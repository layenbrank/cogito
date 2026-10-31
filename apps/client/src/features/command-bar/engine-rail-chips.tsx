import { Button } from '@cogito/design/components/button'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import * as m from 'motion/react-m'

import type { RefObject } from 'react'

import { ENGINES } from '@/constants/engine'

interface EngineRailChipsProps {
  chipsRef: RefObject<HTMLDivElement | null>
  engineKey: string
  isExpanded: boolean
  chipsFade: object
  onChoose: (key: string) => void
  onExpand: (open: boolean) => void
}

function EngineRailChips(props: EngineRailChipsProps) {
  return (
    <m.div
      ref={props.chipsRef}
      className="absolute top-0.5 left-0.5 flex h-7 min-w-max items-center gap-0"
      role="listbox"
      aria-hidden={!props.isExpanded}
      aria-label="选择搜索引擎"
      initial={false}
      animate={{ opacity: props.isExpanded ? 1 : 0 }}
      transition={props.chipsFade}
      style={{ pointerEvents: props.isExpanded ? 'auto' : 'none' }}>
      {ENGINES.map(function (item) {
        const isActive = item.key === props.engineKey
        return (
          <Button
            key={item.key}
            type="button"
            variant="ghost"
            size="sm"
            role="option"
            tabIndex={props.isExpanded ? 0 : -1}
            aria-selected={isActive}
            className={cn(
              'h-full gap-1 rounded-full px-2 text-xs',
              isActive
                ? 'bg-background text-foreground shadow-sm hover:bg-background'
                : 'text-muted-foreground hover:bg-transparent hover:text-foreground'
            )}
            onMouseDown={function (event) {
              event.preventDefault()
            }}
            onClick={function () {
              props.onChoose(item.key)
              props.onExpand(false)
            }}>
            <Icon
              icon={item.icon}
              aria-hidden
              className="size-3.5 shrink-0"
            />
            <span className="whitespace-nowrap">{item.label}</span>
          </Button>
        )
      })}
    </m.div>
  )
}

export { EngineRailChips }
