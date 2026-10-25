import { useReducedMotion } from 'motion/react'
import {
  Circle,
  CursorRipples,
  FilmGrain,
  FloatingParticles,
  FlowingGradient,
  LinearGradient,
  Ring,
  RoundedRect,
  Shader,
  Vignette,
  isWebGPUSupported
} from 'shaders/react'

import { hushTypegpuNoise } from './hush-typegpu'
import styles from '../signin.module.scss'

/** CursorRipples 的 TypeGPU 噪音在 Vite 预打包副本上，须在 Shader 挂载前过滤 console。 */
hushTypegpuNoise()

/**
 * 品牌 shader ——「思 · 台」。
 *
 * 形状装饰 + 光标水波；无大半径柔边实心圆。
 */

const DESK_STOPS = [
  { color: '#0a0d18', position: 0 },
  { color: '#0c1020', position: 0.5 },
  { color: '#080a14', position: 1 }
] as const

const SHAPE = '#9aa6f0'
const SHAPE_SOFT = '#6b78d4'

interface BrandShaderProps {
  onUnavailable?: () => void
}

function BrandShader(props: BrandShaderProps) {
  const isReducedMotion = useReducedMotion()

  if (!isWebGPUSupported()) return null

  const speed = isReducedMotion ? 0 : 1
  const canInteract = !isReducedMotion

  // RoundedRect 类型只声明 rotation: number，运行时仍接受 auto-animate driver
  const tileARotation = canInteract
    ? {
        type: 'auto-animate' as const,
        mode: 'ping-pong' as const,
        outputMin: -10,
        outputMax: 8,
        speed: 0.07,
        easing: 'sine' as const
      }
    : -6

  const tileBRotation = canInteract
    ? {
        type: 'auto-animate' as const,
        mode: 'ping-pong' as const,
        outputMin: 4,
        outputMax: 18,
        speed: 0.09,
        easing: 'sine' as const
      }
    : 12

  const scene = (
    <>
      <LinearGradient
        stops={[...DESK_STOPS]}
        colorSpace="oklab"
        start={{ x: 0, y: 0 }}
        end={{ x: 0.15, y: 1 }}
      />

      <FlowingGradient
        colorA="#080b16"
        colorB="#121a36"
        colorC="#1a2860"
        colorD="#243878"
        colorSpace="oklab"
        speed={0.18 * speed}
        distortion={0.22}
        seed={2}
        opacity={0.35}
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
        rotation={tileARotation as number}
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
        rotation={tileBRotation as number}
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
        count={280}
        particleSize={0.5}
        softness={0.35}
        speed={0.08 * speed}
        angle={70}
        speedVariance={0.55}
        angleVariance={50}
        randomness={0.45}
        twinkle={canInteract ? 0.25 : 0}
        cursorStrength={canInteract ? 0.4 : 0}
        opacity={0.28}
        blendMode="screen"
      />
    </>
  )

  return (
    <Shader
      className={styles.brandShaderMount}
      onUnavailable={props.onUnavailable}>
      {canInteract ? (
        <CursorRipples
          intensity={7}
          decay={11}
          radius={0.48}
          chromaticSplit={0.12}
          edges="mirror">
          {scene}
        </CursorRipples>
      ) : (
        scene
      )}

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
        animated={canInteract}
      />
    </Shader>
  )
}

export { BrandShader }
export type { BrandShaderProps }
