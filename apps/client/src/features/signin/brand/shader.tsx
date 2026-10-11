import { useReducedMotion } from 'motion/react'
import {
  CursorRipples,
  FilmGrain,
  Shader,
  Swirl,
  isWebGPUSupported
} from 'shaders/react'

import styles from '../signin.module.scss'

/** 与品牌侧一致的深蓝 / 青绿停点 */
const BRAND_STOPS = [
  { color: '#0b1220', position: 0 },
  { color: '#134e5e', position: 0.28 },
  { color: '#1d4f91', position: 0.55 },
  { color: '#0f766e', position: 0.78 },
  { color: '#0b1220', position: 1 }
] as const

/** 登录左侧：Swirl 流动 + 轻波纹 + 细颗粒 */
function BrandShader() {
  const isReducedMotion = useReducedMotion()

  if (!isWebGPUSupported()) return null

  const band = (
    <Swirl
      stops={[...BRAND_STOPS]}
      colorSpace="oklab"
      blend={42}
      detail={0.85}
      speed={isReducedMotion ? 0 : 0.9}
    />
  )

  const body = isReducedMotion ? (
    band
  ) : (
    <CursorRipples
      intensity={11}
      decay={9}
      radius={0.55}
      chromaticSplit={0.18}
      edges="mirror">
      {band}
    </CursorRipples>
  )

  return (
    <div
      className={styles.brandShader}
      aria-hidden>
      <Shader className={styles.brandShaderMount}>
        <FilmGrain
          strength={isReducedMotion ? 0.12 : 0.18}
          bias={2}
          animated={!isReducedMotion}>
          {body}
        </FilmGrain>
      </Shader>
    </div>
  )
}

export { BrandShader }
