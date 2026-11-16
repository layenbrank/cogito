import { useReducedMotion } from 'motion/react'
import {
  Circle,
  FilmGrain,
  FloatingParticles,
  LinearGradient,
  Ring,
  RoundedRect,
  Shader,
  Vignette,
  isWebGPUSupported
} from 'shaders/react'

import styles from '../signin.module.scss'

/**
 * 品牌 shader ——「思 · 台」。
 *
 * 性能约束（实测：登录弹窗一挂 WebGPU 就把整个应用冻住，连浮层窗口一起卡）：
 * 460×520 画布上量「挂载后最大帧间隔」：
 * - 仅 LinearGradient            ≈ 115ms
 * - + 形状 / 粒子 / 晕影 / 颗粒  ≈ 380ms
 * - **再叠一个 `FlowingGradient` ≈ 1370ms** —— 它单独就吃掉 1 秒，故移除；
 *   动态感改由缓慢漂浮的粒子提供（粒子那档几乎不增加开销）。
 *
 * 另外：不做 RTT（原 `CursorRipples` 会把整棵子树重建成离屏 pass 并接管指针），
 * `FilmGrain` 静态、形状角度固定，开 `disableTelemetry` 不去外网上报采样。
 * 挂载时机由 `Brand` 控制（开场动画结束 + 空闲 + 窗口可见），这里不做二次改树。
 */

const DESK_STOPS = [
  { color: '#0a0d18', position: 0 },
  { color: '#0c1020', position: 0.5 },
  { color: '#080a14', position: 1 }
] as const

const SHAPE = '#9aa6f0'
const SHAPE_SOFT = '#6b78d4'

/** 粒子数：够看出层次即可，再多就是纯 GPU 负担 */
const PARTICLE_COUNT = 48

interface BrandShaderProps {
  onUnavailable?: () => void
}

function BrandShader(props: BrandShaderProps) {
  const isReducedMotion = useReducedMotion()

  if (!isWebGPUSupported()) return null

  const speed = isReducedMotion ? 0 : 1

  const scene = (
    <>
      <LinearGradient
        stops={[...DESK_STOPS]}
        colorSpace="oklab"
        start={{ x: 0, y: 0 }}
        end={{ x: 0.15, y: 1 }}
      />

      <Ring
        center={{ x: 0.8, y: 0.48 }}
        color={SHAPE}
        radius={0.18}
        thickness={0.01}
        softness={0.012}
        opacity={0.4}
        blendMode="screen"
      />

      <RoundedRect
        center={{ x: 0.76, y: 0.55 }}
        color={SHAPE_SOFT}
        width={0.12}
        height={0.09}
        rounding={0.04}
        rotation={-6}
        softness={0.015}
        opacity={0.24}
        blendMode="screen"
      />

      <RoundedRect
        center={{ x: 0.88, y: 0.62 }}
        color="transparent"
        width={0.1}
        height={0.1}
        rounding={0.032}
        rotation={12}
        softness={0.008}
        strokeThickness={0.007}
        strokeColor={SHAPE}
        strokePosition="center"
        opacity={0.48}
        blendMode="screen"
      />

      <RoundedRect
        center={{ x: 0.7, y: 0.74 }}
        color="transparent"
        width={0.08}
        height={0.06}
        rounding={0.028}
        rotation={-14}
        softness={0.008}
        strokeThickness={0.006}
        strokeColor={SHAPE}
        strokePosition="center"
        opacity={0.36}
        blendMode="screen"
      />

      <Circle
        center={{ x: 0.9, y: 0.78 }}
        color="transparent"
        radius={0.045}
        softness={0.008}
        strokeThickness={0.005}
        strokeColor={SHAPE}
        strokePosition="center"
        opacity={0.34}
        blendMode="screen"
      />

      <FloatingParticles
        particleColor="#c4cdf5"
        shape="dot"
        count={PARTICLE_COUNT}
        particleSize={0.5}
        softness={0.35}
        speed={0.06 * speed}
        angle={70}
        speedVariance={0.55}
        angleVariance={50}
        randomness={0.45}
        opacity={0.28}
        blendMode="screen"
      />
    </>
  )

  return (
    <Shader
      className={styles.brandShaderMount}
      // 桌面端登录页不需要向 shaders.com 上报采样（默认开启，会定时 fetch）
      disableTelemetry
      onUnavailable={props.onUnavailable}>
      {scene}

      <Vignette
        color="#05070f"
        center={{ x: 0.4, y: 0.48 }}
        radius={0.94}
        falloff={0.55}
        intensity={0.32}
      />

      <FilmGrain
        strength={0.02}
        bias={2.5}
        animated={false}
      />
    </Shader>
  )
}

export { BrandShader }
export type { BrandShaderProps }
