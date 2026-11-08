const SIGNIN_COPY = {
  eyebrow: '平台运维',
  brand: 'cogito',
  tagline: '身份、网关、计费与运行时，一处编排。',
  foot: '仅 ADMIN · 纯 Web',
  title: '登录',
  subtitle: '使用平台管理员账号',
  username: '用户名',
  password: '密码',
  usernamePlaceholder: '管理员用户名',
  passwordPlaceholder: '请输入密码',
  remember: '记住我',
  submit: '进入控制台',
  submitting: '登录中…',
  usernameRequired: '请输入用户名',
  passwordRequired: '请输入密码',
  adminOnly: '仅平台管理员可进入 Backend Console',
  revealPassword: '显示密码',
  hidePassword: '隐藏密码'
} as const

const SIGNIN_CAPABILITIES = [
  { key: 'identity', title: '身份', detail: '用户、租户与角色门禁' },
  { key: 'gateway', title: '网关', detail: '供应商、模型与用量' },
  { key: 'billing', title: '商业', detail: '价目与对账' },
  { key: 'observe', title: '观测', detail: '日志、异常与追踪' }
] as const

const SHADER_OPEN_MS = 280

function formatIndex(index: number) {
  return String(index + 1).padStart(2, '0')
}

export { SIGNIN_CAPABILITIES, SIGNIN_COPY, SHADER_OPEN_MS, formatIndex }
