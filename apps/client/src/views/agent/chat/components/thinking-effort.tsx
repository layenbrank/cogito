/**
 * 右栏「思考强度」：assistant-ui `elements/reasoning-effort` 的落地。
 *
 * 三个数字各有来处：
 * - **档位**：当前模型在 `agent.json` 的 `modelPrefs[key].thinking`，点一下写回并**立即**
 *   同步给 goose（`applyGooseThinking`：全局键 + 当前会话的 config option）；
 * - **已用**：本轮（最后一条用户消息之后）reasoning part 的估算 token
 *   （`countTurnReasoningTokens`）。档位预算是单轮量级，累计口径会让进度条第二轮就顶死在 100%；
 * - **预算**：该档的参考预算（`findThinkingBudget`，量级说明写在那份文件里）。
 *
 * 「这个模型能不能思考」不再只看名字：会话真的给了 thinking 选项之后，
 * `thinking-capability` 记下的可选值才是权威（名字启发式只在还没建过会话时兜底）。
 * 同时把「实际下发值」写出来 —— 点「标准」而模型只认 high 时必须让用户看见，
 * 否则又变成「点了有反馈、实际没差别」。
 */
import { useAuiState } from '@assistant-ui/react'
import { ReasoningEffort, type EffortLevel } from '@cogito/design/assistant/reasoning-effort'
import { useMemo } from 'react'

import { applyGooseThinking } from '@/features/agent/acp/session'
import { countTurnReasoningTokens } from '@/features/agent/context-estimate'
import {
  canThink,
  findModelKey,
  THINKING_OPTIONS,
  useModelThinking,
  writeModelThinking
} from '@/features/agent/model/model-prefs'
import { useThinkingCapability } from '@/features/agent/model/thinking-capability'
import { resolveThinkingValue } from '@/features/agent/model/thinking-effort-map'
import { findThinkingBudget } from '@/features/agent/model/thinking-budget'
import { type ThinkingLevel } from '@/features/persist'
import { useProviderStore } from '@/stores/provider'

import { useSessionThreadID } from './use-session-thread-id'

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

/** 档位的中文名：回执里说「实际下发 深入」比说 high 更容易对上界面 */
function labelOf(level: string): string {
  const option = THINKING_OPTIONS.find(function (item) {
    return item.value === level
  })
  return option?.label ?? level
}

function ThinkingEffort() {
  const provider = useProviderStore(function (state) {
    return state.providers.find(function (row) {
      return row.id === state.activeProviderID
    })
  })
  // 库内会话 id：`applyGooseThinking` 按它找 ACP session，拿草稿 id 会一直落到「全局键」那条路
  const threadID = useSessionThreadID()
  /**
   * 逐 token 订阅：思考正文在流式增长，结构订阅（`useStructuralThreadMessages`）
   * 拿到的是上一次的快照，仪表会停在旧数字。这块很小，自己订阅自己。
   */
  const messages = useAuiState(function (state) {
    return state.thread.messages
  })
  const spent = useMemo(
    function () {
      return countTurnReasoningTokens(messages)
    },
    [messages]
  )

  // 收进局部常量：回调里再用 provider.model 会因为「属性可能变」丢掉收窄
  const providerID = provider?.id ?? ''
  const model = provider?.model?.trim() ?? ''
  const key = findModelKey(providerID, model)
  const capability = useThinkingCapability(key)
  /**
   * 订阅偏好本身：composer 浮层改的是同一档，这里不用重挂、不用等下一轮就跟着变
   * （以前两边各存一份 draft，改一处另一处还停在旧值）。空模型时读默认档，无副作用。
   */
  const selected = useModelThinking(providerID, model)

  if (!provider || !model) return null
  // 会话给过可选值就以它为准；还没建过会话才退回名字启发式
  const supported = capability ? true : canThink(model)
  if (!supported) return null

  const dispatch = resolveThinkingValue(selected, capability?.values ?? null)
  const note = findNote(capability, dispatch, selected)

  return (
    <div className="mt-3">
      <ReasoningEffort
        levels={EFFORT_LEVELS}
        selectedKey={selected}
        spent={spent}
        note={note}
        onSelect={function (next) {
          if (!isThinkingLevel(next)) return
          // 与模型选择器 / composer 浮层同一份偏好（共用 writeModelThinking）。
          // 先等它写进内存 cache 再下发：applyGooseThinking 读的就是这份偏好，
          // 不等写完就调，推给 goose 的还是**上一档**。
          void writeModelThinking(providerID, model, next).then(function () {
            // 立即下发：不等下一轮，用户在这里改完就该生效
            if (!threadID) return undefined
            return applyGooseThinking(threadID, providerID, model)
          })
        }}
      />
    </div>
  )
}

function findNote(
  capability: {
    values: readonly string[]
    applied: string | null
    scope: 'session' | 'global'
  } | null,
  dispatch: { value: string; matched: boolean; degraded: boolean },
  selected: ThinkingLevel
): string {
  if (!capability) return '该模型的思考档位还没确认，下一轮发送时会一并下发'
  const applied = capability.applied
  if (applied) {
    if (dispatch.degraded && applied !== selected) {
      return `本模型没有「${labelOf(selected)}」这一档，实际下发 ${applied}`
    }
    // 会话没给 thinking 选项时只写了全局键：如实说「新会话生效」，不冒充本轮已生效
    return capability.scope === 'session'
      ? `已下发 ${applied}`
      : `已写入全局（新会话生效）：${applied}`
  }
  if (!dispatch.matched) return `本模型不接受这组档位，已交给 goose 自行映射（${dispatch.value}）`
  return `可选：${capability.values.join(' / ')}`
}

export { ThinkingEffort }
