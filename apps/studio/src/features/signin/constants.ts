import { z } from 'zod'

type HeadText = {
  title: string
  subtitle: string
}

type IdentityValues = {
  username?: string
  phone?: string
  email?: string
}

type SlideMotionOptions = {
  isReducedMotion: boolean
  offset?: number
  axis?: 'x' | 'y'
}

const PANEL = {
  SIGNIN: 'signin',
  FORGOT: 'forgot',
  SIGNUP: 'signup'
} as const

const PATTERN = {
  PHONE: /^1\d{10}$/,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
} as const

type PanelView = (typeof PANEL)[keyof typeof PANEL]
type AuthMode = 'username' | 'phone' | 'email'

type ModeOption = {
  label: string
  value: AuthMode
}

const MODE = {
  USERNAME: 'username' as AuthMode,
  PHONE: 'phone' as AuthMode,
  EMAIL: 'email' as AuthMode,
  options: [
    { label: '用户名', value: 'username' },
    { label: '手机号', value: 'phone' },
    { label: '邮箱', value: 'email' }
  ] as ModeOption[]
}

const CAPTCHA_COUNTDOWN = 60

const LIMIT = {
  USERNAME: 12,
  PHONE: 11,
  EMAIL: 64,
  PASSWORD: 20,
  CAPTCHA: 6
} as const

const HEAD = {
  [PANEL.SIGNIN]: {
    title: '欢迎回来',
    subtitle: '登录您的账号以继续'
  },
  [PANEL.FORGOT]: {
    title: '找回密码',
    subtitle: '验证身份后设置新密码'
  },
  [PANEL.SIGNUP]: {
    title: '创建账号',
    subtitle: '注册后即可使用 cogito'
  }
} satisfies Record<PanelView, HeadText>

// ── 校验：zod schema（配合 react-hook-form 的 zodResolver）──

const USERNAME_MESSAGE = '用户名长度为 2–12 个字符'
const PASSWORD_MESSAGE = '密码长度为 6–20 个字符'

const usernameField = z
  .string()
  .trim()
  .min(1, '请输入用户名！')
  .min(2, USERNAME_MESSAGE)
  .max(LIMIT.USERNAME, USERNAME_MESSAGE)

const phoneField = z.string().trim().min(1, '请输入手机号！').regex(PATTERN.PHONE, '手机号格式错误！')

const emailField = z
  .string()
  .trim()
  .min(1, '请输入邮箱！')
  .max(LIMIT.EMAIL, `邮箱最长为 ${LIMIT.EMAIL} 个字符`)
  .regex(PATTERN.EMAIL, '邮箱格式错误！')

const passwordField = z
  .string()
  .min(1, '请输入密码！')
  .min(6, PASSWORD_MESSAGE)
  .max(LIMIT.PASSWORD, PASSWORD_MESSAGE)

const confirmField = z.string().min(1, '请确认密码！')

const captchaField = z
  .string()
  .min(1, '请输入验证码！')
  .regex(/^\d{6}$/, '验证码为 6 位数字')

const IDENTITY_MISMATCH = '两次输入的密码不一致！'
const REMEMBER_FIELD = z.boolean().optional()

/** 三种登录身份对应的表单校验 */
const SIGNIN_SCHEMA = {
  username: z.object({
    username: usernameField,
    password: passwordField,
    remember: REMEMBER_FIELD
  }),
  phone: z.object({
    phone: phoneField,
    captcha: captchaField
  }),
  email: z.object({
    email: emailField,
    captcha: captchaField
  })
} satisfies Record<AuthMode, z.ZodType>

/** 找回密码：身份 + 验证码 + 新密码 */
const FORGOT_SCHEMA = {
  username: z
    .object({
      username: usernameField,
      captcha: captchaField,
      password: passwordField,
      confirm: confirmField
    })
    .refine(
      function (values) {
        return values.password === values.confirm
      },
      { message: IDENTITY_MISMATCH, path: ['confirm'] }
    ),
  phone: z
    .object({
      phone: phoneField,
      captcha: captchaField,
      password: passwordField,
      confirm: confirmField
    })
    .refine(
      function (values) {
        return values.password === values.confirm
      },
      { message: IDENTITY_MISMATCH, path: ['confirm'] }
    ),
  email: z
    .object({
      email: emailField,
      captcha: captchaField,
      password: passwordField,
      confirm: confirmField
    })
    .refine(
      function (values) {
        return values.password === values.confirm
      },
      { message: IDENTITY_MISMATCH, path: ['confirm'] }
    )
} satisfies Record<AuthMode, z.ZodType>

