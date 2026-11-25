/**
 * 知识库窗 Caption 右侧：「视图」菜单 + 「空间」菜单。
 *
 * 编辑器优先之后，知识库管理不再占左轨：入口收进「空间」菜单（独立路由页保留），
 * 布局开关收进「视图」菜单。按钮统一 32px，与窗控 36px 同一视觉语言。
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
import { cn } from 'cn'
import type { ReactNode } from 'react'

import { useSpacesStore } from '@/stores/spaces'
import { useKnowledgeStore } from '@/stores/knowledge'
import { t } from '@/views/knowledge/locale.ts'
import { useSurfaceStore, type RailTabCanonical } from '@/views/knowledge/surface/store.ts'

interface MenuButtonProps {
  icon: string
  label: string
  children: ReactNode
}

function CaptionMenuButton(props: MenuButtonProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-region="false"
            aria-label={props.label}
            className="text-muted-foreground hover:bg-muted/60 hover:text-foreground size-8 min-w-8 rounded-lg border-0 shadow-none"
          />
        }>
        <Icon
          icon={props.icon}
          className="size-4"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-52">
        {props.children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CheckItem(props: { label: string; isActive: boolean; onClick: () => void }) {
  return (
    <DropdownMenuItem
      className="gap-2"
      onClick={props.onClick}>
      <Icon
        icon="lucide:check"
        className={cn('size-4', props.isActive ? 'text-primary' : 'opacity-0')}
      />
      {props.label}
    </DropdownMenuItem>
  )
}

const TOOL_ITEMS: readonly { key: RailTabCanonical; label: string; icon: string }[] = [
  { key: 'sources', label: '来源', icon: 'lucide:folder-input' },
  { key: 'search', label: '检索', icon: 'lucide:search' },
  { key: 'graph', label: '图谱', icon: 'lucide:git-fork' },
  { key: 'lint', label: 'Lint', icon: 'lucide:scan-text' },
  { key: 'review', label: '审阅', icon: 'lucide:list-todo' },
  { key: 'staging', label: '待发布', icon: 'lucide:inbox' },
  { key: 'settings', label: '设置', icon: 'lucide:settings' }
]

function KnowledgeCaptionFinal() {
  const isFocusMode = useKnowledgeStore(function (state) {
    return state.isFocusMode
  })
  const isSidebarOpen = useKnowledgeStore(function (state) {
    return state.isSidebarOpen
  })
  const isAsideOpen = useKnowledgeStore(function (state) {
    return state.isOutlineOpen
  })
  const toToggleSidebar = useKnowledgeStore(function (state) {
    return state.toToggleSidebar
  })
  const toPatchPreferences = useKnowledgeStore(function (state) {
    return state.toPatchPreferences
  })
  const asideTab = useSurfaceStore(function (state) {
    return state.asideTab
  })
  const railTab = useSurfaceStore(function (state) {
    return state.tab
  })
  const toSetTab = useSurfaceStore(function (state) {
    return state.toSetTab
  })
  const toToggleAside = useSurfaceStore(function (state) {
    return state.toToggleAside
  })
  const toSetNewSpaceOpen = useSurfaceStore(function (state) {
    return state.toSetNewSpaceOpen
  })
  const stagingCount = useSpacesStore(function (state) {
    return state.staging.length
  })

  if (isFocusMode) return null

  return (
    <div className="relative z-10 flex h-full items-center gap-1">
      <CaptionMenuButton
        icon="lucide:layout-panel-left"
        label="视图">
        <DropdownMenuGroup>
          <DropdownMenuLabel>布局</DropdownMenuLabel>
          <CheckItem
            label={t('SIDEBAR')}
            isActive={isSidebarOpen}
            onClick={toToggleSidebar}
          />
          <CheckItem
            label={t('OUTLINE')}
            isActive={isAsideOpen && asideTab === 'outline'}
            onClick={function () {
              toToggleAside('outline')
            }}
          />
          <CheckItem
            label="AI 助手"
            isActive={isAsideOpen && asideTab === 'assistant'}
            onClick={function () {
              toToggleAside('assistant')
            }}
          />
          <CheckItem
            label="深度研究"
            isActive={isAsideOpen && asideTab === 'research'}
            onClick={function () {
              toToggleAside('research')
            }}
          />
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <CheckItem
            label="专注模式"
            isActive={false}
            onClick={function () {
              toPatchPreferences({ isFocusMode: true })
            }}
          />
        </DropdownMenuGroup>
      </CaptionMenuButton>

      <CaptionMenuButton
        icon="lucide:library"
        label={t('SPACE')}>
        <DropdownMenuGroup>
          <DropdownMenuItem
            className="gap-2"
            onClick={function () {
              toSetTab('wiki')
            }}>
            <Icon
              icon="lucide:book-open"
              className="size-4"
            />
            文档
            {railTab === 'wiki' ? (
              <span className="text-muted-foreground ml-auto text-[11px]">当前</span>
            ) : null}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2"
            onClick={function () {
              toSetNewSpaceOpen(true)
            }}>
            <Icon
              icon="lucide:plus"
              className="size-4"
            />
            {t('SPACE_NEW')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>进阶功能</DropdownMenuLabel>
          {TOOL_ITEMS.map(function (item) {
            return (
              <DropdownMenuItem
                key={item.key}
                className="gap-2"
                onClick={function () {
                  toSetTab(item.key)
                }}>
                <Icon
                  icon={item.icon}
                  className="size-4"
                />
                {item.label}
                {item.key === 'staging' && stagingCount > 0 ? (
                  <span className="bg-primary/15 text-primary ml-auto rounded px-1.5 py-px text-[11px] font-semibold tabular-nums">
                    {stagingCount > 99 ? '99+' : stagingCount}
                  </span>
                ) : null}
                {railTab === item.key ? (
                  <span className="text-muted-foreground ml-auto text-[11px]">当前</span>
                ) : null}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuGroup>
      </CaptionMenuButton>
    </div>
  )
}

export { KnowledgeCaptionFinal }
