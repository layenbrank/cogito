/**
 * 助手生成参数：温度 / 补充系统提示 / corex 工具开关。
 *
 * 三个都落在 `agent.json` 的 `agent` 命名空间，改完即生效（没有保存按钮）：
 * - `temperature`：界面是 0–2（assistant-ui 元素口径），goose 的 `GOOSE_TEMPERATURE`
 *   只收 0–1，交给 goose 前用 `toGooseTemperature` 钳一次；
 * - `extraSystemPrompt`：追加在场景提示词之后（见 `prompts.ts::findSystemPrompt`）；
 * - `corexMcpTools`：`'1'` 开 / `'0'` 关，**对新会话生效**（会话建立时读一次）。
 */
import { findPref, patchPref } from '@/features/persist'

interface AgentTuning {
  temperature: number
  extraSystemPrompt: string
  corexMcpTools: '0' | '1'
}

/** goose 配置能接受的上限（元素滑杆是 0–2，超出部分只在界面上存在） */
const TEMPERATURE_GOOSE_MAX = 1

function readTuning(): AgentTuning {
  const pref = findPref('agent')
  return {
    temperature: pref.temperature,
    extraSystemPrompt: pref.extraSystemPrompt,
    corexMcpTools: pref.corexMcpTools
  }
}

function writeTuning(change: Partial<AgentTuning>) {
  void patchPref('agent', change)
}

/** 交给 goose 的值：非有限数当 0，并钳进 0–1 */
function toGooseTemperature(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(TEMPERATURE_GOOSE_MAX, Math.max(0, value))
}

export { readTuning, toGooseTemperature, writeTuning, TEMPERATURE_GOOSE_MAX }
export type { AgentTuning }
