/**
 * 设置页：对齐 Qoder CN — Caption 只负责拖拽/窗口键；
 * 「返回应用」+ 搜索落在左栏顶；右主区白卡片内容。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { clsx } from 'clsx'
import { useMemo, useState, type ComponentType } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { AgentTitlebar } from '@/views/agent/components/titlebar'
import { DiagnosticsSection } from './sections/diagnostics'
import { ExtensionsSection } from './sections/extensions'
import { ModelSection } from './sections/model'
import { ToolPermissionsSection } from './sections/tool-permissions'
import { UsageSection } from './sections/usage'
import styles from './settings.module.scss'

interface SettingsItem {
  id: string
  label: string
  icon: string
  section: ComponentType
}

interface SettingsGroup {
  label: string
  items: SettingsItem[]
}

const GROUPS: SettingsGroup[] = [
  {
    label: '个人',
    items: [
      { id: 'model', label: '模型', icon: 'lucide:box', section: ModelSection },
      {
        id: 'permissions',
        label: '工具权限',
        icon: 'lucide:shield',
        section: ToolPermissionsSection
      }
    ]
  },
  {
    label: '集成',
    items: [
      { id: 'extensions', label: '扩展', icon: 'lucide:puzzle', section: ExtensionsSection }
    ]
  },
  {
    label: '其它',
    items: [
      { id: 'usage', label: '用量', icon: 'lucide:chart-column', section: UsageSection },
      {
        id: 'diagnostics',
        label: '诊断',
        icon: 'lucide:stethoscope',
        section: DiagnosticsSection
      }
    ]
  }
]

function AgentSettings() {
  const navigate = useNavigate()
  const [searchParams, updateSearchParams] = useSearchParams()
  const [query, updateQuery] = useState('')
  const [pickedID, updatePickedID] = useState<string | null>(null)

  const keyword = query.trim().toLowerCase()
  const visibleGroups = useMemo(
    function () {
      if (!keyword) return GROUPS
      return GROUPS.map(function (group) {
        return {
          label: group.label,
          items: group.items.filter(function (item) {
            return item.label.toLowerCase().includes(keyword)
          })
        }
      }).filter(function (group) {
        return group.items.length > 0
      })
    },
    [keyword]
  )

  const items = useMemo(
    function () {
      return GROUPS.flatMap(function (group) {
        return group.items
      })
    },
    []
  )

  const wantedID = pickedID ?? searchParams.get('section') ?? 'model'
  const active =
    items.find(function (item) {
      return item.id === wantedID
    }) ?? items[0]
  const ActiveSection = active.section

  function openSection(id: string) {
    updatePickedID(id)
    updateSearchParams({ section: id }, { replace: true })
  }

  return (
    <div className={styles.page}>
      <AgentTitlebar />

      <div className={styles.shell}>
        <nav className={styles.nav}>
          <div className={styles.navTop}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={styles.backBtn}
              data-region="false"
              onClick={function () {
                void navigate('/agent/chat')
              }}>
              <Icon
                icon="lucide:chevron-left"
                className="size-3.5"
              />
              返回应用
            </Button>
            <div className={styles.searchWrap}>
              <Icon
                icon="lucide:search"
                className={styles.searchIcon}
              />
              <Input
                value={query}
                placeholder="搜索设置…"
                aria-label="搜索设置"
                className={styles.searchInput}
                onChange={function (event) {
                  updateQuery(event.target.value)
                }}
              />
            </div>
          </div>

          <div className={styles.navBody}>
            {visibleGroups.map(function (group) {
              return (
                <div
                  key={group.label}
                  className={styles.navGroup}>
                  <p className={styles.navGroupLabel}>{group.label}</p>
                  {group.items.map(function (item) {
                    const isActive = item.id === active.id
                    return (
                      <Button
                        key={item.id}
                        type="button"
                        variant="ghost"
                        data-active={isActive ? 'true' : 'false'}
                        className={clsx(styles.navItem, isActive && styles.navItemActive)}
                        onClick={function () {
                          openSection(item.id)
                        }}>
                        <Icon
                          icon={item.icon}
                          className={styles.navItemIcon}
                        />
                        {item.label}
                      </Button>
                    )
                  })}
                </div>
              )
            })}
            {visibleGroups.length === 0 ? (
              <p className={styles.navEmpty}>没有匹配的设置项</p>
            ) : null}
          </div>
        </nav>

        <div className={styles.main}>
          <div className={styles.mainInner}>
            <ActiveSection />
          </div>
        </div>
      </div>
    </div>
  )
}

export default AgentSettings
