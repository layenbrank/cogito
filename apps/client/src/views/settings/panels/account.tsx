import { Icon } from '@iconify/react/offline'
import { Avatar, AvatarFallback, AvatarImage } from '@cogito/design/components/avatar'
import { Button } from '@cogito/design/components/button'
import { DatePicker } from '@cogito/design/components/date-picker'
import { Input } from '@cogito/design/components/input'
import dayjs from 'dayjs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { useState } from 'react'
import { toast } from 'sonner'

import { ConfirmAction } from '@/views/settings/panels/confirm-action.tsx'
import { SettingsRow, SettingsSection } from '@/views/settings/panels/section.tsx'
import { useSessionStore, type SessionUser } from '@/stores/session'

const GENDER_UNSET = 'unset'

const GENDER_OPTIONS = [
  { label: '未设置', value: GENDER_UNSET },
  { label: '男', value: 'MALE' },
  { label: '女', value: 'FEMALE' },
  { label: '其它', value: 'OTHER' }
]

interface ProfileDraft {
  email: string
  phone: string
  gender: string
  birthday: string
}

function findDraft(user: SessionUser | null): ProfileDraft {
  return {
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    gender: user?.gender || GENDER_UNSET,
    birthday: user?.birthday ?? ''
  }
}

function AccountPanel() {
  const user = useSessionStore(function (state) {
    return state.user
  })
  const isLoading = useSessionStore(function (state) {
    return state.isLoading
  })
  const toSignOut = useSessionStore(function (state) {
    return state.toSignOut
  })
  const toUpdateProfile = useSessionStore(function (state) {
    return state.toUpdateProfile
  })

  const [draft, updateDraft] = useState<ProfileDraft>(function () {
    return findDraft(user)
  })
  const [isSaving, updateSaving] = useState(false)
  const [draftUser, updateDraftUser] = useState(user)

  // user 变了（外部刷新资料）就重建草稿：渲染期按引用变化调整，不用 effect
  if (user !== draftUser) {
    updateDraftUser(user)
    updateDraft(findDraft(user))
  }

  async function onSave() {
    if (!user) return
    updateSaving(true)
    try {
      await toUpdateProfile({
        email: draft.email.trim() || null,
        phone: draft.phone.trim() || null,
        gender: draft.gender === GENDER_UNSET ? null : draft.gender || null,
        birthday: draft.birthday.trim() || null
      })
      toast.success('资料已保存')
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      toast.error(`保存失败：${text}`)
    } finally {
      updateSaving(false)
    }
  }

  if (isLoading && !user) {
    return (
      <p className="text-sm text-muted-foreground">正在加载账号资料…</p>
    )
  }

  if (!user) {
    return (
      <SettingsSection title="登录状态">
        <p className="py-2 text-sm text-muted-foreground">
          当前未登录。请在主窗口标题栏点击「登录」后再编辑资料。
        </p>
      </SettingsSection>
    )
  }

  const initial = user.username.slice(0, 1).toUpperCase()

  return (
    <div className="flex max-w-full flex-col gap-3 text-sm">
      <SettingsSection title="头像">
        <div className="flex flex-wrap items-center gap-4 py-2">
          <Avatar size="lg">
            {user.avatarUrl ? (
              <AvatarImage
                src={user.avatarUrl}
                alt={user.username}
              />
            ) : null}
            <AvatarFallback className="text-sm font-semibold text-primary">
              {initial}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="truncate font-medium">{user.username}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled
              title="头像上传管线尚未接入">
              <Icon
                icon="lucide:image-plus"
                aria-hidden
              />
              更换头像
            </Button>
            <p className="text-xs text-muted-foreground">头像上传即将支持</p>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="个人资料">
        <SettingsRow
          label="用户名"
          hint="用户名由注册时确定，暂不支持修改">
          <Input
            value={user.username}
            disabled
            className="max-w-xs"
            aria-label="用户名"
          />
        </SettingsRow>

        <SettingsRow label="邮箱">
          <Input
            type="email"
            value={draft.email}
            className="max-w-xs"
            placeholder="name@example.com"
            aria-label="邮箱"
            onChange={function (event) {
              updateDraft({ ...draft, email: event.target.value })
            }}
          />
        </SettingsRow>

        <SettingsRow label="手机">
          <Input
            type="tel"
            value={draft.phone}
            className="max-w-xs"
            placeholder="手机号"
            aria-label="手机"
            onChange={function (event) {
              updateDraft({ ...draft, phone: event.target.value })
            }}
          />
        </SettingsRow>

        <SettingsRow label="性别">
          <Select
            items={GENDER_OPTIONS}
            value={draft.gender}
            onValueChange={function (value) {
              updateDraft({ ...draft, gender: value ?? GENDER_UNSET })
            }}>
            <SelectTrigger
              className="w-40"
              aria-label="性别">
              <SelectValue placeholder="未设置" />
            </SelectTrigger>
            <SelectContent>
              {GENDER_OPTIONS.map(function (option) {
                return (
                  <SelectItem
                    key={option.value}
                    value={option.value}>
                    {option.label}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow
          label="生日"
          hint="格式 YYYY-MM-DD">
          <DatePicker
            className="max-w-xs"
            aria-label="生日"
            value={draft.birthday ? dayjs(draft.birthday) : null}
            onChange={function (_date, dateString) {
              updateDraft({ ...draft, birthday: dateString })
            }}
          />
        </SettingsRow>

        <div className="flex flex-wrap gap-2.5 pt-2">
          <Button
            disabled={isSaving}
            onClick={function () {
              void onSave()
            }}>
            保存资料
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection title="登录">
        <div className="flex flex-wrap items-center gap-3 py-2">
          <ConfirmAction
            label="退出登录"
            title="退出登录"
            description="确定要退出当前账号吗？"
            confirmLabel="退出登录"
            onConfirm={toSignOut}
          />
        </div>
      </SettingsSection>
    </div>
  )
}

export default AccountPanel
