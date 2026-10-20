/**
 * 标题栏的账号入口：未登录是「登录」按钮，已登录是头像菜单。
 *
 * 资料编辑统一走全局设置「账号」分区；登录弹窗仍由主窗口持有（`ReSignIn`）。
 */
import { Avatar, AvatarFallback, AvatarImage } from '@i-thinking/design/components/avatar'
import { Button } from '@i-thinking/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@i-thinking/design/components/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@i-thinking/design/components/tooltip'
import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'

import { openSettingsWindow } from '@/features/window/open-settings'
import { useSessionStore } from '@/stores/session.ts'
import styles from '@/views/overview/caption/caption.module.scss'
import { SECTION } from '@/views/settings/constant'

interface CaptionAccountProps {
  onSignIn: () => void
  /** 侧栏收起时只留图标 */
  isIcon?: boolean
  /** 侧栏展开时拉满一行 */
  isWide?: boolean
}

function CaptionAccount(props: CaptionAccountProps) {
  const user = useSessionStore(function (state) {
    return state.user
  })
  const toSignOut = useSessionStore(function (state) {
    return state.toSignOut
  })

  if (!user) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size={props.isIcon ? 'icon' : 'sm'}
              data-region="false"
              className={clsx(
                props.isIcon && 'size-10 min-w-10 rounded-full [&_svg]:size-4.5',
                !props.isIcon && styles.accountSignIn,
                props.isWide && 'w-full justify-start'
              )}
              aria-label="登录"
              onClick={props.onSignIn}
            />
          }>
          <Icon
            icon="lucide:user"
            aria-hidden
          />
          {props.isIcon ? null : '登录'}
        </TooltipTrigger>
        <TooltipContent side="bottom">登录</TooltipContent>
      </Tooltip>
    )
  }

  const initial = user.username.slice(0, 1).toUpperCase()

  return (
    <DropdownMenu>
      <Tooltip>
        <DropdownMenuTrigger
          render={
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  data-region="false"
                  className="size-10 min-w-10 overflow-hidden rounded-full p-0"
                  aria-label={`已登录：${user.username}`}
                />
              }
            />
          }>
          <Avatar className={clsx(styles.accountAvatar, 'size-full')}>
            {user.avatarUrl ? (
              <AvatarImage
                src={user.avatarUrl}
                alt={user.username}
              />
            ) : null}
            <AvatarFallback className="bg-transparent text-xs font-semibold text-primary">
              {initial}
            </AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <TooltipContent side="bottom">{user.username}</TooltipContent>
      </Tooltip>

      <DropdownMenuContent
        align="end"
        className="min-w-44">
        {/* 标签必须包在 Group 里：design 的 Label 是 base-ui 的 GroupLabel，脱离 Group 会抛 MenuGroupContext is missing */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate text-xs font-medium">
            {user.username}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={function () {
            void openSettingsWindow(SECTION.ACCOUNT)
          }}>
          <Icon
            icon="lucide:user-round"
            aria-hidden
          />
          账号设置
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={function () {
            void openSettingsWindow(SECTION.APPEARANCE)
          }}>
          <Icon
            icon="lucide:palette"
            aria-hidden
          />
          外观
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={toSignOut}>
          <Icon
            icon="lucide:log-out"
            aria-hidden
          />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { CaptionAccount }
