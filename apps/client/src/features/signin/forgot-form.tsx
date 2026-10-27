import { Icon } from '@iconify/react/offline'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@cogito/design/components/button'
import { Form } from '@cogito/design/components/form'
import { Spinner } from '@cogito/design/components/spinner'
import { Tabs, TabsList, TabsTrigger } from '@cogito/design/components/tabs'
import { useEffect, useRef } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { toast } from 'sonner'

import { POST_PASSWORD_RESET } from '@/apis/auth.ts'
import {
  CHANNEL,
  FORGOT_SCHEMA,
  LIMIT,
  MODE,
  type AuthMode,
  type ForgotValues
} from './constants.ts'
import { CaptchaField } from './captcha-field.tsx'
import { AuthField } from './field.tsx'
import { FormStagger, ModeSwap, MotionField } from './form-motion.tsx'
import styles from './signin.module.scss'
import { useSlideProof } from './slide'
import { HttpError } from '@/utils/http/errors.ts'

type ForgotFormProps = {
  motionKey: number
  forgotMode: AuthMode
  onModeChange: (mode: AuthMode) => void
  onSignin: () => void
}

const RESET: Record<AuthMode, (values: ForgotValues) => Promise<unknown>> = {
  username(values) {
    return POST_PASSWORD_RESET({
      username: values.username ?? '',
      code: values.captcha ?? '',
      newPassword: values.password ?? ''
    })
  },
  phone(values) {
    return POST_PASSWORD_RESET({
      channel: CHANNEL.phone,
      target: values.phone ?? '',
      code: values.captcha ?? '',
      newPassword: values.password ?? ''
    })
  },
  email(values) {
    return POST_PASSWORD_RESET({
      channel: CHANNEL.email,
      target: values.email ?? '',
      code: values.captcha ?? '',
      newPassword: values.password ?? ''
    })
  }
}

function ForgotForm(props: ForgotFormProps) {
  const { motionKey, forgotMode, onModeChange, onSignin } = props
  const { askSlide, dialog } = useSlideProof()
  const modeRef = useRef(forgotMode)

  useEffect(
    function () {
      modeRef.current = forgotMode
    },
    [forgotMode]
  )

  const form = useForm<ForgotValues>({
    resolver: async function (values, context, options) {
      const resolve = zodResolver(FORGOT_SCHEMA[modeRef.current]) as Resolver<ForgotValues>
      return resolve(values, context, options)
    }
  })

  useEffect(
    function () {
      form.clearErrors()
      form.reset({
        username: undefined,
        phone: undefined,
        email: undefined,
        captcha: undefined,
        password: undefined,
        confirm: undefined
      })
    },
    [form, forgotMode]
  )

  async function onSubmit(values: ForgotValues) {
    try {
      await RESET[forgotMode](values)
      toast.success('密码已重置')
      onSignin()
    } catch (error) {
      toast.error(HttpError(error).message || '密码重置失败')
    }
  }

  return (
    <Form {...form}>
      <form
        className={styles.form}
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}>
        <FormStagger key={motionKey}>
          <MotionField className={styles.tabs}>
            <Tabs
              value={forgotMode}
              onValueChange={function (value) {
                onModeChange(value as AuthMode)
              }}>
              <TabsList
                size="lg"
                className="grid w-full grid-cols-3">
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

          {/* 身份字段随 mode 销毁重建；验证码一并卸掉以重置倒计时 */}
          <MotionField>
            <ModeSwap mode={forgotMode}>
              {forgotMode === MODE.USERNAME && (
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
              )}

              {forgotMode === MODE.PHONE && (
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
              )}

              {forgotMode === MODE.EMAIL && (
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
              )}

              <div className={styles.fieldMotion}>
                <CaptchaField
                  key={forgotMode}
                  form={form}
                  mode={forgotMode}
                  purpose="forgot"
                  targetField={forgotMode}
                  askSlide={askSlide}
                />
              </div>
            </ModeSwap>
          </MotionField>

          {/* 新密码区保留挂载，仅 reset 清空值，避免整段重播 stagger */}
          <MotionField>
            <AuthField
              control={form.control}
              name="password"
              type="password"
              label="新密码"
              placeholder="请输入新密码"
              maxLength={LIMIT.PASSWORD}
              autoComplete="new-password"
            />
          </MotionField>

          <MotionField>
            <AuthField
              control={form.control}
              name="confirm"
              type="password"
              label="确认密码"
              placeholder="请再次输入新密码"
              maxLength={LIMIT.PASSWORD}
              autoComplete="new-password"
            />
          </MotionField>

          <MotionField className={styles.actions}>
            <Button
              type="submit"
              className="h-11 w-full gap-2"
              disabled={form.formState.isSubmitting}
              aria-busy={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? (
                <>
                  <Spinner className="size-4" />
                  重置中…
                </>
              ) : (
                '重置密码'
              )}
            </Button>
          </MotionField>

          <MotionField className={styles.back}>
            <Button
              type="button"
              variant="link"
              className="h-auto p-0"
              onClick={onSignin}>
              返回登录
            </Button>
          </MotionField>
        </FormStagger>
        {dialog}
      </form>
    </Form>
  )
}

export { ForgotForm }
