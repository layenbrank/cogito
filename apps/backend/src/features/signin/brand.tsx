import { useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { Suspense, lazy, useCallback, useEffect, useState } from 'react'

import {
  SIGNIN_CAPABILITIES,
  SIGNIN_COPY,
  SHADER_OPEN_MS,
  formatIndex
} from '@/features/signin/constants.ts'

const BrandShader = lazy(function () {
  return import('@/components/brand/shader.tsx').then(function (mod) {
    return { default: mod.BrandShader }
  })
})

function warmBrandShader() {
  void import('@/components/brand/shader.tsx')
}

function scheduleIdle(task: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(
      function () {
        task()
      },
      { timeout: 900 }
    )
    return function () {
      cancelIdleCallback(id)
    }
  }
  const timer = window.setTimeout(task, 120)
  return function () {
    window.clearTimeout(timer)
  }
}

function SignInBrand() {
  const isReducedMotion = useReducedMotion()
  const [isShaderReady, updateShaderReady] = useState(false)
  const [isUnavailable, updateUnavailable] = useState(false)

  const onUnavailable = useCallback(function () {
    updateUnavailable(true)
  }, [])

  useEffect(
    function () {
      warmBrandShader()

      let isCancelled = false
      let cancelIdle = function () {}
      const openTimer = window.setTimeout(
        function () {
          cancelIdle = scheduleIdle(function () {
            if (!isCancelled) updateShaderReady(true)
          })
        },
        isReducedMotion ? 0 : SHADER_OPEN_MS
      )

      return function () {
        isCancelled = true
        window.clearTimeout(openTimer)
        cancelIdle()
      }
    },
    [isReducedMotion]
  )

  const showsShader = isShaderReady && !isUnavailable
  const intro = isReducedMotion ? 0 : 0.45

  return (
    <aside className="relative isolate flex min-h-44 flex-col justify-between overflow-hidden bg-signin-brand px-6 py-7 text-signin-brand-foreground lg:min-h-0 lg:px-10 lg:py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(28%_22%_at_82%_28%,color-mix(in_oklab,var(--backend-accent)_24%,transparent),transparent_70%),radial-gradient(22%_18%_at_16%_82%,color-mix(in_oklab,var(--backend-accent)_14%,transparent),transparent_72%)]"
      />

      {showsShader ? (
        <Suspense fallback={null}>
          <m.div
            className="absolute inset-0 z-0"
            aria-hidden
            initial={isReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: intro * 0.85, ease: [0.22, 1, 0.36, 1] }}>
            <BrandShader onUnavailable={onUnavailable} />
          </m.div>
        </Suspense>
      ) : null}

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--signin-brand)_52%,transparent)_0%,transparent_28%,transparent_70%,color-mix(in_oklab,var(--signin-brand)_48%,transparent)_100%)]"
      />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col justify-between gap-7 pointer-events-none">
        <m.div
          className="max-w-xs border-l border-signin-brand-border pl-3.5"
          initial={isReducedMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: intro, ease: [0.22, 1, 0.36, 1] }}>
          <p className="text-xs font-medium tracking-widest text-signin-brand-faint uppercase">
            {SIGNIN_COPY.eyebrow}
          </p>
          <p className="mt-2 text-4xl leading-none font-semibold tracking-tight">
            {SIGNIN_COPY.brand}
          </p>
          <p className="mt-3 max-w-[16.25rem] text-sm leading-relaxed text-signin-brand-muted">
            {SIGNIN_COPY.tagline}
          </p>
        </m.div>

        <ul className="hidden min-h-0 flex-col divide-y divide-signin-brand-border/60 border-y border-signin-brand-border/60 lg:flex">
          {SIGNIN_CAPABILITIES.map(function (item, index) {
            return (
              <m.li
                key={item.key}
                className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3.5 py-3.5"
                initial={isReducedMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: isReducedMotion ? 0 : 0.32,
                  delay: isReducedMotion ? 0 : 0.08 + 0.05 * index,
                  ease: [0.22, 1, 0.36, 1]
                }}>
                <span className="pt-0.5 text-[11px] font-medium tracking-wider text-signin-brand-faint tabular-nums">
                  {formatIndex(index)}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <strong className="text-sm font-semibold tracking-tight">{item.title}</strong>
                  <span className="text-xs leading-snug text-signin-brand-subtle">{item.detail}</span>
                </span>
              </m.li>
            )
          })}
        </ul>
      </div>

      <p className="relative z-10 mt-7 text-[11px] tracking-wide text-signin-brand-faint pointer-events-none">
        {SIGNIN_COPY.foot}
      </p>
    </aside>
  )
}

export { SignInBrand }
