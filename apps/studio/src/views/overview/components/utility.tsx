import { DropdownMenu, DropdownMenuTrigger } from '@cogito/design/components/dropdown-menu'
import { toast } from 'sonner'

import { Utility, UtilityButton } from '@/components/utility'
import { AccountMenuContent } from '@/features/account/account-menu.tsx'
import { useAccountSession } from '@/features/account/session.ts'
import { DevtoolsAction, OverlayAction, ReloadAction } from '@/features/window/actions'

interface OverviewUtilityProps {
  /** 登录弹窗归概览页持有（标题栏只是入口） */
  onOpenSignIn: () => void
}

/**
 * 主窗口标题栏的账号位：未登录是直达登录弹窗的入口，已登录换成账号下拉。
 *
 * 不按登录态切换按钮就没有意义 —— 登录之后还挂着「登录」等于告诉用户没登录。
 * 菜单内容复用 Agent 窗口那一份（`features/account/account-menu.tsx`），
 * 两个窗口对「我是谁」「怎么退出」不会各说各话。
 */
function AccountEntry(props: OverviewUtilityProps) {
  const session = useAccountSession()
  const identity = session.identity

  if (!session.token) {
    return (
      <UtilityButton
        icon="mdi:login"
        label="登录"
        onClick={props.onOpenSignIn}
      />
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <UtilityButton
            icon="mdi:account-circle"
            label={identity ? identity.name : '账号'}
          />
        }
      />
      <AccountMenuContent
        side="bottom"
        align="start"
        onSignIn={props.onOpenSignIn}
      />
    </DropdownMenu>
  )
}

/** 主窗口标题栏：Agent 入口 + 主窗口用得到的宿主动作 */
export default function OverviewUtility(props: OverviewUtilityProps) {
  async function handleOpenAgent() {
    try {
      await itc.window.toOpen({ key: 'agent' })
    } catch (error) {
      toast.error('Agent 窗口打开失败', { duration: 2000 })
      console.error(error)
    }
  }

  return (
    <Utility>
      <AccountEntry onOpenSignIn={props.onOpenSignIn} />
      <UtilityButton
        icon="mdi:chat-processing-outline"
        label="打开 Agent 窗口"
        onClick={handleOpenAgent}
      />
      <DevtoolsAction />
      <OverlayAction />
      <ReloadAction />
    </Utility>
  )
}
