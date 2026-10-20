import { useReducedMotion } from 'motion/react'
import { FilmGrain, Shader, Swirl, isWebGPUSupported } from 'shaders/react'

const STOPS = [
  { color: '#eef2ff', position: 0 },
  { color: '#c7d2fe', position: 0.35 },
  { color: '#a5b4fc', position: 0.65 },
  { color: '#e0e7ff', position: 1 }
] as const

function EmptyAtmosphere() {
  const isReducedMotion = useReducedMotion()

  if (!isWebGPUSupported() || isReducedMotion) {
    return (
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 30% 20%, color-mix(in oklab, var(--primary) 18%, transparent), transparent 60%), radial-gradient(ellipse 60% 40% at 80% 80%, color-mix(in oklab, var(--success) 12%, transparent), transparent 55%)'
        }}
      />
    )
  }

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-[0.12]">
      <Shader className="size-full">
        <FilmGrain
          strength={0.05}
          bias={2}
          animated={false}>
          <Swirl
            stops={[...STOPS]}
            colorSpace="oklab"
            blend={36}
            detail={0.7}
            speed={0.55}
          />
        </FilmGrain>
      </Shader>
    </div>
  )
}

export { EmptyAtmosphere }