const SIGNUP_SCHEMA = z
  .object({
    username: usernameField,
    password: passwordField,
    confirm: confirmField
  })
  .refine(
    function (values) {
      return values.password === values.confirm
    },
    { message: IDENTITY_MISMATCH, path: ['confirm'] }
  )

type SigninValues = {
  username?: string
  phone?: string
  email?: string
  password?: string
  captcha?: string
  remember?: boolean
}

type ForgotValues = {
  username?: string
  phone?: string
  email?: string
  captcha?: string
  password?: string
  confirm?: string
}

type SignupValues = z.infer<typeof SIGNUP_SCHEMA>

const MOTION = {
  DURATION: 0.22,
  EASE: [0.22, 1, 0.36, 1] as const,
  STAGGER: 0.07,
  DELAY_CHILDREN: 0.04,
  OFFSET: {
    HEAD: 4,
    VIEW: 8,
    X: 28
  },
  transition(isReducedMotion: boolean) {
    return {
      duration: isReducedMotion ? 0 : MOTION.DURATION,
      ease: MOTION.EASE
    }
  },
  variants(options: SlideMotionOptions) {
    const { isReducedMotion, offset = MOTION.OFFSET.VIEW, axis = 'y' } = options
    const slide = axis === 'x' ? 'x' : 'y'
    return {
      initial: {
        opacity: isReducedMotion ? 1 : 0,
        [slide]: isReducedMotion ? 0 : offset
      },
      animate: { opacity: 1, [slide]: 0 },
      exit: {
        opacity: isReducedMotion ? 1 : 0,
        [slide]: isReducedMotion ? 0 : axis === 'x' ? -offset * 0.5 : -offset
      }
    }
  },
  fadeVariants(isReducedMotion: boolean) {
    return {
      initial: { opacity: isReducedMotion ? 1 : 0 },
      animate: { opacity: 1 },
      exit: { opacity: isReducedMotion ? 1 : 0 }
    }
  },
  containerVariants(isReducedMotion: boolean) {
    return {
      initial: {},
      animate: {
        transition: {
          staggerChildren: isReducedMotion ? 0 : MOTION.STAGGER,
          delayChildren: isReducedMotion ? 0 : MOTION.DELAY_CHILDREN
        }
      },
      exit: {
        transition: {
          staggerChildren: isReducedMotion ? 0 : MOTION.STAGGER * 0.5,
          staggerDirection: -1
        }
      }
    }
  },
  itemVariants(options: SlideMotionOptions) {
    const { isReducedMotion, offset = MOTION.OFFSET.X, axis = 'x' } = options
    const slide = axis === 'x' ? 'x' : 'y'
    return {
      initial: {
        opacity: isReducedMotion ? 1 : 0,
        [slide]: isReducedMotion ? 0 : offset
      },
      animate: { opacity: 1, [slide]: 0 },
      exit: {
        opacity: isReducedMotion ? 1 : 0,
        [slide]: isReducedMotion ? 0 : axis === 'x' ? -offset * 0.5 : -offset
      }
    }
  }
}

const CHANNEL = {
  phone: 'PHONE',
  email: 'EMAIL'
} as const

const IDENTITY: Record<AuthMode, (values: IdentityValues) => string> = {
  username(values) {
    return values.username ?? ''
  },
  phone(values) {
    return values.phone ?? ''
  },
  email(values) {
    return values.email ?? ''
  }
}

function findIdentity(mode: AuthMode, values: IdentityValues) {
  return IDENTITY[mode](values)
}

export {
  CAPTCHA_COUNTDOWN,
  CHANNEL,
  FORGOT_SCHEMA,
  HEAD,
  LIMIT,
  MODE,
  MOTION,
  PANEL,
  PATTERN,
  SIGNIN_SCHEMA,
  SIGNUP_SCHEMA,
  findIdentity
}

export type { AuthMode, ForgotValues, HeadText, PanelView, SigninValues, SignupValues }
