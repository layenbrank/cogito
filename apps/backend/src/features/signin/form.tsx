import { Button } from '@cogito/design/components/button'
import { Checkbox } from '@cogito/design/components/checkbox'
import { Label } from '@cogito/design/components/label'
import { Spinner } from '@cogito/design/components/spinner'
import { useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { POST_SIGNIN, type SlideProof } from '@/apis/auth.ts'
import { SIGNIN_COPY } from '@/features/signin/constants.ts'
import { SignInField } from '@/features/signin/field.tsx'
import { SlideDialog } from '@/features/signin/slide-dialog.tsx'
import {
  findRememberedUsername,
  isAdmin,
  writeAuthToken,
  writeRememberedUsername
} from '@/utils/auth.ts'
import { HttpError } from '@/utils/http/errors.ts'

interface SignInErrors {
  username?: string
  password?: string
}

function parseSignInErrors(username: string, password: string): SignInErrors {
  const errors: SignInErrors = {}
  if (!username.trim()) errors.username = SIGNIN_COPY.usernameRequired
  if (!password) errors.password = SIGNIN_COPY.passwordRequired
  return errors
}

function SignInForm() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isReducedMotion = useReducedMotion()
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const [username, updateUsername] = useState(function () {
    return findRememberedUsername() ?? ''
  })
  const [password, updatePassword] = useState('')
  const [isRemembered, updateRemembered] = useState(true)
  const [isSubmitting, updateSubmitting] = useState(false)
  const [isCaptchaOpen, updateCaptchaOpen] = useState(false)
  const [errors, updateErrors] = useState<SignInErrors>({})

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const nextErrors = parseSignInErrors(username, password)
    updateErrors(nextErrors)
    if (nextErrors.username) {
      usernameRef.current?.focus()
      return
    }
    if (nextErrors.password) {
      passwordRef.current?.focus()
      return
    }
    updateCaptchaOpen(true)
  }

  async function completeSignIn(proof: SlideProof | null) {
    updateCaptchaOpen(false)
    if (!proof) return

    updateSubmitting(true)
    try {
      const session = await POST_SIGNIN({
        username: username.trim(),
        password,
        ...proof
      })
      writeAuthToken(session.token, isRemembered)
      writeRememberedUsername(isRemembered ? session.username : null)

      if (session.role !== 'ADMIN' && !isAdmin()) {
        toast.error(SIGNIN_COPY.adminOnly)
        return
      }

      const next = searchParams.get('next') || '/overview'
      void navigate(next, { replace: true })
    } catch (error) {
      const http = HttpError(error)
      toast.error(http.message + (http.traceId ? ` · ${http.traceId}` : ''))
    } finally {
      updateSubmitting(false)
    }
  }

  const intro = isReducedMotion ? 0 : 0.38

  return (
    <>
      <m.form
        noValidate
        className="w-full max-w-[22.5rem] select-text space-y-6"
        initial={isReducedMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: intro, ease: [0.22, 1, 0.36, 1] }}
        onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
            Backend Console
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{SIGNIN_COPY.title}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">{SIGNIN_COPY.subtitle}</p>
        </div>

        <div className="space-y-4">
          <SignInField
            id="username"
            label={SIGNIN_COPY.username}
            icon="lucide:user"
            value={username}
            placeholder={SIGNIN_COPY.usernamePlaceholder}
            autoComplete="username"
            autoFocus={!username}
            error={errors.username}
            disabled={isSubmitting}
            inputRef={usernameRef}
            onValueChange={function (next) {
              updateUsername(next)
              if (errors.username) {
                updateErrors(function (current) {
                  return { ...current, username: undefined }
                })
              }
            }}
          />
          <SignInField
            id="password"
            label={SIGNIN_COPY.password}
            icon="lucide:lock"
            type="password"
            value={password}
            placeholder={SIGNIN_COPY.passwordPlaceholder}
            autoComplete="current-password"
            autoFocus={Boolean(username)}
            error={errors.password}
            disabled={isSubmitting}
            inputRef={passwordRef}
            onValueChange={function (next) {
              updatePassword(next)
              if (errors.password) {
                updateErrors(function (current) {
                  return { ...current, password: undefined }
                })
              }
            }}
          />
        </div>

        <Label className="flex min-h-11 items-center gap-2 font-normal text-muted-foreground">
          <Checkbox
            checked={isRemembered}
            disabled={isSubmitting}
            onCheckedChange={function (checked) {
              updateRemembered(checked === true)
            }}
          />
          {SIGNIN_COPY.remember}
        </Label>

        <Button
          type="submit"
          size="lg"
          className="h-11 w-full gap-2"
          disabled={isSubmitting}
          aria-busy={isSubmitting}>
          {isSubmitting ? (
            <>
              <Spinner className="size-4" />
              {SIGNIN_COPY.submitting}
            </>
          ) : (
            SIGNIN_COPY.submit
          )}
        </Button>
      </m.form>

      <SlideDialog
        open={isCaptchaOpen}
        onFinish={function (proof) {
          void completeSignIn(proof)
        }}
      />
    </>
  )
}

export { SignInForm }
