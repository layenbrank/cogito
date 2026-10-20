import { HttpEnvelope } from '@/utils/http/errors.ts'
import { http } from '@/utils/http/http.ts'

interface SlideProof {
  captchaKey: string
  captchaValue: string
  captchaKind?: string
}

interface AuthSession {
  token: string
  id: string
  username: string
  role: string
  status: string
  createdAt: number
  updatedAt: number
}

interface AuthAvatar {
  id: string
  url: string
  name: string
}

interface AuthProfile {
  id: string
  username: string
  role: string
  status: string
  email: string | null
  phone: string | null
  gender: string | null
  birthday: string | null
  age: number | null
  avatar: AuthAvatar | null
  createdAt: number
  updatedAt: number
}

interface CaptchaChallenge {
  kind: string
  captchaKey: string
  masterImage: string
  thumbImage: string
  thumbX: number
  thumbY: number
  thumbWidth: number
  thumbHeight: number
}

async function unwrap<T>(pending: Promise<RSF<T>>): Promise<T> {
  return HttpEnvelope(await pending)
}

const ENV = { env: 'thinking' as const }

function POST_CAPTCHA() {
  return unwrap(http.post<RSF<CaptchaChallenge>>('/auth/captcha', {}, ENV))
}

function POST_SIGNIN(data: { username: string; password: string } & SlideProof) {
  return unwrap(http.post<RSF<AuthSession>>('/auth/signin', data, ENV))
}

function GET_AUTH_PROFILE() {
  return unwrap(http.get<RSF<AuthProfile>>('/auth/profile', ENV))
}

function POST_AUTH_SIGNOUT() {
  return unwrap(http.post<RSF<null>>('/auth/signout', {}, ENV))
}

export { GET_AUTH_PROFILE, POST_AUTH_SIGNOUT, POST_CAPTCHA, POST_SIGNIN }
export type { AuthProfile, AuthSession, CaptchaChallenge, SlideProof }
