/**
 * 空会话欢迎页：短标题卡片；完整提示词放 tooltip，点选写入输入框。
 */
import { useAui } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { cn } from 'cn'
import { useEffect } from 'react'

import { rememberActiveScenario } from '@/features/agent/model/active-scenario'
import { takeChatHandoff } from '@/features/agent/model/chat-handoff'
import { QUICK_PROMPTS, type QuickPrompt } from '@/views/agent/chat/components/workbench-constants'
import styles from '@/views/agent/chat/components/workbench.module.scss'

function ThreadWelcome() {
  const aui = useAui()

  function pick(item: QuickPrompt) {
    rememberActiveScenario(item.scenario)
    aui.composer.setText(item.label)
  }

  // 从磁贴点「完整会话」过来时，把这一轮与场景带进输入框（只用一次）
  useEffect(
    function () {
      const handoff = takeChatHandoff()
      if (!handoff) return
      rememberActiveScenario(handoff.scenario)
      aui.composer.setText(handoff.text)
    },
    [aui]
  )

  return (
    <div className={styles.welcome}>
      <div className={styles.welcomeInner}>
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
                        // 盖过 Button 默认 h-8 / justify-center / shrink-0，否则卡片缩成左上角碎条
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
