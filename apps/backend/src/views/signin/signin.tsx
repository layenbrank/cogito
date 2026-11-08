import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { SignInBrand } from '@/features/signin/brand.tsx'
import { SignInForm } from '@/features/signin/form.tsx'
import { findAuthToken, isAdmin } from '@/utils/auth.ts'

export default function SignInView() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  useEffect(
    function () {
      if (!findAuthToken() || !isAdmin()) return
      const next = searchParams.get('next') || '/overview'
      void navigate(next, { replace: true })
    },
    [navigate, searchParams]
  )

  return (
    <div className="grid min-h-dvh grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)] lg:grid-rows-[minmax(0,1fr)]">
      <SignInBrand />
      <section className="relative flex items-center justify-center bg-background px-6 py-10 sm:px-10">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 hidden w-9 bg-[linear-gradient(90deg,color-mix(in_oklab,var(--backend-accent)_16%,transparent),transparent)] lg:block"
        />
        <SignInForm />
      </section>
    </div>
  )
}
