import { Icon } from '@iconify/react/offline'
import { Avatar, AvatarFallback, AvatarImage } from '@i-thinking/design/components/avatar'
import { Button } from '@i-thinking/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@i-thinking/design/components/dropdown-menu'
import { toast } from 'sonner'

import styles from './sidebar.module.scss'

interface SidebarProfileBarProps {
  displayName: string
  avatarUrl?: string | null
  onOpenSettings: () => void
}

function SidebarProfileBar(props: SidebarProfileBarProps) {
  return (
    <div className={`${styles.profile} flex items-center justify-between gap-2`}>
      <div className={`${styles.profileUser} flex items-center gap-2`}>
        <Avatar size="sm">
          {props.avatarUrl ? (
            <AvatarImage
              src={props.avatarUrl}
              alt={props.displayName}
            />
          ) : null}
          <AvatarFallback>
            <Icon
              icon="lucide:user"
              className="size-3.5"
            />
          </AvatarFallback>
        </Avatar>
        <span className={styles.profileName}>{props.displayName}</span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="设置"
              className={styles.profileSettings}
            />
          }>
          <Icon
            icon="lucide:settings"
            width={16}
            height={16}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          className="w-40">
          <DropdownMenuItem onClick={props.onOpenSettings}>
            <Icon
              icon="lucide:settings"
              width={14}
              height={14}
            />
            设置
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Icon
                icon="lucide:palette"
                width={14}
                height={14}
              />
              外观
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem disabled>主题</DropdownMenuItem>
              <DropdownMenuItem disabled>明暗模式</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={function () {
              toast.info('i-thinking Agent')
            }}>
            <Icon
              icon="lucide:info"
              width={14}
              height={14}
            />
            关于
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export { SidebarProfileBar }
