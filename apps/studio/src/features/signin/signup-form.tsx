import { Icon } from '@iconify/react/offline'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@cogito/design/components/button'
import { Form } from '@cogito/design/components/form'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { POST_SIGNUP } from '@/apis/auth.ts'
import { LIMIT, SIGNUP_SCHEMA, type SignupValues } from './constants.ts'
import { AuthField } from './field.tsx'
import { FormStagger, MotionField } from './form-motion.tsx'
import styles from './signin.module.scss'
import { useSlideProof } from './slide.tsx'
import { HttpError } from '@/utils/http.errors.ts'
import { writeAuthToken } from '@/utils/auth.ts'

type SignupFormProps = {
  motionKey: number
  onSignin: () => void
  onSuccess: () => void
}

function SignupForm(props: SignupFormProps) {
  const { motionKey, onSignin, onSuccess } = props
  const { askSlide, dialog } = useSlideProof()

  const form = useForm<SignupValues>({
    resolver: zodResolver(SIGNUP_SCHEMA),
    defaultValues: { username: '', password: '', confirm: '' }
  })

  async function onSubmit(values: SignupValues) {
    try {
      const proof = await askSlide()
      if (!proof) return
      const session = await POST_SIGNUP({
        username: values.username,
        password: values.password,
        ...proof
      })
      writeAuthToken(session.token, true)
      toast.success('注册成功')
      form.reset()
      onSuccess()
    } catch (error) {
      toast.error(HttpError(error).message || '注册失败，请稍后重试')
    }
  }

  return (
    <Form {...form}>
      <form
        className={styles.form}
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}>
        <FormStagger key={motionKey}>
          <MotionField>
            <AuthField
              control={form.control}
              name="username"
              label="用户名"
              placeholder="请输入用户名"
              icon={<Icon icon="lucide:user" />}
              maxLength={LIMIT.USERNAME}
              autoComplete="username"
            />
          </MotionField>

          <MotionField>
            <AuthField
              control={form.control}
              name="password"
              type="password"
              label="密码"
              placeholder="请输入密码"
              icon={<Icon icon="lucide:lock" />}
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
              placeholder="请再次输入密码"
              icon={<Icon icon="lucide:lock" />}
              maxLength={LIMIT.PASSWORD}
              autoComplete="new-password"
            />
          </MotionField>

          <MotionField className={styles.actions}>
            <Button
              type="submit"
              className="h-11 w-full"
              aria-busy={form.formState.isSubmitting}>
              确认注册
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

export { SignupForm }
