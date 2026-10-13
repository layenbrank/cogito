/**
 * 空会话欢迎页（`Thread` 的 `Welcome` 槽位）。
 *
 * 只负责把一条快捷提示放进输入框 —— 提示里带的 `scenario` 目前只作导航/归类用，
 * 不再包一层 prompt（goose 自己管计划/对比这类能力，见 PR6 设置面）。
 */
import { useAui } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'

import { Glide } from '@/components/glide/glide'
import { QUICK_PROMPTS, type QuickPrompt } from '@/views/agent/chat/components/workbench-constants'
import styles from '@/views/agent/chat/components/workbench.module.scss'

function ThreadWelcome() {
  const aui = useAui()

  function pick(item: QuickPrompt) {
    aui.composer.setText(item.label)
  }

  return (
    <div className={styles.welcome}>
      <div className={styles.welcomeInner}>
        <div className={styles.welcomeHead}>
          <span className={styles.welcomeIcon}>
            <Icon
              icon="lucide:bot"
              width={24}
              height={24}
            />
          </span>
          <h2 className={styles.welcomeTitle}>你好，我是 i-thinking 智能助手</h2>
          <p className={styles.welcomeDesc}>
            聊天、文件分析、代码编辑、图像理解、商品对比与日程规划，开箱即用
          </p>
        </div>
        <div className={clsx(styles.prompts, styles.promptReveal)}>
          <div className={styles.promptsTitle}>可以试试</div>
          <Glide.X
            classNames={{
              root: styles.promptsGlide,
              inner: styles.promptsTrack
            }}>
            {QUICK_PROMPTS.map(function (item) {
              return (
                <button
                  key={item.key}
                  type="button"
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
                </button>
              )
            })}
          </Glide.X>
        </div>
      </div>
    </div>
  )
}

export { ThreadWelcome }
