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
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { uploadAsset } from '@/apis/upload'
import { ConfirmAction } from '@/views/settings/panels/confirm-action.tsx'
import {
  PANEL_STACK,
  SettingsRow,
  SettingsSection
} from '@/views/settings/panels/section.tsx'
import { useSessionStore, type SessionUser } from '@/stores/session'

const GENDER_UNSET = 'unset'

const GENDER_OPTIONS = [
  { label: '未设置', value: GENDER_UNSET },
  { label: '男', value: 'MALE' },
  { label: '女', value: 'FEMALE' }
]

/** 头像上限：过大原图没有必要，也避免上传拖慢设置页 */
const AVATAR_MAX_BYTES = 5 * 1024 * 1024

const AVATAR_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif'

interface ProfileDraft {
  username: string
  email: string
  phone: string
  gender: string
  birthday: string
}

/** 与注册表单一致：trim 后 2–12 个字符 */
const USERNAME_MIN = 2
const USERNAME_MAX = 12

function findDraft(user: SessionUser | null): ProfileDraft {
  return {
    username: user?.username ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    gender: user?.gender || GENDER_UNSET,
    birthday: user?.birthday ?? ''
  }
}

function isImageFile(file: File) {
  if (file.type.toLowerCase().startsWith('image/')) return true
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)
}

function parseUsername(value: string): string {
  const username = value.trim()
  const length = Array.from(username).length
  if (length < USERNAME_MIN || length > USERNAME_MAX) {
    throw new Error(`用户名长度为 ${USERNAME_MIN}–${USERNAME_MAX} 个字符`)
  }
  return username
}

function parseEmail(value: string): string | null {
  const email = value.trim()
  if (!email) return null
  if (!email.includes('@') || email.length < 5) {
    throw new Error('邮箱格式无效')
  }
  return email
}

function parsePhone(value: string): string | null {
  const phone = value.trim()
  if (!phone) return null
  if (
    phone.length < 8 ||
    !Array.from(phone).every(function (char) {
      return /[0-9+\-]/.test(char)
    })
  ) {
    throw new Error('手机号格式无效')
  }
  return phone
}

function parseBirthday(value: string): string | null {
  const birthday = value.trim()
  if (!birthday) return null
  const parsed = dayjs(birthday)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday) || !parsed.isValid()) {
    throw new Error('生日格式无效，应为 YYYY-MM-DD')
  }
  return parsed.format('YYYY-MM-DD')
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

  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewUrlRef = useRef<string | null>(null)

  const [draft, updateDraft] = useState<ProfileDraft>(function () {
    return findDraft(user)
  })
  const [isSaving, updateSaving] = useState(false)
  const [isUploading, updateUploading] = useState(false)
  const [previewUrl, updatePreviewUrl] = useState<string | null>(null)
  const [draftUser, updateDraftUser] = useState(user)

  // user 变了（外部刷新资料）就重建草稿：渲染期按引用变化调整，不用 effect
  if (user !== draftUser) {
    updateDraftUser(user)
    updateDraft(findDraft(user))
  }

  useEffect(function () {
    return function () {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = null
      }
    }
  }, [])

  function clearPreview() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    updatePreviewUrl(null)
  }

  function onPickAvatar() {
    fileInputRef.current?.click()
  }

  async function onAvatarSelected(file: File | undefined) {
    if (!file || !user) return
    if (!isImageFile(file)) {
      toast.error('请选择图片文件（PNG / JPEG / WebP / GIF）')
      return
    }
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error('头像不能超过 5MB')
      return
    }

    clearPreview()
    const localUrl = URL.createObjectURL(file)
    previewUrlRef.current = localUrl
    updatePreviewUrl(localUrl)
    updateUploading(true)

    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const assetId = await uploadAsset({
        name: file.name || 'avatar.png',
        mime: file.type || 'image/png',
        bytes
      })
      await toUpdateProfile({ avatar: assetId })
      clearPreview()
      toast.success('头像已更新')
    } catch (error) {
      clearPreview()
      const text = error instanceof Error ? error.message : String(error)
      toast.error(`头像上传失败：${text}`)
    } finally {
      updateUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function onSave() {
    if (!user) return
    updateSaving(true)
    try {
      const username = parseUsername(draft.username)
      const email = parseEmail(draft.email)
      const phone = parsePhone(draft.phone)
      const birthday = parseBirthday(draft.birthday)
      await toUpdateProfile({
        username,
        email,
        phone,
        gender: draft.gender === GENDER_UNSET ? null : draft.gender || null,
        birthday
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
    return <p className="text-sm text-muted-foreground">正在加载账号资料…</p>
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
  const displayAvatarUrl = previewUrl ?? user.avatarUrl

  return (
    <div className={PANEL_STACK}>
      <SettingsSection title="头像">
        <div className="flex flex-wrap items-center gap-3 py-1">
          <Avatar size="lg">
            {displayAvatarUrl ? (
              <AvatarImage
                src={displayAvatarUrl}
                alt={user.username}
              />
            ) : null}
            <AvatarFallback className="text-sm font-semibold text-primary">
              {initial}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="truncate font-medium">{user.username}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept={AVATAR_ACCEPT}
              className="hidden"
              aria-hidden
              tabIndex={-1}
              onChange={function (event) {
                const file = event.target.files?.[0]
                void onAvatarSelected(file)
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isUploading}
              onClick={onPickAvatar}>
              <Icon
                icon={isUploading ? 'lucide:loader-circle' : 'lucide:image-plus'}
                className={isUploading ? 'animate-spin' : undefined}
                aria-hidden
              />
              {isUploading ? '上传中…' : '更换头像'}
            </Button>
            <p className="text-xs text-muted-foreground">支持 PNG / JPEG / WebP / GIF，最大 5MB</p>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="个人资料">
        <SettingsRow
          label="用户名"
          hint={`2–${USERNAME_MAX} 个字符，全局唯一`}>
          <Input
            value={draft.username}
            maxLength={USERNAME_MAX}
            className="max-w-xs"
            placeholder="用户名"
            autoComplete="username"
            aria-label="用户名"
            onChange={function (event) {
              updateDraft({ ...draft, username: event.target.value })
            }}
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

        <div className="flex flex-wrap gap-2 pt-1.5">
          <Button
            disabled={isSaving || isUploading}
            onClick={function () {
              void onSave()
            }}>
            {isSaving ? '保存中…' : '保存资料'}
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection title="登录">
        <div className="flex flex-wrap items-center gap-2 py-1">
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
