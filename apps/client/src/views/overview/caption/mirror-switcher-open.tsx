import { Button } from '@cogito/design/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@cogito/design/components/popover'
import { Spinner } from '@cogito/design/components/spinner'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@cogito/design/components/tooltip'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import type { KeyboardEvent } from 'react'

import type { useMirrorStore } from '@/stores/mirror.ts'

type MirrorRow = ReturnType<typeof useMirrorStore.getState>['mirrors'][number]
import styles from '@/views/overview/caption/caption.module.scss'
import { findAccent, findMirrorIcon } from '@/views/overview/caption/mirror-utils'
import { MirrorSwitcherList } from '@/views/overview/caption/mirror-switcher-list.tsx'

interface MirrorSwitcherOpenProps {
  active: MirrorRow
  isCompact?: boolean
  menuSide?: 'top' | 'bottom'
  isBusy: boolean
  isOpen: boolean
  sorted: MirrorRow[]
  activeID: string | undefined
  cursor: number
  onOpenChange: (open: boolean) => void
  onCursor: (index: number) => void
  onSwitch: (id: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  onCreate: () => void
  onOpenManage: () => void
}

function MirrorSwitcherOpen(props: MirrorSwitcherOpenProps) {
  const label = props.active.description
    ? `${props.active.title}：${props.active.description}`
    : props.active.title
  const accent = findAccent(props.active.background)

  return (
    <Popover
      open={props.isOpen}
      onOpenChange={props.onOpenChange}>
      <Tooltip>
        <PopoverTrigger
          render={
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size={props.isCompact ? 'icon' : 'sm'}
                  data-region="false"
                  className={cn(
                    styles.mirrorTrigger,
                    props.isCompact
                      ? 'size-9 min-w-9 rounded-lg p-0 [&_svg]:size-4'
                      : 'w-full justify-start',
                    props.isCompact && accent && styles.mirrorTriggerTint,
                    props.isOpen && styles.mirrorTriggerOpen
                  )}
                  style={props.isCompact && accent ? { backgroundColor: accent } : undefined}
                  aria-label={`镜像：${label}`}
                  aria-busy={props.isBusy || undefined}
                  disabled={props.isBusy}
                />
              }
            />
          }>
          {props.isBusy ? (
            <Spinner className="size-3.5" />
          ) : (
            <Icon
              icon={findMirrorIcon(props.active.mark)}
              className={styles.mirrorTriggerIcon}
              aria-hidden
            />
          )}
          {props.isCompact ? null : (
            <>
              <span className={styles.mirrorPage}>{props.active.index + 1}</span>
              <span className={styles.mirrorName}>{props.active.title}</span>
              <Icon
                icon="lucide:chevron-down"
                className={cn(styles.mirrorChevron, props.isOpen && styles.mirrorChevronOpen)}
                aria-hidden
              />
            </>
          )}
        </PopoverTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>

      <PopoverContent
        align="start"
        side={props.menuSide ?? 'bottom'}
        sideOffset={6}
        className={cn(styles.mirrorList, 'gap-0 overflow-hidden p-0')}
        onKeyDown={props.onKeyDown}>
        <MirrorSwitcherList
          sorted={props.sorted}
          activeID={props.activeID}
          cursor={props.cursor}
          onCursor={props.onCursor}
          onSwitch={props.onSwitch}
          onClose={function () {
            props.onOpenChange(false)
          }}
          onCreate={props.onCreate}
          onOpenManage={props.onOpenManage}
        />
      </PopoverContent>
    </Popover>
  )
}

export { MirrorSwitcherOpen }
