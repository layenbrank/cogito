import { Button } from '@cogito/design/components/button'
import { Spinner } from '@cogito/design/components/spinner'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@cogito/design/components/tooltip'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'

import styles from '@/views/overview/caption/caption.module.scss'
import { MirrorManageDialog } from '@/views/overview/caption/mirror-manage'

interface MirrorSwitcherCreateProps {
  isCompact?: boolean
  isBusy: boolean
  isManageOpen: boolean
  onCreate: () => void
  onManageOpenChange: (open: boolean) => void
}

function MirrorSwitcherCreate(props: MirrorSwitcherCreateProps) {
  return (
    <>
      <Tooltip>
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
                  : 'w-full justify-start'
              )}
              aria-label="新建镜像"
              disabled={props.isBusy}
              onClick={props.onCreate}
            />
          }>
          {props.isBusy ? (
            <Spinner className="size-3.5" />
          ) : (
            <Icon
              icon="lucide:plus"
              aria-hidden
            />
          )}
          {props.isCompact ? null : '新建镜像'}
        </TooltipTrigger>
        <TooltipContent side="bottom">新建镜像</TooltipContent>
      </Tooltip>
      <MirrorManageDialog
        open={props.isManageOpen}
        onOpenChange={props.onManageOpenChange}
      />
    </>
  )
}

export { MirrorSwitcherCreate }
