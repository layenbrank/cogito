/**
 * 工作模式（场景）：与 Composer / 侧栏 / Workbench 共用
 */
import type { Scenario } from '@/features/agent/types'

type ScenarioKey = Scenario | 'general'

const SCENARIOS: { key: ScenarioKey; label: string; icon: string }[] = [
  { key: 'general', label: '通用', icon: 'lucide:layout-grid' },
  { key: 'compare', label: '对比', icon: 'lucide:shopping-cart' },
  { key: 'plan', label: '规划', icon: 'lucide:calendar' },
  { key: 'code', label: '代码', icon: 'lucide:code' }
]

function findScenarioLabel(key: ScenarioKey) {
  return (
    SCENARIOS.find(function (item) {
      return item.key === key
    })?.label ?? '通用'
  )
}

function findScenarioIcon(key: ScenarioKey) {
  return (
    SCENARIOS.find(function (item) {
      return item.key === key
    })?.icon ?? 'lucide:layout-grid'
  )
}

export { SCENARIOS, findScenarioLabel, findScenarioIcon }
export type { ScenarioKey }
