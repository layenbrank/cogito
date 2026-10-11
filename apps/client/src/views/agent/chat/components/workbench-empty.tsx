import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'

import { Glide } from '@/components/glide/glide'
import { QUICK_PROMPTS, type QuickPrompt } from './workbench-constants'
import styles from './workbench.module.scss'

interface WorkbenchEmptyProps {
  onQuickPrompt: (item: QuickPrompt) => void
}

function WorkbenchEmpty(props: WorkbenchEmptyProps) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyInner}>
        <div className={styles.welcome}>
          <span className={styles.emptyIcon}>
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
                    props.onQuickPrompt(item)
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

export { WorkbenchEmpty }
export type { WorkbenchEmptyProps }
