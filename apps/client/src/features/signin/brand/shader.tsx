import { useReducedMotion } from 'motion/react'
import {
  CursorTrail,
  FilmGrain,
  Grid,
  LinearGradient,
  RadialGradient,
  Ripples,
  Shader,
  Vignette,
  isWebGPUSupported
} from 'shaders/react'

import styles from '../signin.module.scss'

/**
 * 品牌 shader ——「思 · 台」：cogito（我思故我在）的品牌视觉。
 *
 * 产品是一块「桌面工作台」，装下磁贴、Agent、镜像与指令；名字取自笛卡尔
 * 「我思」。画面因此是「一块暗色工作台，一个念头荡开涟漪，光标划过留痕」：
 *   - RadialGradient：右上角一束蓝紫光晕（思维之光）；
 *   - Ripples：从光晕中心荡开的同心涟漪（思维的扩散）；
 *   - Grid：桌面网格（工作台的秩序感，坐标纸线框）；
 *   - CursorTrail：光标拖出渐隐渐细的光尾（思考的轨迹）。
 *
 * 配色全部落在品牌主色族（--primary oklch 0.488 0.243 264，蓝紫），避开绿色。
 */

/** 桌面底色：顶部微亮、向下沉入深靛蓝，对齐 --signin-brand（oklch 0.18 0.008 264） */
const DESK_STOPS = [
  { color: '#0d1230', position: 0 },
  { color: '#0b0e20', position: 0.55 },
  { color: '#080a18', position: 1 }
] as const

/** 品牌蓝紫主光（--primary 同族 264°） */
const BRAND_GLOW = '#8b7cf6'

interface BrandShaderProps {
  /** WebGPU/驱动不可用时回调，由挂载层退回 CSS 兜底 */
  onUnavailable?: () => void
}

function BrandShader(props: BrandShaderProps) {
  const isReducedMotion = useReducedMotion()

  if (!isWebGPUSupported()) return null

  const speed = isReducedMotion ? 0 : 1

  return (
    <Shader
      className={styles.brandShaderMount}
      onUnavailable={props.onUnavailable}>
      {/* 桌面底色 */}
      <LinearGradient
        stops={[...DESK_STOPS]}
        colorSpace="oklab"
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      {/* 思维的扩散：从光晕中心荡开的同心涟漪 */}
      <Ripples
        center={{ x: 0.72, y: 0.2 }}
        colorA="#9d8cff"
        colorB="#000000"
        speed={0.8 * speed}
        frequency={20}
        softness={0.6}
        thickness={0.3}
        opacity={0.3}
        blendMode="screen"
      />

      {/* 思维之光：右上角一团蓝紫光晕（椭圆拉宽，漫向桌面） */}
      <RadialGradient
        center={{ x: 0.72, y: 0.2 }}
        radius={0.95}
        aspect={0.55}
        skewAngle={-18}
        colorA={BRAND_GLOW}
        colorB="#0b0e20"
        colorSpace="oklab"
        opacity={0.55}
        blendMode="screen"
      />

      {/* 桌面网格：工作台的秩序感，纯线框坐标纸 */}
      <Grid
        cells={24}
        thickness={0.28}
        color="#b6c0f8"
        softness={0.08}
        opacity={0.55}
        blendMode="screen"
      />

      {/* 思考的轨迹：光标拖尾，渐隐渐细 */}
      {!isReducedMotion && (
        <CursorTrail
          colorA="#c7d2fe"
          colorB="#7c5cf6"
          radius={0.35}
          length={0.4}
          shrink={0.9}
          softness={0.25}
          colorSpace="oklch"
          opacity={0.8}
          blendMode="screen"
        />
      )}

      <Vignette
        color="#04050c"
        center={{ x: 0.5, y: 0.45 }}
        radius={0.7}
        falloff={0.6}
        intensity={0.6}
      />

      <FilmGrain
        strength={0.05}
        bias={2.5}
        animated={!isReducedMotion}
      />
    </Shader>
  )
}

export { BrandShader }
export type { BrandShaderProps }
