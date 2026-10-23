import { Button } from '@cogito/design/components/button'
import { Checkbox } from '@cogito/design/components/checkbox'
import { Input } from '@cogito/design/components/input'
import { Label } from '@cogito/design/components/label'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { POST_SIGNIN, type SlideProof } from '@/apis/auth.ts'
import { BrandShader } from '@/components/brand/shader.tsx'
import { SlideDialog } from '@/features/signin/slide-dialog.tsx'
import {
  findAuthToken,
  findRememberedUsername,
  isAdmin,
  writeAuthToken,
  writeRememberedUsername
} from '@/utils/auth.ts'
import { HttpError } from '@/utils/http/errors.ts'

export default function SignInView() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [username, updateUsername] = useState(function () {
    return findRememberedUsername() ?? ''
  })
  const [password, updatePassword] = useState('')
  const [isRemembered, updateRemembered] = useState(true)
  const [isSubmitting, updateSubmitting] = useState(false)
  const [isCaptchaOpen, updateCaptchaOpen] = useState(false)

  useEffect(
    function () {
      if (!findAuthToken() || !isAdmin()) return
      const next = searchParams.get('next') || '/overview'
      void navigate(next, { replace: true })
    },
    [navigate, searchParams]
  )

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!username.trim() || !password) {
      toast.error('请输入用户名和密码')
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
        toast.error('仅平台管理员可进入 Backend Console')
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

  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_0.9fr]">
      <section className="relative hidden overflow-hidden lg:block">
        <BrandShader />
        <div className="relative z-10 flex h-full flex-col justify-between p-10 text-[var(--signin-brand-foreground)]">
          <p className="text-sm tracking-[0.2em] uppercase opacity-80">cogito</p>
          <div>
            <h1 className="max-w-md text-4xl font-semibold tracking-tight">Backend Console</h1>
            <p className="mt-3 max-w-sm text-sm text-[var(--signin-brand-muted)]">
              平台运维工作台：身份、网关、计费与运行时，一处编排。
            </p>
          </div>
          <p className="text-xs text-[var(--signin-brand-subtle)]">仅 ADMIN · 纯 Web · 对接 cogito</p>
        </div>
      </section>

      <section className="flex items-center justify-center bg-background p-8">
        <form
          className="w-full max-w-sm space-y-5"
          onSubmit={handleSubmit}>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">登录</h2>
            <p className="mt-1 text-sm text-muted-foreground">使用平台管理员账号</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="username">用户名</Label>
            <Input
              id="username"
              autoComplete="username"
              value={username}
              onChange={function (event) {
                updateUsername(event.target.value)
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={function (event) {
                updatePassword(event.target.value)
              }}
            />
          </div>
          <Label className="flex items-center gap-2 font-normal text-muted-foreground">
            <Checkbox
              checked={isRemembered}
              onCheckedChange={function (checked) {
                updateRemembered(checked === true)
              }}
            />
            记住我
          </Label>
          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting}>
            {isSubmitting ? '登录中…' : '进入控制台'}
          </Button>
        </form>
      </section>

      <SlideDialog
        open={isCaptchaOpen}
        onFinish={function (proof) {
          void completeSignIn(proof)
        }}
      />
    </div>
  )
}
