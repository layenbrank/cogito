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

/**
 * 品牌 shader ——「思 · 台」。
 *
 * client 与 backend 共用这一棵场景，避免登录页各画一套。
 * 不做 FlowingGradient / CursorRipples：前者把登录窗冻住约 1s，后者会接管指针并重建离屏 pass。
 * 动态只来自慢速粒子。FilmGrain 静态。disableTelemetry 不去外网上报。
 */

const DESK_STOPS = [
  { color: '#0a0d18', position: 0 },
  { color: '#0c1020', position: 0.5 },
  { color: '#080a14', position: 1 }
] as const

const SHAPE = '#9aa6f0'
const SHAPE_SOFT = '#6b78d4'
const PARTICLE_COUNT = 48

interface BrandShaderProps {
  className?: string
  onUnavailable?: () => void
}

function BrandShader(props: BrandShaderProps) {
  const isReducedMotion = useReducedMotion()

  if (!isWebGPUSupported()) return null

  const speed = isReducedMotion ? 0 : 1

  return (
    <Shader
      className={props.className}
      disableTelemetry
      onUnavailable={props.onUnavailable}>
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
