import { Icon } from '@iconify/react/offline'
import { Avatar, AvatarFallback, AvatarImage } from '@cogito/design/components/avatar'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { useState } from 'react'
import { toast } from 'sonner'

import {
  APPEARANCE_MODES,
  readAppearance,
  writeAppearance,
  type AppearanceMode
} from '@/features/window/appearance'
import { openSettings } from '@/features/window/open-settings'
import { SECTION } from '@/views/settings/constant'

import styles from './sidebar.module.scss'

interface SidebarProfileBarProps {
  displayName: string
  avatarUrl?: string | null
  onOpenSettings: (section?: string) => void
}

const MODE_ICONS = {
  system: 'lucide:monitor',
  light: 'lucide:sun',
  dark: 'lucide:moon'
} as const

/**
 * Agent 侧栏底栏：Agent 设置留在 /agent；外观就地切换，避免卸掉聊天运行时；
 * 账号才同窗进全局设置（与主页头像入口一致，不另开窗）。
 */
function SidebarProfileBar(props: SidebarProfileBarProps) {
  const [mode, updateMode] = useState<AppearanceMode>(function () {
    return readAppearance().mode
  })

  function chooseMode(value: string) {
    const next = APPEARANCE_MODES.find(function (item) {
      return item.value === value
    })
    if (!next) return
    writeAppearance({ mode: next.value })
    updateMode(next.value)
  }

  return (
    <div className={`${styles.profile} flex items-center justify-between gap-1.5`}>
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
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="设置"
              title="设置"
              className={`${styles.profileSettings} text-muted-foreground hover:text-foreground size-7`}
            />
          }>
          <Icon
            icon="lucide:settings"
            className="size-3.5"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          sideOffset={8}
          className={styles.profileMenu}>
          <DropdownMenuItem
            className={styles.profileMenuRow}
            onClick={function () {
              props.onOpenSettings()
            }}>
            <Icon
              icon="lucide:settings"
              className={styles.profileMenuIcon}
            />
            Agent 设置
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={styles.profileMenuRow}>
              <Icon
                icon="lucide:palette"
                className={styles.profileMenuIcon}
              />
              外观
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              sideOffset={6}
              className={styles.profileMenuSub}>
              <DropdownMenuRadioGroup
                value={mode}
                onValueChange={chooseMode}>
                {APPEARANCE_MODES.map(function (item) {
                  return (
                    <DropdownMenuRadioItem
                      key={item.value}
                      value={item.value}
                      className={styles.profileMenuRow}>
                      <Icon
                        icon={MODE_ICONS[item.value]}
                        className={styles.profileMenuIcon}
                      />
                      {item.label}
                    </DropdownMenuRadioItem>
                  )
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            className={styles.profileMenuRow}
            onClick={function () {
              void openSettings(SECTION.ACCOUNT)
            }}>
            <Icon
              icon="lucide:user-round"
              className={styles.profileMenuIcon}
            />
            账号
          </DropdownMenuItem>
          <DropdownMenuSeparator className={styles.profileMenuSep} />
          <DropdownMenuItem
            className={styles.profileMenuRow}
            onClick={function () {
              toast.info('cogito Agent')
            }}>
            <Icon
              icon="lucide:info"
              className={styles.profileMenuIcon}
            />
            关于
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export { SidebarProfileBar }
