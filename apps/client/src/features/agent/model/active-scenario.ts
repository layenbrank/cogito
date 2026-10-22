/**
 * 当前工作场景（跨欢迎卡 / 侧栏 / 发送路径共享）。
 * 发送路径在 features 层读它注入 system prompt，故不能只停在 React state。
 */
import type { ScenarioKey } from '@/features/agent/model/scenarios'

type ScenarioListener = (scenario: ScenarioKey) => void

let activeScenario: ScenarioKey = 'general'
const listeners = new Set<ScenarioListener>()

function findActiveScenario() {
  return activeScenario
}

function setActiveScenario(scenario: ScenarioKey) {
  if (activeScenario === scenario) return
  activeScenario = scenario
  for (const listener of listeners) listener(scenario)
}

function watchActiveScenario(listener: ScenarioListener) {
  listeners.add(listener)
  return function () {
    listeners.delete(listener)
  }
}

export { findActiveScenario, setActiveScenario, watchActiveScenario }
