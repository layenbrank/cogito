/**
 * 引擎切换：横向宽度展开；收起/展开圆角与外壳贴合
 */
import { Button } from '@cogito/design/components/button'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import * as m from 'motion/react-m'

import { ENGINES } from '@/constants/engine'
import { EngineRailChips } from '@/features/command-bar/engine-rail-chips.tsx'
import { useEngineRailMotion } from '@/features/command-bar/use-engine-rail-motion.ts'
import { COLLAPSED_PX } from '@/features/command-bar/use-engine-rail-width.ts'

interface EngineRailProps {
  engineKey: string
  isExpanded: boolean
  isShellOpen?: boolean
  onExpand: (open: boolean) => void
  onChoose: (key: string) => void
}

function EngineRail(props: EngineRailProps) {
  const isShellOpen = props.isShellOpen ?? false
  const motion = useEngineRailMotion(isShellOpen, props.isExpanded)

  const active =
    ENGINES.find(function (item) {
      return item.key === props.engineKey
    }) ?? ENGINES[0]

  return (
    <div
      className="relative h-8 shrink-0 self-center overflow-hidden"
      style={{ width: props.isExpanded ? motion.expandedWidth : COLLAPSED_PX }}>
      <m.div
        className={cn(
          'relative h-full p-0.5',
          'transition-colors',
          props.isExpanded ? 'bg-muted/60' : 'bg-transparent',
          motion.radius
        )}
        style={{
          width: motion.expandedWidth,
          transformOrigin: 'left center',
          transitionDuration: `${motion.railMs}ms`
        }}
        initial={false}
        animate={{ scaleX: props.isExpanded ? 1 : motion.collapsedScale }}
        transition={motion.widthTransition}>
        <m.div
          className="absolute top-0.5 left-0.5 z-[1]"
          initial={false}
          animate={{ opacity: props.isExpanded ? 0 : 1 }}
          transition={motion.iconFade}
          style={{ pointerEvents: props.isExpanded ? 'none' : 'auto' }}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tabIndex={props.isExpanded ? -1 : 0}
            aria-hidden={props.isExpanded}
            aria-label={`搜索引擎：${active.label}`}
            aria-expanded={props.isExpanded}
            title={active.label}
            className={cn(
              'size-7 text-muted-foreground hover:bg-muted hover:text-foreground',
              isShellOpen ? 'rounded-md' : 'rounded-full'
            )}
            onClick={function () {
              props.onExpand(true)
            }}>
            <Icon
              icon={active.icon}
              aria-hidden
              className="size-4"
            />
          </Button>
        </m.div>

        <EngineRailChips
          chipsRef={motion.chipsRef}
          engineKey={props.engineKey}
          isExpanded={props.isExpanded}
          chipsFade={motion.chipsFade}
          onChoose={props.onChoose}
          onExpand={props.onExpand}
        />
      </m.div>
    </div>
  )
}

export { EngineRail }
