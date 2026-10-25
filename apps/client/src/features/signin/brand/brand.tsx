import { useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { Suspense, lazy, useCallback, useEffect, useState } from 'react'

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

/** 左侧能力叙事：索引式排版，取代图标方块 */
const CAPABILITIES = [
  {
    key: 'tiles',
    title: '磁贴',
    detail: '书签、日历、截屏、商店…一览随手开'
  },
  {
    key: 'agent',
    title: 'Agent',
    detail: 'AI Hub 对话与工具调用，留在同一处'
  },
  {
    key: 'mirror',
    title: '镜像',
    detail: '多工作台隔离，切换不丢现场'
  },
  {
    key: 'directive',
    title: '指令',
    detail: '流水线与自动化，从上次停的地方接着跑'
  }
] as const

function warmShaderChunk() {
  void import('./shader')
}

function formatIndex(index: number) {
  return String(index + 1).padStart(2, '0')
}

interface BrandProps {
  /** 本次打开的入场时长（ms），首次与后续不同，见 ./intro */
  introMs: number
}

/** 登录弹窗左侧：品牌英雄 + 缎面 shader + 索引能力列表 */
function Brand(props: BrandProps) {
  const isReducedMotion = useReducedMotion()
  const [isShaderReady, setIsShaderReady] = useState(false)
  const [isShaderUnavailable, setIsShaderUnavailable] = useState(false)

  const onShaderUnavailable = useCallback(function () {
    setIsShaderUnavailable(true)
  }, [])

  useEffect(
    function () {
      warmShaderChunk()

      let isCancelled = false
      let timer = 0
      let innerFrame = 0
      const outerFrame = requestAnimationFrame(function () {
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

  const introSeconds = isReducedMotion ? 0 : props.introMs / 1000

  return (
    <aside className={styles.brand}>
      {isShaderReady && !isShaderUnavailable && (
        <Suspense fallback={null}>
          <m.div
            className={styles.brandShaderHost}
            aria-hidden
            initial={isReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: introSeconds * 0.85, ease: [0.22, 1, 0.36, 1] }}>
            <BrandShader onUnavailable={onShaderUnavailable} />
          </m.div>
        </Suspense>
      )}

      <div className={styles.core}>
        <m.div
          className={styles.brandHero}
          initial={isReducedMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: isReducedMotion ? 0 : 0.45,
            ease: [0.22, 1, 0.36, 1]
          }}>
          <p className={styles.eyebrow}>桌面工作台</p>
          <h3 className={styles.brandName}>cogito</h3>
          <p className={styles.tagline}>{TAGLINE}</p>
        </m.div>

        <ul className={styles.capabilities}>
          {CAPABILITIES.map(function (item, index) {
            return (
              <m.li
                key={item.key}
                className={styles.capability}
                initial={isReducedMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: isReducedMotion ? 0 : 0.32,
                  delay: isReducedMotion ? 0 : 0.08 + 0.05 * index,
                  ease: [0.22, 1, 0.36, 1]
                }}>
                <span
                  className={styles.capabilityIndex}
                  aria-hidden>
                  {formatIndex(index)}
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
export type { BrandProps }
