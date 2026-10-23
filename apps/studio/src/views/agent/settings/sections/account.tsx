import { Icon } from '@iconify/react/offline'
import { Avatar, AvatarFallback } from '@cogito/design/components/avatar'
import { Button } from '@cogito/design/components/button'
import { Skeleton } from '@cogito/design/components/skeleton'
import { useState } from 'react'

import { useAccountSession, useSignOut } from '@/features/account/session.ts'
import SignIn from '@/features/signin/signin.tsx'
import { formatDateTime } from '@/views/agent/settings/components/format.ts'
import { SettingRow, SettingsSection } from '@/views/agent/settings/components/section.tsx'

/**
 * 个人 · 账号：当前登录的是谁、资料是什么、怎么退出。
 *
 * 平台身份（管理员 / 普通用户）决定设置页能不能看到「平台」分组，所以这里显式展示角色，
 * 免得用户对着灰掉的入口猜原因。**不做资料编辑**：`PUT /auth/profile` 只管邮箱与头像，
 * 头像还要求先上传拿到资源 id，那是另一个功能，先不摆假入口。
 */

/** 账号状态只有两种（服务端 `crates/identity` 的 `AccountStatus`） */
const STATUS_LABELS: Record<string, string> = {
  ACTIVE: '正常',
  DISABLED: '已禁用'
}

function findStatusLabel(status: string | undefined): string {
  if (!status) return '—'
  return STATUS_LABELS[status] ?? status
}

export function AccountSection() {
  const session = useAccountSession()
  const { signOut, isPending } = useSignOut()
  const [isSignInOpen, updateSignInOpen] = useState(false)

  const identity = session.identity
  const profile = session.profile
  const signedIn = Boolean(session.token)

  if (!signedIn) {
    return (
      <>
        <SettingsSection
          title="账号"
          hint="登录后可用平台模型、额度与订阅；本机模型（Ollama / LM Studio 等）与自备密钥不需要登录。">
          <SettingRow
            label="未登录"
            hint="当前在这台机器上以本地身份使用，模型和密钥都留在这里。"
            control={
              <Button
                type="button"
                size="sm"
                onClick={function () {
                  updateSignInOpen(true)
                }}>
                <Icon icon="lucide:log-in" />
                登录
              </Button>
            }
          />
        </SettingsSection>

        <SignIn
          visible={isSignInOpen}
          onClose={function () {
            updateSignInOpen(false)
          }}
        />
      </>
    )
  }

  return (
    <SettingsSection
      title="账号"
      hint="登录态存在本机，服务端只认 JWT；令牌失效会自动回到未登录。">
      {session.isLoading ? (
        <div className="flex flex-col gap-2 py-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 py-3">
            <Avatar size="lg">
              <AvatarFallback className="text-sm font-medium">
                {identity ? identity.initials : '?'}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{identity?.name ?? '已登录'}</span>
              <span className="text-muted-foreground truncate text-xs">
                {identity?.detail ?? '资料暂时读不到'}
              </span>
            </div>
          </div>

          <SettingRow
            label="角色"
            hint="平台管理员可以看到设置页的「平台」分组（供应商、模型、用量、审计）。"
            control={<span className="text-sm">{identity?.roleLabel ?? '未知角色'}</span>}
          />
          <SettingRow
            label="状态"
            control={<span className="text-sm">{findStatusLabel(profile?.status)}</span>}
          />
          <SettingRow
            label="邮箱"
            control={<span className="text-sm">{profile?.email || '未绑定'}</span>}
          />
          <SettingRow
            label="手机号"
            control={<span className="text-sm">{profile?.phone || '未绑定'}</span>}
          />
          <SettingRow
            label="注册时间"
            control={
              <span className="text-sm">
                {profile ? formatDateTime(profile.createdAt) : '资料暂时读不到'}
              </span>
            }
          />
          <SettingRow
            label="退出登录"
            hint="退出后平台模型与额度不可用；本机模型与历史会话不受影响。"
            control={
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={isPending}
                onClick={signOut}>
                退出登录
              </Button>
            }
          />
        </>
      )}

      {session.isProfileUnavailable ? (
        <div className="text-muted-foreground py-2.5 text-xs">
          读不到账号资料（服务地址不通或未配置）：身份按登录令牌显示，稍后会自动重试。
        </div>
      ) : null}
    </SettingsSection>
  )
}
