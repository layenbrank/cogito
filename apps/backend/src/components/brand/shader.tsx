import { useReducedMotion } from 'motion/react'
import { CursorRipples, FilmGrain, Shader, Swirl, isWebGPUSupported } from 'shaders/react'

const BRAND_STOPS = [
  { color: '#0b1220', position: 0 },
  { color: '#134e5e', position: 0.28 },
  { color: '#1d4f91', position: 0.55 },
  { color: '#0f766e', position: 0.78 },
  { color: '#0b1220', position: 1 }
] as const

function BrandShader() {
  const isReducedMotion = useReducedMotion()

  if (!isWebGPUSupported()) {
    return <div className="absolute inset-0 bg-[oklch(0.18_0.008_264)]" />
  }

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
    <Shader className="absolute inset-0 h-full w-full">
      <FilmGrain
        strength={isReducedMotion ? 0.12 : 0.18}
        bias={2}
        animated={!isReducedMotion}>
        {body}
      </FilmGrain>
    </Shader>
  )
}

export { BrandShader }
