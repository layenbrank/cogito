import { useReducedMotion } from 'motion/react'
import {
  CursorRipples,
  FilmGrain,
  FloatingParticles,
  LinearGradient,
  ReflectivePlane,
  Shader,
  Vignette,
  WaveDistortion,
  isWebGPUSupported
} from 'shaders/react'

import styles from '../signin.module.scss'

/**
 * 品牌 shader ——「天在水」：夜色星空落进水面。
 *
 * 上半是靛蓝夜空与星，HORIZON 处一条细地平线，下半是真实镜像的水面：
 * 星被 ReflectivePlane 镜像到水面下，再用两层横向波纹（只作用于水面）打散；
 * 指针移动时搅动水面。取色避开绿色：靛蓝 / 月白 / 墨，与产品主色同族。
 *
 * 两条硬约束（踩出来的）：
 * 1. 这个库里任何“效果层”都会把之前的粒子层抹掉 —— 所以“天上的星”必须在
 *    所有效果之后重画一次；ReflectivePlane 之前那份星只用于生成倒影。
 * 2. 遮罩（maskSource + maskType="luminance"）只对效果稳定生效，粒子层要用
 *    boundingBox 限定生成区域。
 */

/** 夜空渐变：顶部靛蓝 → 地平线前抬亮 → 水面压回墨色 */
const SKY_STOPS = [
  { color: '#0a1233', position: 0 },
  { color: '#0d1840', position: 0.3 },
  { color: '#16224f', position: 0.52 },
  { color: '#1d2a5c', position: 0.61 },
  { color: '#05070f', position: 1 }
] as const

/** 地平线高度（uv）：天空与水面在此分界 */
const HORIZON = 0.62

const STAR_COLOR = '#e8efff'

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
      {/* 夜空底色 */}
      <LinearGradient
        stops={[...SKY_STOPS]}
        colorSpace="oklab"
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      {/* 星（倒影的光源）：这一份会参与 ReflectivePlane 的镜像，之后会被效果抹掉 */}
      <FloatingParticles
        count={300}
        speed={0.02 * speed}
        angle={90}
        speedVariance={0.1}
        angleVariance={180}
        randomness={0.1}
        twinkle={isReducedMotion ? 0 : 0.6}
        particleSize={0.8}
        softness={0.2}
        shape="dot"
        particleColor="#dbe6ff"
        cursorStrength={0}
        opacity={0.9}
      />

      {/* 水面：镜像地平线以上的内容，近处清晰、向深处渐隐渐糊 */}
      <ReflectivePlane
        height={HORIZON}
        distance={0.45}
        falloff={0.35}
        blur={1.6}
        blurDistance={0.35}
        edges="mirror"
      />

      {/* 水面遮罩：地平线以下为白（配合 maskType="luminance"） */}
      <LinearGradient
        id="water"
        visible={false}
        stops={[
          { color: '#000000', position: 0 },
          { color: '#000000', position: HORIZON - 0.02 },
          { color: '#ffffff', position: HORIZON + 0.06 },
          { color: '#ffffff', position: 1 }
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      {/* 水面横向波纹：两层不同频率，打散倒影里的规律条纹 */}
      <WaveDistortion
        maskSource="water"
        maskType="luminance"
        strength={0.07}
        frequency={3.2}
        speed={0.55 * speed}
        angle={0}
        waveType="sine"
        edges="mirror"
      />
      <WaveDistortion
        maskSource="water"
        maskType="luminance"
        strength={0.035}
        frequency={7}
        speed={0.9 * speed}
        angle={4}
        waveType="sine"
        edges="mirror"
      />

      {/* 地平线：水天的分界微光 */}
      <LinearGradient
        stops={[
          { color: '#0b1436', position: HORIZON - 0.14 },
          { color: '#8fb4ff', position: HORIZON - 0.01 },
          { color: '#05070f', position: HORIZON + 0.14 }
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        colorSpace="oklab"
        opacity={0.42}
        blendMode="screen"
      />

      {/* 指针搅动水面：涟漪只在水里，reduced-motion 下完全不挂 */}
      {!isReducedMotion && (
        <CursorRipples
          maskSource="water"
          maskType="luminance"
          intensity={7}
          decay={12}
          radius={0.35}
          chromaticSplit={0.05}
          edges="mirror"
        />
      )}

      <Vignette
        color="#01020a"
        center={{ x: 0.4, y: 0.42 }}
        radius={0.55}
        falloff={0.95}
        intensity={0.72}
      />

      <FilmGrain
        strength={0.08}
        bias={2.5}
        animated={!isReducedMotion}
      />

      {/* 水面压暗：离地平线越远越沉 */}
      <LinearGradient
        maskSource="water"
        maskType="luminance"
        stops={[
          { color: '#05070f', position: HORIZON - 0.02 },
          { color: '#081026', position: HORIZON + 0.08 },
          { color: '#03040a', position: 1 }
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        colorSpace="oklab"
        opacity={0.55}
      />

      {/* 天上的星：必须在所有效果之后，否则会被抹掉 */}
      <FloatingParticles
        boundingBox={{
          x: { unit: 'uv', value: 0 },
          y: { unit: 'uv', value: 0 },
          width: { unit: 'uv', value: 1 },
          height: { unit: 'uv', value: HORIZON },
          origin: 'top-left'
        }}
        count={240}
        speed={0.02 * speed}
        angle={90}
        speedVariance={0.1}
        angleVariance={180}
        randomness={0.1}
        twinkle={isReducedMotion ? 0 : 0.9}
        particleSize={0.75}
        softness={0.2}
        shape="dot"
        particleColor={STAR_COLOR}
        cursorStrength={0}
        opacity={0.95}
      />
    </Shader>
  )
}

export { BrandShader }
export type { BrandShaderProps }
