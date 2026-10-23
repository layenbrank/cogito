import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { clsx } from 'clsx'

import { Glide } from '@/components/glide/glide'
import styles from './sidebar.module.scss'
import { SCENARIOS, type ScenarioKey } from '@/features/agent/model/scenarios'

interface SidebarScenarioNavProps {
  scenario: ScenarioKey
  isSearchOpen: boolean
  onScenarioChange: (scenario: ScenarioKey) => void
  onToggleSearch: () => void
}

function SidebarScenarioNav(props: SidebarScenarioNavProps) {
  return (
    <div className={`${styles.topNav} flex items-center gap-1`}>
      <Glide.X
        classNames={{
          root: styles.scenarioGlide,
          inner: styles.scenarioRow
        }}>
        {SCENARIOS.map(function (item) {
          const active = item.key === props.scenario
          return (
            <Tooltip key={item.key}>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={clsx(styles.scenarioBtn, active && styles.scenarioBtnActive)}
                    aria-label={item.label}
                    aria-pressed={active}
                    onClick={function () {
                      props.onScenarioChange(item.key)
                    }}
                  />
                }>
                <Icon
                  icon={item.icon}
                  width={16}
                  height={16}
                />
              </TooltipTrigger>
              <TooltipContent side="bottom">{item.label}</TooltipContent>
            </Tooltip>
          )
        })}
      </Glide.X>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className={clsx(styles.scenarioBtn, props.isSearchOpen && styles.scenarioBtnActive)}
              aria-label="搜索"
              aria-pressed={props.isSearchOpen}
              onClick={props.onToggleSearch}
            />
          }>
          <Icon
            icon="lucide:search"
            width={16}
            height={16}
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">搜索</TooltipContent>
      </Tooltip>
    </div>
  )
}

export { SidebarScenarioNav }
