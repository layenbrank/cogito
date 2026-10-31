/**
 * 空会话欢迎页：Agent 配置卡 + 短标题建议；完整提示词放 tooltip，点选写入输入框。
 */
import { useAui } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import {
  Agent,
  AgentContent,
  AgentHeader,
  AgentInstructions,
  AgentTool,
  AgentTools
} from '@cogito/design/assistant/agent'
import { Button } from '@cogito/design/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { cn } from 'cn'
import { useEffect, useState } from 'react'

import { findApprovalPolicy, readApprovalMode } from '@/features/agent/approval'
import { rememberActiveScenario } from '@/features/agent/model/active-scenario'
import { takeChatHandoff } from '@/features/agent/model/chat-handoff'
import { useActiveWorkspace } from '@/features/agent/workspace/active'
import { WorkspaceSkills } from '@/lib/workspace-skills'
import { useProviderStore } from '@/stores/provider'
import { QUICK_PROMPTS, type QuickPrompt } from '@/views/agent/chat/components/workbench-constants'
import styles from '@/views/agent/chat/components/workbench.module.scss'

interface WelcomeSkill {
  id: string
  name: string
  description: string
}

function ThreadWelcome() {
  const aui = useAui()
  const { rootPath } = useActiveWorkspace()
  const providers = useProviderStore(function (state) {
    return state.providers
  })
  const activeProviderID = useProviderStore(function (state) {
    return state.activeProviderID
  })
  const activeProvider = providers.find(function (provider) {
    return provider.id === activeProviderID && provider.enabled
  })
  const approval = findApprovalPolicy(readApprovalMode())
  const [skillsState, updateSkills] = useState<WelcomeSkill[]>([])
  /** 无工作区时按空列表渲染，避免 effect 里同步清 state 多刷一帧 */
  const skills = rootPath ? skillsState : []

  useEffect(
    function () {
      if (!rootPath) return
      let cancelled = false
      void WorkspaceSkills.fetchSkills([rootPath])
        .then(function (rows) {
          if (cancelled) return
          updateSkills(
            rows.slice(0, 8).map(function (row) {
              return { id: row.id, name: row.name, description: row.description }
            })
          )
        })
        .catch(function (error) {
          console.warn('[thread-welcome] 读取技能失败:', error)
          if (!cancelled) updateSkills([])
        })
      return function () {
        cancelled = true
      }
    },
    [rootPath]
  )

  function pick(item: QuickPrompt) {
    rememberActiveScenario(item.scenario)
    aui.composer.setText(item.label)
  }

  useEffect(
    function () {
      const handoff = takeChatHandoff()
      if (!handoff) return
      rememberActiveScenario(handoff.scenario)
      aui.composer.setText(handoff.text)
    },
    [aui]
  )

  const modelLabel = activeProvider?.model?.trim() || '未选模型'
  const agentName = activeProvider?.name?.trim() || 'Agent'
  const instructions = [
    `模型：${modelLabel}`,
    `审批：${approval?.label ?? '询问审批'}`,
    rootPath ? `工作区：${rootPath}` : '工作区：未选择'
  ].join('\n')

  return (
    <div className={styles.welcome}>
      <div className={cn(styles.welcomeInner, 'flex flex-col gap-4')}>
        <Agent className="border-border/60 bg-card/40">
          <AgentHeader
            name={agentName}
            model={modelLabel}
          />
          <AgentContent>
            <AgentInstructions>{instructions}</AgentInstructions>
            {skills.length > 0 ? (
              <AgentTools>
                {skills.map(function (skill) {
                  return (
                    <AgentTool
                      key={skill.id}
                      value={skill.id}
                      tool={{
                        name: skill.name,
                        description: skill.description || undefined
                      }}
                    />
                  )
                })}
              </AgentTools>
            ) : null}
          </AgentContent>
        </Agent>

        <div className={styles.promptsGrid}>
          {QUICK_PROMPTS.map(function (item) {
            return (
              <Tooltip key={item.key}>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      className={cn(
                        styles.promptCard,
                        'h-auto w-full justify-start whitespace-normal font-normal hover:bg-transparent'
                      )}
                      onClick={function () {
                        pick(item)
                      }}
                    />
                  }>
                  <span className={styles.promptIcon}>
                    <Icon
                      icon={item.icon}
                      width={16}
                      height={16}
                    />
                  </span>
                  <span className={styles.promptBody}>
                    <span className={styles.promptLabel}>{item.title}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  className="max-w-64 text-xs">
                  {item.label}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export { ThreadWelcome }
