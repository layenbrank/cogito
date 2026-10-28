/**
 * 空会话欢迎页：居中圆角建议卡（不展示热力 / 长文案）。
 */
import { useAui } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { useEffect } from 'react'

import { setActiveScenario } from '@/features/agent/model/active-scenario'
import { takeChatHandoff } from '@/features/agent/model/chat-handoff'
import { QUICK_PROMPTS, type QuickPrompt } from '@/views/agent/chat/components/workbench-constants'
import styles from '@/views/agent/chat/components/workbench.module.scss'

function ThreadWelcome() {
  const aui = useAui()

  function pick(item: QuickPrompt) {
    setActiveScenario(item.scenario)
    aui.composer.setText(item.label)
  }

  // 从磁贴点「完整会话」过来时，把这一轮与场景带进输入框（只用一次）
  useEffect(function () {
    const handoff = takeChatHandoff()
    if (!handoff) return
    setActiveScenario(handoff.scenario)
    aui.composer.setText(handoff.text)
  }, [aui])

  return (
    <div className={styles.welcome}>
      <div className={styles.welcomeInner}>
        <div className={styles.promptsGrid}>
          {QUICK_PROMPTS.map(function (item) {
            return (
              <Button
                key={item.key}
                type="button"
                variant="ghost"
                className={styles.promptCard}
                onClick={function () {
                  pick(item)
                }}>
                <span className={styles.promptIcon}>
                  <Icon
                    icon={item.icon}
                    width={16}
                    height={16}
                  />
                </span>
                <span className={styles.promptBody}>
                  <span className={styles.promptLabel}>{item.label}</span>
                  <span className={styles.promptDesc}>{item.description}</span>
                </span>
              </Button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export { ThreadWelcome }
