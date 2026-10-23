import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { useState } from 'react'

import {
  APPEARANCE_MODES,
  readAppearance,
  writeAppearance,
  type AppearanceMode
} from '@/features/window/appearance.ts'
import { WINDOW_SHORTCUTS, formatShortcut } from '@/features/window/shortcuts.ts'

interface ProfileMenuProps {
  onOpenSettings: () => void
}

const MODE_ICONS = {
  system: 'lucide:monitor',
  light: 'lucide:sun',
  dark: 'lucide:moon'
} as const

function findSettingsShortcut() {
  const item = WINDOW_SHORTCUTS.find(function (entry) {
    return entry.id === 'open-settings'
  })
  return item ? formatShortcut(item) : 'Ctrl + ,'
}

/**
 * 左栏底部的齿轮。Qoder 点开是菜单（设置 / 外观 / 关于），不是直接进设置页。
 * 宠物、语言字体这些 studio 没有对应能力，不放进去；账号与退出登录归旁边的账号区
 * （`features/account/account-menu.tsx`），免得同一件事有两个入口。
 */
export function ProfileMenu(props: ProfileMenuProps) {
  const [mode, updateMode] = useState<AppearanceMode>(readAppearance)
  const [isAboutOpen, updateAboutOpen] = useState(false)

  function chooseMode(value: string) {
    const next = APPEARANCE_MODES.find(function (item) {
      return item.value === value
    })
    if (!next) return
    writeAppearance(next.value)
    updateMode(next.value)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground size-8 shrink-0 rounded-md"
              aria-label="设置"
              title="设置"
            />
          }>
          <Icon
            icon="lucide:settings"
            className="size-4"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          className="w-52">
          <DropdownMenuItem onClick={props.onOpenSettings}>
            <Icon icon="lucide:settings" />
            设置
            <DropdownMenuShortcut>{findSettingsShortcut()}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Icon icon="lucide:palette" />
              外观
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-40">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Icon icon="lucide:moon" />
                  明暗模式
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={mode}
                    onValueChange={chooseMode}>
                    {APPEARANCE_MODES.map(function (item) {
                      return (
                        <DropdownMenuRadioItem
                          key={item.value}
                          value={item.value}>
                          <Icon icon={MODE_ICONS[item.value]} />
                          {item.label}
                        </DropdownMenuRadioItem>
                      )
                    })}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={function () {
              updateAboutOpen(true)
            }}>
            <Icon icon="lucide:info" />
            关于
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={isAboutOpen}
        onOpenChange={updateAboutOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>关于</DialogTitle>
            <DialogDescription>
              cogito Studio。模型和密钥都在这台机器上，不经过在线账号。
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  )
}
