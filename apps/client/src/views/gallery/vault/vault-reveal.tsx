import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { useRef, useState } from 'react'
import {
  FilmGrain,
  IrisWipe,
  Shader,
  SolidColor,
  Vignette,
  isWebGPUSupported
} from 'shaders/react'

import { findReducedMotion } from '@/features/window/appearance'

interface VaultRevealProps {
  active: boolean
  onDone: () => void
}

/** 解锁已隐藏时的单层 IrisWipe；无 WebGPU / reduced-motion 时直接完成 */
function VaultReveal(props: VaultRevealProps) {
  const [progress, onProgress] = useState(0)
  const progressRef = useRef({ value: 0 })

  useGSAP(
    function () {
      if (!props.active) {
        onProgress(0)
        progressRef.current.value = 0
        return
      }

      if (!isWebGPUSupported() || findReducedMotion()) {
        props.onDone()
        return
      }

      progressRef.current.value = 0
      onProgress(0)
      const tween = gsap.to(progressRef.current, {
        value: 1,
        duration: 0.55,
        ease: 'power2.inOut',
        onUpdate() {
          onProgress(progressRef.current.value)
        },
        onComplete() {
          props.onDone()
        }
      })
      return function () {
        tween.kill()
      }
    },
    { dependencies: [props.active] }
  )

  if (!props.active || !isWebGPUSupported()) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden" aria-hidden>
      <Shader className="size-full">
        <IrisWipe progress={progress} feather={0.14}>
          <Vignette color="#000000" radius={0.32} falloff={0.6} intensity={0.9}>
            <FilmGrain strength={0.045} bias={2} animated={false}>
              <SolidColor color="#0c0c0e" />
            </FilmGrain>
          </Vignette>
        </IrisWipe>
      </Shader>
    </div>
  )
}

export { VaultReveal }
export type { VaultRevealProps }
