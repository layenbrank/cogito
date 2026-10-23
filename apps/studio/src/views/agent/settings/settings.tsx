import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Icon } from '@iconify/react/offline'
import { useMemo, useState, type ComponentType } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { useIsAdmin } from '@/features/account/session.ts'
import AgentUtility from '@/views/agent/components/utility.tsx'
import { AccountSection } from '@/views/agent/settings/sections/account.tsx'
import { GeneralSection } from '@/views/agent/settings/sections/general.tsx'
import { ModelSection } from '@/views/agent/settings/sections/model.tsx'
import { AuditSection } from '@/views/agent/settings/sections/platform-audit.tsx'
import { PlatformModelSection } from '@/views/agent/settings/sections/platform-models.tsx'
import { PlatformProviderSection } from '@/views/agent/settings/sections/platform-providers.tsx'
import { UsageSection } from '@/views/agent/settings/sections/platform-usage.tsx'
import { QuotaSection } from '@/views/agent/settings/sections/quota.tsx'
import { ShortcutsSection } from '@/views/agent/settings/sections/shortcuts.tsx'
import { ToolsSection } from '@/views/agent/settings/sections/tools.tsx'

/**
 * 设置页（`/agent/settings`）：左导航 + 右内容，顶部「返回应用」。
 * 只放真有消费者的分组，不做截图里的假入口。
 *
 * 分组可以直达：`/agent/settings?section=quota`。入口散在各处（左栏额度按钮、模型菜单里
 * 「去添加模型接入」），把人丢到设置页首页再让他自己找一遍是说不过去的。分组 id 就是
 * `GROUPS` 里的 id —— 入口只报 id，不拼页面内部结构。点导航也会把这个参数写回地址，
 * 刷新 / 从别处再跳进来时落在同一分组。
 */

interface SettingsItem {
  id: string
  label: string
  icon: string
  section: ComponentType
}

interface SettingsGroup {
  label: string
  /** 服务端管理面只认 ADMIN，非管理员连入口都不该看见 */
  adminOnly?: boolean
  items: SettingsItem[]
}

const GROUPS: SettingsGroup[] = [
  {
    label: '个人',
    items: [
      { id: 'account', label: '账号', icon: 'lucide:user-round', section: AccountSection },
      { id: 'general', label: '常规', icon: 'lucide:settings-2', section: GeneralSection },
      { id: 'shortcuts', label: '快捷键', icon: 'lucide:keyboard', section: ShortcutsSection },
      { id: 'model', label: '模型', icon: 'lucide:sparkles', section: ModelSection },
      { id: 'tools', label: '工具', icon: 'lucide:wrench', section: ToolsSection },
      { id: 'quota', label: '额度', icon: 'lucide:gauge', section: QuotaSection }
    ]
  },
  {
    label: '平台',
    adminOnly: true,
    items: [
      {
        id: 'platform-providers',
        label: '供应商',
        icon: 'lucide:server',
        section: PlatformProviderSection
      },
      {
        id: 'platform-models',
        label: '平台模型',
        icon: 'lucide:boxes',
        section: PlatformModelSection
      },
      { id: 'platform-usage', label: '用量', icon: 'lucide:chart-column', section: UsageSection },
      { id: 'platform-audit', label: '审计', icon: 'lucide:scroll-text', section: AuditSection }
    ]
  }
]

export default function Settings() {
  const navigate = useNavigate()
  const [searchParams, updateSearchParams] = useSearchParams()
  const [query, updateQuery] = useState('')
  /** 用户在本页点出来的分组；还没点过就听地址里的 `?section=` */
  const [pickedID, updatePickedID] = useState<string | null>(null)

  const admin = useIsAdmin()
  const groups = useMemo(
    function () {
      return GROUPS.filter(function (group) {
        return !group.adminOnly || admin
      })
    },
    [admin]
  )

  const keyword = query.trim().toLowerCase()
  const visibleGroups = useMemo(
    function () {
      if (!keyword) return groups

      return groups
        .map(function (group) {
          return {
            label: group.label,
            items: group.items.filter(function (item) {
              return item.label.toLowerCase().includes(keyword)
            })
          }
        })
        .filter(function (group) {
          return group.items.length > 0
        })
    },
    [keyword, groups]
  )

  const items = useMemo(
    function () {
      return groups.flatMap(function (group) {
        return group.items
      })
    },
    [groups]
  )

  // 地址里的分组对非管理员可能是藏起来的（平台分组），对不上就落回第一个
  const wantedID = pickedID ?? searchParams.get('section')
  const active =
    items.find(function (item) {
      return item.id === wantedID
    }) ?? items[0]
  const ActiveSection = active.section

  /** 点导航时把分组写回地址：刷新、从别处再跳进来都落在同一处 */
  function openSection(id: string) {
    updatePickedID(id)
    updateSearchParams({ section: id }, { replace: true })
  }

  return (
    <div className="bg-background text-foreground flex h-full w-full flex-col">
      <AgentUtility />

      <div className="border-border flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={function () {
            void navigate('/agent/chat')
          }}>
          <Icon icon="lucide:chevron-left" />
          返回应用
        </Button>
        <span className="text-sm font-medium">设置</span>
      </div>

      <div className="bg-muted/30 flex min-h-0 flex-1 gap-0 p-3">
        <nav className="bg-background border-border flex w-56 shrink-0 flex-col gap-3 rounded-xl border p-2">
          <div className="relative">
            <Icon
              icon="lucide:search"
              className="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2"
            />
            <Input
              value={query}
              placeholder="搜索设置…"
              aria-label="搜索设置"
              className="h-8 ps-8 text-xs"
              onChange={function (event) {
                updateQuery(event.target.value)
              }}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            {visibleGroups.map(function (group) {
              return (
                <div
                  key={group.label}
                  className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground px-2 pb-0.5 text-xs font-medium">
                    {group.label}
                  </span>
                  {group.items.map(function (item) {
                    const isActive = item.id === active.id

                    return (
                      <Button
                        key={item.id}
                        type="button"
                        variant="ghost"
                        size="sm"
                        data-active={isActive ? 'true' : 'false'}
                        className={
                          isActive
                            ? 'bg-muted text-foreground w-full justify-start'
                            : 'text-muted-foreground hover:text-foreground w-full justify-start'
                        }
                        onClick={function () {
                          openSection(item.id)
                        }}>
                        <Icon
                          icon={item.icon}
                          className="size-4"
                        />
                        {item.label}
                      </Button>
                    )
                  })}
                </div>
              )
            })}

            {visibleGroups.length === 0 ? (
              <p className="text-muted-foreground px-2 text-xs">没有匹配的设置项</p>
            ) : null}
          </div>
        </nav>

        <div className="bg-background border-border min-h-0 flex-1 overflow-y-auto rounded-xl border p-6 ms-3">
          <div className="mx-auto flex max-w-2xl flex-col gap-6">
            <ActiveSection />
          </div>
        </div>
      </div>
    </div>
  )
}
