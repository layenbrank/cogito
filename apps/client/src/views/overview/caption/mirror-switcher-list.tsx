import { Button } from '@cogito/design/components/button'
import { TooltipProvider } from '@cogito/design/components/tooltip'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import type { useMirrorStore } from '@/stores/mirror.ts'

type MirrorRow = ReturnType<typeof useMirrorStore.getState>['mirrors'][number]
import styles from '@/views/overview/caption/caption.module.scss'
import { DESC_TOOLTIP_DELAY } from '@/views/overview/caption/mirror-utils'
import { MirrorItemMain } from '@/views/overview/caption/mirror-item-main.tsx'

interface MirrorSwitcherListProps {
  sorted: MirrorRow[]
  activeID: string | undefined
  cursor: number
  onCursor: (index: number) => void
  onSwitch: (id: string) => void
  onClose: () => void
  onCreate: () => void
  onOpenManage: () => void
}

function MirrorSwitcherList(props: MirrorSwitcherListProps) {
  return (
    <TooltipProvider delay={DESC_TOOLTIP_DELAY}>
      <div
        role="listbox"
        aria-label="镜像"
        className={styles.mirrorOptions}
        data-scrollable={props.sorted.length > 6 ? 'true' : undefined}>
        {props.sorted.map(function (mirror, index) {
          const isActive = mirror.id === props.activeID
          const isCursor = index === props.cursor
          const description = mirror.description?.trim() ?? ''
          return (
            <div
              key={mirror.id}
              role="option"
              tabIndex={isCursor ? 0 : -1}
              aria-selected={isActive}
              data-cursor={isCursor ? 'true' : undefined}
              data-active={isActive ? 'true' : undefined}
              className={cn(styles.mirrorItem, isActive && styles.mirrorItemActive)}
              onMouseEnter={function () {
                props.onCursor(index)
              }}
              onKeyDown={function (event) {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                if (isActive) {
                  props.onClose()
                  return
                }
                props.onSwitch(mirror.id)
              }}>
              <MirrorItemMain
                index={mirror.index + 1}
                title={mirror.title}
                description={description}
                isActive={isActive}
                onSelect={function () {
                  if (isActive) {
                    props.onClose()
                    return
                  }
                  props.onSwitch(mirror.id)
                }}
              />
            </div>
          )
        })}
      </div>

      <div className={styles.mirrorActions}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-region="false"
          className={cn(styles.mirrorCreate, 'justify-start')}
          onClick={props.onCreate}>
          <Icon
            icon="lucide:plus"
            aria-hidden
          />
          新建镜像
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-region="false"
          className={cn(styles.mirrorManageEntry, 'justify-start')}
          onClick={props.onOpenManage}>
          <Icon
            icon="lucide:settings-2"
            aria-hidden
          />
          管理镜像
        </Button>
      </div>
    </TooltipProvider>
  )
}

export { MirrorSwitcherList }
