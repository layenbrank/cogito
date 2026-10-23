import { Icon } from '@iconify/react/offline'
import { Avatar, AvatarFallback } from '@cogito/design/components/avatar'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { useState } from 'react'

import { useAccountSession, useSignOut } from './session.ts'
import SignIn from '@/features/signin/signin.tsx'

interface AccountMenuProps {
  onOpenSettings: () => void
}

interface AccountMenuContentProps {
  /** 弹层朝向：触发按钮在底部时用 top，在标题栏时用 bottom */
  side: 'top' | 'bottom'
  align: 'start' | 'end'
  /** 未登录时的入口；弹窗归持有它的那一层 */
  onSignIn: () => void
  /** 本窗口有设置页才传：没有设置页就不该出现点了没反应的菜单项 */
  onOpenSettings?: () => void
}

/** 头像里的首字母占位；没登录就是人形图标 */
function AccountAvatar(props: { initials: string | null; className?: string }) {
  return (
    <Avatar
      size="sm"
      className={props.className}>
      <AvatarFallback className={props.initials ? 'text-xs font-medium' : undefined}>
        {props.initials ?? (
          <Icon
            icon="lucide:user"
            className="size-3.5"
          />
        )}
      </AvatarFallback>
    </Avatar>
  )
}

/**
 * 账号下拉的内容。左栏底部与主窗口标题栏共用同一份 —— 身份只有一个来源，
 * 菜单项也就不该各写一份（否则「退出登录」这类动作会随窗口各写各的）。
 *
 * 身份先取 JWT 里的 `username`、随后被 `GET /auth/profile` 覆盖（见 `features/account/identity.ts`），
 * 所以从登录到显示名字之间不会有「本地」这种假状态，也不会有加载闪烁。
 */
export function AccountMenuContent(props: AccountMenuContentProps) {
  const session = useAccountSession()
  const { signOut, isPending } = useSignOut()

  const identity = session.identity
  const detail = identity
    ? identity.detail
      ? `${identity.detail} · ${identity.roleLabel}`
      : identity.roleLabel
    : '资料暂时读不到'

  return (
    <DropdownMenuContent
      side={props.side}
      align={props.align}
      className="w-60">
      {session.token ? (
        <>
          <DropdownMenuLabel className="flex items-center gap-2 font-normal">
            <AccountAvatar initials={identity ? identity.initials : null} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-xs font-medium">{identity?.name ?? '已登录'}</span>
              <span className="text-muted-foreground truncate text-xs">{detail}</span>
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {props.onOpenSettings ? (
            <DropdownMenuItem onClick={props.onOpenSettings}>
              <Icon icon="lucide:settings" />
              设置
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            variant="destructive"
            disabled={isPending}
            onClick={signOut}>
            <Icon icon="lucide:log-out" />
            退出登录
          </DropdownMenuItem>
        </>
      ) : (
        <DropdownMenuItem onClick={props.onSignIn}>
          <Icon icon="lucide:log-in" />
          登录 cogito
        </DropdownMenuItem>
      )}
    </DropdownMenuContent>
  )
}

/** 左栏底部的账号区：未登录是登录入口，已登录是「身份 + 设置 + 退出登录」 */
export function AccountMenu(props: AccountMenuProps) {
  const session = useAccountSession()
  const [isSignInOpen, updateSignInOpen] = useState(false)

  const identity = session.identity
  const signedIn = Boolean(session.token)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto min-w-0 flex-1 justify-start gap-2 px-1 py-1"
              aria-label={signedIn ? '账号' : '登录'}
              title={signedIn ? (identity?.name ?? '账号') : '登录'}
            />
          }>
          <AccountAvatar initials={identity ? identity.initials : null} />
          <span className="truncate text-xs">{identity ? identity.name : '登录'}</span>
        </DropdownMenuTrigger>
        <AccountMenuContent
          side="top"
          align="start"
          onOpenSettings={props.onOpenSettings}
          onSignIn={function () {
            updateSignInOpen(true)
          }}
        />
      </DropdownMenu>

      <SignIn
        visible={isSignInOpen}
        onClose={function () {
          updateSignInOpen(false)
        }}
      />
    </>
  )
}
