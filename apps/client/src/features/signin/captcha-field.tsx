import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@i-thinking/design/components/form'
import { Input } from '@i-thinking/design/components/input'
import { useEffect, useState } from 'react'
import type { FieldPath, FieldValues, UseFormReturn } from 'react-hook-form'
import { toast } from 'sonner'

import { POST_OTP, POST_PASSWORD_FORGOT, type SlideProof } from '@/apis/auth.ts'
import { CAPTCHA_COUNTDOWN, CHANNEL, LIMIT, type AuthMode } from './constants.ts'
import styles from './signin.module.scss'
import { HttpError } from '@/utils/http/errors.ts'

/** 表单里验证码字段的固定名（泛型 T 由各表单给出，故此处收窄一次） */
const CAPTCHA_NAME = 'captcha'

type CaptchaPurpose = 'otp' | 'forgot'

type CaptchaSender = (target: string, proof: SlideProof) => Promise<unknown>

const SEND: Record<CaptchaPurpose, Partial<Record<AuthMode, CaptchaSender>>> = {
  otp: {
    phone(target, proof) {
      return POST_OTP({ channel: CHANNEL.phone, target, ...proof })
    },
    email(target, proof) {
      return POST_OTP({ channel: CHANNEL.email, target, ...proof })
    }
  },
  forgot: {
    username(target, proof) {
      return POST_PASSWORD_FORGOT({ username: target, ...proof })
    },
    phone(target, proof) {
      return POST_PASSWORD_FORGOT({ channel: CHANNEL.phone, target, ...proof })
    },
    email(target, proof) {
      return POST_PASSWORD_FORGOT({ channel: CHANNEL.email, target, ...proof })
    }
  }
}

interface CaptchaFieldProps<T extends FieldValues> {
  form: UseFormReturn<T>
  mode: AuthMode
  purpose: CaptchaPurpose
  /** 发送前需要先通过校验的身份字段（username / phone / email） */
  targetField: FieldPath<T>
  askSlide: () => Promise<SlideProof | null>
}

function CaptchaField<T extends FieldValues>(props: CaptchaFieldProps<T>) {
  const { form, mode, purpose, targetField, askSlide } = props
  const [countdown, updateCountdown] = useState(0)
  const [isSending, updateSending] = useState(false)

  useEffect(
    function () {
      if (countdown <= 0) return

      const timer = window.setTimeout(function () {
        updateCountdown(function (prev) {
          return prev - 1
        })
      }, 1000)

      return function () {
        window.clearTimeout(timer)
      }
    },
    [countdown]
  )

  async function onSendCaptcha() {
    const isValid = await form.trigger(targetField)
    if (!isValid) return

    const target = String(form.getValues(targetField) ?? '')
    updateSending(true)

    try {
      const proof = await askSlide()
      if (!proof) return

      const send = SEND[purpose][mode]
      if (!send) return
      await send(target, proof)

      toast.success('验证码已发送')
      updateCountdown(CAPTCHA_COUNTDOWN)
    } catch (error) {
      toast.error(HttpError(error).message || '验证码发送失败')
    } finally {
      updateSending(false)
    }
  }

  const label = isSending ? '发送中…' : countdown > 0 ? `${countdown}s 后重发` : '获取验证码'

  return (
    <FormField
      control={form.control}
      name={CAPTCHA_NAME as FieldPath<T>}
      render={function ({ field }) {
        return (
          <FormItem>
            <FormLabel>验证码</FormLabel>
            <div className={styles.captcha}>
              <div className="relative flex-1">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground [&_svg]:size-4">
                  <Icon icon="lucide:shield-check" />
                </span>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value ?? ''}
                    className="h-11 pl-9"
                    maxLength={LIMIT.CAPTCHA}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="请输入验证码"
                    aria-label="验证码"
                  />
                </FormControl>
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-11 shrink-0"
                disabled={countdown > 0 || isSending}
                onClick={function () {
                  void onSendCaptcha()
                }}>
                {label}
              </Button>
            </div>
            <FormMessage />
          </FormItem>
        )
      }}
    />
  )
}

export { CaptchaField }
