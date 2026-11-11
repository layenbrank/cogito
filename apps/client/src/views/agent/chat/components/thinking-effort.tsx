/**
 * 右栏「思考强度」：assistant-ui `elements/reasoning-effort` 的落地。
 *
 * 三个数字各有来处：
 * - **档位**：当前模型在 `agent.json` 的 `modelPrefs[key].thinking`，点一下写回；
 * - **已用**：本轮上下文里 reasoning part 的估算 token（`countReasoningTokens`）；
 * - **预算**：该档的参考预算（`findThinkingBudget`，量级说明写在那份文件里）。
 *
 * 只在「这个模型可能带思考」时出现（`canThink`）—— 不给不支持的模型摆一个调了也没用的开关，
 * 也不在没选模型时占位。
 */
import { useAuiState } from '@assistant-ui/react'
import { ReasoningEffort, type EffortLevel } from '@cogito/design/assistant/reasoning-effort'
import { useMemo, useState } from 'react'

import { countReasoningTokens } from '@/features/agent/context-estimate'
import {
  canThink,
  findModelKey,
  findModelPref,
  THINKING_OPTIONS,
  writeModelThinking
} from '@/features/agent/model/model-prefs'
import { findThinkingBudget } from '@/features/agent/model/thinking-budget'
import { type ThinkingLevel } from '@/features/persist'
import { useProviderStore } from '@/stores/provider'

/** 档位 → 元素要的形状；预算与档位一一对应，不随模型变 */
const EFFORT_LEVELS: readonly EffortLevel[] = THINKING_OPTIONS.map(function (option) {
  // 胶囊读 label、标题下的那行小字读 hint，都来自 THINKING_OPTIONS 这一份
  const { label, hint } = option
  return { key: option.value, label, hint, budget: findThinkingBudget(option.value) }
})

function isThinkingLevel(value: string): value is ThinkingLevel {
  return THINKING_OPTIONS.some(function (option) {
    return option.value === value
  })
}

function ThinkingEffort() {
  const provider = useProviderStore(function (state) {
    return state.providers.find(function (row) {
      return row.id === state.activeProviderID
    })
  })
  /** 刚点过、还没读回来的档位；按模型 key 各记一份，换模型不会串味 */
  const [draft, updateDraft] = useState<Record<string, ThinkingLevel>>({})
  /**
   * 逐 token 订阅：思考正文在流式增长，结构订阅（`useStructuralThreadMessages`）
   * 拿到的是上一次的快照，仪表会停在旧数字。这块很小，自己订阅自己。
   */
  const messages = useAuiState(function (state) {
    return state.thread.messages
  })
  const spent = useMemo(
    function () {
      return countReasoningTokens(messages)
    },
    [messages]
  )

  if (!provider || !provider.model || !canThink(provider.model)) return null

  // 收进局部常量：回调里再用 provider.model 会因为「属性可能变」丢掉收窄
  const providerID = provider.id
  const model = provider.model
  const key = findModelKey(providerID, model)
  const selected = draft[key] ?? findModelPref(providerID, model).thinking

  return (
    <div className="border-foreground/[0.06] mt-3 border-t pt-2.5">
      <ReasoningEffort
        levels={EFFORT_LEVELS}
        selectedKey={selected}
        spent={spent}
        onSelect={function (next) {
          if (!isThinkingLevel(next)) return
          updateDraft(function (previous) {
            return { ...previous, [key]: next }
          })
          // 与模型选择器 / 设置弹窗同一份偏好（共用 writeModelThinking）
          writeModelThinking(providerID, model, next)
        }}
      />
    </div>
  )
}

export { ThinkingEffort }
