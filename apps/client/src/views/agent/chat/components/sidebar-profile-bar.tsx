import { Icon } from '@iconify/react/offline'
import { Avatar, AvatarFallback, AvatarImage } from '@cogito/design/components/avatar'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { SECTION } from '@/views/settings/constant'

import styles from './sidebar.module.scss'

interface SidebarProfileBarProps {
  displayName: string
  avatarUrl?: string | null
  onOpenSettings: (section?: string) => void
}

function SidebarProfileBar(props: SidebarProfileBarProps) {
  const navigate = useNavigate()

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
          <DropdownMenuItem
            onClick={function () {
              props.onOpenSettings()
            }}>
            <Icon
              icon="lucide:settings"
              width={14}
              height={14}
            />
            Agent 设置
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={function () {
              void navigate(`/settings?section=${SECTION.APPEARANCE}`)
            }}>
            <Icon
              icon="lucide:palette"
              width={14}
              height={14}
            />
            外观
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={function () {
              void navigate(`/settings?section=${SECTION.ACCOUNT}`)
            }}>
            <Icon
              icon="lucide:user-round"
              width={14}
              height={14}
            />
            账号
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={function () {
              toast.info('cogito Agent')
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
