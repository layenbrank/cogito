import { Icon } from '@iconify/react/offline'
import { useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { Suspense, lazy, useEffect, useState } from 'react'

import styles from '../signin.module.scss'

/** 与 Dialog 入场 (~200ms) 对齐，避免 WebGPU 初始化抢开场帧 */
const SHADER_DEFER_MS = 200

const BrandShader = lazy(function () {
  return import('./shader').then(function (mod) {
    return { default: mod.BrandShader }
  })
})

const TAGLINE = '一块桌面，装下磁贴、Agent 与指令。'
const FOOTNOTE = '© 2026 cogito'

/** 左侧能力叙事：磁贴 / Agent / 镜像 / 指令 */
const CAPABILITIES = [
  {
    key: 'tiles',
    icon: 'lucide:layout-grid',
    title: '磁贴',
    detail: '书签、日历、截屏、商店…一览随手开'
  },
  {
    key: 'agent',
    icon: 'lucide:sparkles',
    title: 'Agent',
    detail: 'AI Hub 对话与工具调用，留在同一处'
  },
  {
    key: 'mirror',
    icon: 'lucide:layers',
    title: '镜像',
    detail: '多工作台隔离，切换不丢现场'
  },
  {
    key: 'directive',
    icon: 'lucide:workflow',
    title: '指令',
    detail: '流水线与自动化，从上次停的地方接着跑'
  }
] as const

/** 预拉取 shader chunk，延迟期间即可下载，挂载时少等网络 */
function warmShaderChunk() {
  void import('./shader')
}

/** 登录弹窗左侧：品牌 + 延迟挂载的 shader 氛围 + 能力列表 */
function Brand() {
  const isReducedMotion = useReducedMotion()
  const [isShaderReady, setIsShaderReady] = useState(false)

  useEffect(
    function () {
      warmShaderChunk()

      let isCancelled = false
      let timer = 0
      let innerFrame = 0
      const outerFrame = requestAnimationFrame(function () {
        // 再等一帧，确保 Dialog 首屏已提交
        innerFrame = requestAnimationFrame(function () {
          timer = window.setTimeout(
            function () {
              if (!isCancelled) setIsShaderReady(true)
            },
            isReducedMotion ? 0 : SHADER_DEFER_MS
          )
        })
      })

      return function () {
        isCancelled = true
        cancelAnimationFrame(outerFrame)
        cancelAnimationFrame(innerFrame)
        window.clearTimeout(timer)
      }
    },
    [isReducedMotion]
  )

  return (
    <aside className={styles.brand}>
      {isShaderReady && (
        <Suspense fallback={null}>
          <m.div
            className={styles.brandShaderHost}
            aria-hidden
            initial={isReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{
              duration: isReducedMotion ? 0 : 0.4,
              ease: [0.22, 1, 0.36, 1]
            }}>
            <BrandShader />
          </m.div>
        </Suspense>
      )}
      <div className={styles.core}>
        <p className={styles.eyebrow}>桌面工作台</p>
        <h3>cogito</h3>
        <p className={styles.tagline}>{TAGLINE}</p>

        <ul className={styles.capabilities}>
          {CAPABILITIES.map(function (item, index) {
            return (
              <m.li
                key={item.key}
                className={styles.capability}
                initial={isReducedMotion ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: isReducedMotion ? 0 : 0.28,
                  delay: isReducedMotion ? 0 : 0.06 * index,
                  ease: [0.22, 1, 0.36, 1]
                }}>
                <span
                  className={styles.capabilityIcon}
                  aria-hidden>
                  <Icon icon={item.icon} />
                </span>
                <span className={styles.capabilityBody}>
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </span>
              </m.li>
            )
          })}
        </ul>
      </div>
      <footer className={styles.foot}>{FOOTNOTE}</footer>
    </aside>
  )
}

export { Brand }
