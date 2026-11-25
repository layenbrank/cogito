/**
 * 侧栏顶部：当前空间 + 切换菜单 + 文档/文件视图切换。
 *
 * 空间切换从工具栏挪到最上面一行——用户永远先知道「我在哪个空间」，
 * 其次才是「这个空间里有什么」。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import {
  ToggleGroup,
  ToggleGroupItem
} from '@cogito/design/components/toggle-group'
import { cn } from 'cn'

import { useSpacesStore } from '@/stores/spaces'
import { t } from '@/views/knowledge/locale.ts'
import { NewSpaceDialog } from '@/views/knowledge/surface/new-space-dialog.tsx'
import { useSurfaceStore } from '@/views/knowledge/surface/store.ts'

type SidebarMode = 'docs' | 'files'

interface SpaceSwitcherProps {
  mode: SidebarMode
  onModeChange: (mode: SidebarMode) => void
}

const MODE_ITEMS: readonly { key: SidebarMode; label: string; icon: string }[] = [
  { key: 'docs', label: '文档', icon: 'lucide:files' },
  { key: 'files', label: '文件', icon: 'lucide:folder-tree' }
]

function SpaceSwitcher(props: SpaceSwitcherProps) {
  const spaces = useSpacesStore(function (state) {
    return state.spaces
  })
  const activeSpaceID = useSpacesStore(function (state) {
    return state.activeSpaceID
  })
  const selectSpace = useSpacesStore(function (state) {
    return state.selectSpace
  })
  const isNewSpaceOpen = useSurfaceStore(function (state) {
    return state.isNewSpaceOpen
  })
  const toSetNewSpaceOpen = useSurfaceStore(function (state) {
    return state.toSetNewSpaceOpen
  })
  const toSetTab = useSurfaceStore(function (state) {
    return state.toSetTab
  })
  const activeSpace = spaces.find(function (space) {
    return space.id === activeSpaceID
  })

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 px-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              className="hover:bg-muted/60 h-9 min-w-0 flex-1 justify-start gap-1.5 px-2 font-semibold"
            />
          }>
          <Icon
            icon="lucide:folders"
            className="text-muted-foreground size-4 shrink-0"
          />
          <span className="min-w-0 flex-1 truncate text-left text-[13px]">
            {activeSpace?.name ?? t('SPACE')}
          </span>
          <Icon
            icon="lucide:chevron-down"
            className="text-muted-foreground size-3.5 shrink-0"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('SPACE_SWITCH')}</DropdownMenuLabel>
            {spaces.length === 0 ? (
              <DropdownMenuItem disabled>{t('SPACE_EMPTY')}</DropdownMenuItem>
            ) : (
              spaces.map(function (space) {
                return (
                  <DropdownMenuItem
                    key={space.id}
                    onClick={function () {
                      void selectSpace(space.id)
                    }}>
                    <Icon
                      icon={space.id === activeSpaceID ? 'lucide:check' : 'lucide:folder'}
                      className={cn(
                        'size-3.5',
                        space.id === activeSpaceID ? 'text-primary' : 'text-muted-foreground'
                      )}
                    />
                    <span className="min-w-0 truncate">{space.name}</span>
                  </DropdownMenuItem>
                )
              })
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={function () {
              toSetNewSpaceOpen(true)
            }}>
            <Icon
              icon="lucide:plus"
              className="size-3.5"
            />
            {t('SPACE_NEW')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={function () {
              void useSpacesStore.getState().importExample()
            }}>
            <Icon
              icon="lucide:package-open"
              className="size-3.5"
            />
            {t('SPACE_IMPORT_SAMPLE')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={function () {
              toSetTab('settings')
            }}>
            <Icon
              icon="lucide:settings-2"
              className="size-3.5"
            />
            {t('SPACE_SETTINGS')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ToggleGroup
        aria-label="侧栏视图"
        spacing={0}
        value={[props.mode]}
        onValueChange={function (value) {
          const next = value[0]
          if (next === 'docs' || next === 'files') props.onModeChange(next)
        }}>
        {MODE_ITEMS.map(function (item) {
          return (
            <ToggleGroupItem
              key={item.key}
              value={item.key}
              aria-label={item.label}
              className="text-muted-foreground data-[state=on]:text-foreground size-8">
              <Icon
                icon={item.icon}
                className="size-4"
              />
            </ToggleGroupItem>
          )
        })}
      </ToggleGroup>

      <NewSpaceDialog
        open={isNewSpaceOpen}
        onOpenChange={toSetNewSpaceOpen}
      />
    </div>
  )
}

export { SpaceSwitcher }
export type { SidebarMode }
