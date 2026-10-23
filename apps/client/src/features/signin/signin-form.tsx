import { Icon } from '@iconify/react/offline'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@cogito/design/components/button'
import { Checkbox } from '@cogito/design/components/checkbox'
import { Spinner } from '@cogito/design/components/spinner'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel
} from '@cogito/design/components/form'
import { Tabs, TabsList, TabsTrigger } from '@cogito/design/components/tabs'
import { useEffect, useRef } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { toast } from 'sonner'

import {
  POST_SIGNIN,
  POST_SIGNIN_EMAIL,
  POST_SIGNIN_PHONE,
  type SlideProof
} from '@/apis/auth.ts'
import { CaptchaField } from './captcha-field.tsx'
import {
  LIMIT,
  MODE,
  SIGNIN_SCHEMA,
  type AuthMode,
  type SigninValues
} from './constants.ts'
import { AuthField } from './field.tsx'
import { FormStagger, ModeSwap, MotionField } from './form-motion.tsx'
import styles from './signin.module.scss'
import { useSlideProof } from './slide'
import { HttpError } from '@/utils/http/errors.ts'
import { findRememberedUsername, writeAuthToken, writeRememberedUsername } from '@/utils/auth.ts'

type SigninFormProps = {
  motionKey: number
  signinMode: AuthMode
  onModeChange: (mode: AuthMode) => void
  onForgot: () => void
  onSignup: () => void
  onSuccess: () => void
}

interface SigninSession {
  token: string
  isRemembered: boolean
}

const SIGNIN: Record<
  AuthMode,
  (values: SigninValues, askSlide: () => Promise<SlideProof | null>) => Promise<SigninSession | null>
> = {
  async username(values, askSlide) {
    const proof = await askSlide()
    if (!proof) return null
    const session = await POST_SIGNIN({
      username: values.username ?? '',
      password: values.password ?? '',
      ...proof
    })
    return { token: session.token, isRemembered: values.remember !== false }
  },
  async phone(values) {
    const session = await POST_SIGNIN_PHONE({
      phone: values.phone ?? '',
      code: values.captcha ?? ''
    })
    return { token: session.token, isRemembered: true }
  },
  async email(values) {
    const session = await POST_SIGNIN_EMAIL({
      email: values.email ?? '',
      code: values.captcha ?? ''
    })
    return { token: session.token, isRemembered: true }
  }
}

