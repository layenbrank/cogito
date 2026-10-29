/**
 * 指令磁贴的 dock 绑定：一句话生成 / 改这条 / 解释，结果直接落进编辑器草稿。
 *
 * 与聊天页的 directive 场景共用同一套 playbook 约束（不落库、只用真实动作 id），
 * 区别是**不跳页**：结果在这里就地替换 draft，用户点「保存」才进 corex.db。
 */
import { useEffect } from 'react'
import { toast } from 'sonner'

import { parseDirectiveDraft } from '@/features/agent/directive-draft'
import { useDockStore, type DockScope } from '@/features/agent/dock'
import { useCorexStore } from '@/stores/corex'

const SYSTEM_TEXT = `你是 cogito 的指令编排助手，与「指令」磁贴共用同一套 corex 动作库。

约束：
- 只产出结构化草稿，**不要落库**（corex.db 的唯一写者是 daemon）；
- 只能用目录里真实存在的动作 id：先用 corex_actions / corex_action 确认，禁止臆造；
- 需要校验时用 corex_validate；
- 输出用 \`\`\`json 围栏包一个对象：{"name","description","version","inputs":[...],"steps":[...]}，
  每一步带 id 与 action，参数放 params；不要输出 YAML。`

function findDraftJSON(): string | null {
  const draft = useCorexStore.getState().draft
  if (!draft) return null
  // 只给结构，不带内部时间戳等编辑器字段
  return JSON.stringify(
    {
      name: draft.name,
      description: draft.description,
      version: draft.version,
      inputs: draft.inputs,
      steps: draft.steps
    },
    null,
    2
  )
}

function useDirectiveDockScope(): void {
  const toBind = useDockStore(function (state) {
    return state.toBind
  })
  const toUnbind = useDockStore(function (state) {
    return state.toUnbind
  })

  useEffect(
    function () {
      const scope: DockScope = {
        key: 'directive',
        title: '指令助手',
        hint: '生成草稿后点「应用到编辑器」，再保存',
        systemText: SYSTEM_TEXT,
        toWrite: function (text) {
          const parsed = parseDirectiveDraft(text)
          if (!parsed.ok) {
            toast.error('这段回复里没有可用的指令定义', { description: parsed.reason })
            return
          }
          // recordHistory=true：应用也能 Ctrl+Z 撤回
          useCorexStore.getState().replaceDraft(parsed.definition, true)
          toast.success(`已应用「${parsed.definition.name}」，保存后生效`)
        },
        actions: [
          {
            id: 'generate',
            label: '生成一条指令',
            icon: 'lucide:sparkles',
            buildPrompt: function () {
              return '请帮我实现一条指令。先用一句话问我：目标、输入（路径/参数）、成功标准；我回答后按约定格式输出完整 JSON。'
            }
          },
          {
            id: 'improve',
            label: '改这条',
            icon: 'lucide:wand-sparkles',
            buildPrompt: function () {
              const json = findDraftJSON()
              if (!json) return null
              return `在保持结构可用的前提下改进这条指令（补参数校验/错误处理，去掉多余步骤），只输出完整的 JSON 定义。\n\n当前定义：\n\`\`\`json\n${json}\n\`\`\``
            }
          },
          {
            id: 'explain',
            label: '解释这条',
            icon: 'lucide:message-circle-question',
            buildPrompt: function () {
              const json = findDraftJSON()
              if (!json) return null
              return `解释这条指令：每一步在做什么、依赖哪些动作、需要什么权限与风险，以及最容易出错的地方。\n\n当前定义：\n\`\`\`json\n${json}\n\`\`\``
            }
          }
        ]
      }
      toBind(scope)
      return function () {
        toUnbind('directive')
      }
    },
    [toBind, toUnbind]
  )
}

export { useDirectiveDockScope }