function SigninForm(props: SigninFormProps) {
  const { motionKey, signinMode, onModeChange, onForgot, onSignup, onSuccess } = props
  const { askSlide, dialog } = useSlideProof()
  const modeRef = useRef(signinMode)

  useEffect(
    function () {
      modeRef.current = signinMode
    },
    [signinMode]
  )

  // resolver 读 modeRef，切换身份不必整表 useForm 重建
  const form = useForm<SigninValues>({
    resolver: async function (values, context, options) {
      const resolve = zodResolver(SIGNIN_SCHEMA[modeRef.current]) as Resolver<SigninValues>
      return resolve(values, context, options)
    },
    defaultValues: {
      remember: true,
      username: findRememberedUsername() ?? ''
    }
  })

  useEffect(
    function () {
      form.clearErrors()
      form.reset({
        remember: form.getValues('remember') !== false,
        username: signinMode === MODE.USERNAME ? (findRememberedUsername() ?? '') : undefined,
        phone: undefined,
        email: undefined,
        password: undefined,
        captcha: undefined
      })
    },
    [form, signinMode]
  )

  async function onSubmit(values: SigninValues) {
    try {
      const session = await SIGNIN[signinMode](values, askSlide)
      if (!session) return
      writeAuthToken(session.token, session.isRemembered)
      if (signinMode === MODE.USERNAME) {
        writeRememberedUsername(session.isRemembered ? (values.username ?? null) : null)
      }
      toast.success('登录成功')
      onSuccess()
    } catch (error) {
      toast.error(HttpError(error).message || '登录失败')
    }
  }

  const isPasswordMode = signinMode === MODE.USERNAME

  return (
    <Form {...form}>
      <form
        className={styles.form}
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}>
        {/* 仅面板进入时重建 stagger；mode 切换走 ModeSwap */}
        <FormStagger key={motionKey}>
          <MotionField className={styles.tabs}>
            <Tabs
              value={signinMode}
              onValueChange={function (value) {
                onModeChange(value as AuthMode)
              }}>
              <TabsList className="grid w-full grid-cols-3">
                {MODE.options.map(function (option) {
                  return (
                    <TabsTrigger
                      key={option.value}
                      value={option.value}>
                      {option.label}
                    </TabsTrigger>
                  )
                })}
              </TabsList>
            </Tabs>
          </MotionField>

          <MotionField>
            <ModeSwap mode={signinMode}>
              {signinMode === MODE.USERNAME && (
                <>
                  <div className={styles.fieldMotion}>
                    <AuthField
                      control={form.control}
                      name="username"
                      label="用户名"
                      placeholder="请输入用户名"
                      icon={<Icon icon="lucide:user" />}
                      maxLength={LIMIT.USERNAME}
                      autoComplete="username"
                    />
                  </div>
                  <div className={styles.fieldMotion}>
                    <AuthField
                      control={form.control}
                      name="password"
                      type="password"
                      label="密码"
                      placeholder="请输入密码"
                      icon={<Icon icon="lucide:lock" />}
                      maxLength={LIMIT.PASSWORD}
                      autoComplete="current-password"
                    />
                  </div>
                </>
              )}

              {signinMode === MODE.PHONE && (
                <>
                  <div className={styles.fieldMotion}>
                    <AuthField
                      control={form.control}
                      name="phone"
                      label="手机号"
                      placeholder="请输入手机号"
                      icon={<Icon icon="lucide:smartphone" />}
                      inputMode="numeric"
                      maxLength={LIMIT.PHONE}
                      autoComplete="tel"
                    />
                  </div>
                  <div className={styles.fieldMotion}>
                    <CaptchaField
                      key="phone-otp"
                      form={form}
                      mode={MODE.PHONE}
                      purpose="otp"
                      targetField="phone"
                      askSlide={askSlide}
                    />
                  </div>
                </>
              )}

              {signinMode === MODE.EMAIL && (
                <>
                  <div className={styles.fieldMotion}>
                    <AuthField
                      control={form.control}
                      name="email"
                      label="邮箱"
                      placeholder="请输入邮箱"
                      icon={<Icon icon="lucide:mail" />}
                      maxLength={LIMIT.EMAIL}
                      autoComplete="email"
                    />
                  </div>
                  <div className={styles.fieldMotion}>
                    <CaptchaField
                      key="email-otp"
                      form={form}
                      mode={MODE.EMAIL}
                      purpose="otp"
                      targetField="email"
                      askSlide={askSlide}
                    />
                  </div>
                </>
              )}
            </ModeSwap>
          </MotionField>

          <MotionField className={styles.extra}>
            {isPasswordMode ? (
              <FormField
                control={form.control}
                name="remember"
                render={function ({ field }) {
                  return (
                    <FormItem className="flex flex-row items-center gap-2 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value === true}
                          onCheckedChange={function (checked) {
                            field.onChange(checked === true)
                          }}
                        />
                      </FormControl>
                      <FormLabel className="font-normal">记住我</FormLabel>
                    </FormItem>
                  )
                }}
              />
            ) : (
              <span />
            )}
            <Button
              type="button"
              variant="link"
              className="h-auto p-0"
              onClick={onForgot}>
              忘记密码
            </Button>
          </MotionField>

          <MotionField className={styles.actions}>
            <Button
              type="submit"
              className="h-11 w-full gap-2 transition-[transform,box-shadow] duration-150 active:scale-[0.985]"
              disabled={form.formState.isSubmitting}
              aria-busy={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? (
                <>
                  <Spinner className="size-4" />
                  登录中…
                </>
              ) : (
                '登录'
              )}
            </Button>
            <div className={styles.signupHint}>
              <span>还没有账号？</span>
              <Button
                type="button"
                variant="link"
                className="h-auto p-0"
                disabled={form.formState.isSubmitting}
                onClick={onSignup}>
                注册
              </Button>
            </div>
          </MotionField>
        </FormStagger>
        {dialog}
      </form>
    </Form>
  )
}

export { SigninForm }
