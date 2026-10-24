import { API_PATHS } from '@/constants/api'
import { ApiError, assertApiSuccess, isApiSuccess, requestJson } from '@/api/http'
import { mmkvStorage } from '@/stores/storage'
import type {
  CaptchaChallenge,
  PasswordChangeBody,
  Profile,
  ProfileUpdateBody,
  Session,
  SignInBody,
  SignInResult,
  SignUpBody,
  SlideProof
} from '@/types/auth'
import type { RSF } from '@/types/response'

const SESSION_KEY = 'auth:session'

function writeSession(session: Session) {
  mmkvStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

function clearSession() {
  mmkvStorage.removeItem(SESSION_KEY)
}

function findSession(): Session | null {
  const raw = mmkvStorage.getItem(SESSION_KEY)
  if (!raw) {
    return null
  }
  return JSON.parse(raw) as Session
}

function rememberSession(result: SignInResult) {
  writeSession({
    token: result.token,
    userId: result.id,
    username: result.username
  })
}

function fail<T>(code: number, msg: string): RSF<T> {
  return {
    code,
    success: false,
    msg,
    data: null as T,
    timestamp: Date.now()
  }
}

/**
 * POST /api/v1/auth/captcha — fetch go-captcha challenge.
 */
async function POST_CAPTCHA(kind?: string): Promise<RSF<CaptchaChallenge>> {
  try {
    return await requestJson<CaptchaChallenge>(API_PATHS.AUTH_CAPTCHA, {
      method: 'POST',
      body: kind ? { kind } : {}
    })
  } catch (error) {
    if (error instanceof ApiError) {
      return fail(error.code, error.message)
    }
    return fail(500000, error instanceof Error ? error.message : 'Captcha failed')
  }
}

/**
 * POST /api/v1/auth/signup — register via rust-service.
 */
async function POST_SIGNUP(data: SignUpBody): Promise<RSF<SignInResult>> {
  try {
    const result = await requestJson<SignInResult>(API_PATHS.AUTH_SIGNUP, {
      method: 'POST',
      body: {
        username: data.username.trim(),
        password: data.password,
        captchaKey: data.captchaKey,
        captchaValue: data.captchaValue,
        captchaKind: data.captchaKind
      }
    })
    if (isApiSuccess(result.code) && result.data?.token) {
      rememberSession(result.data)
    }
    return result
  } catch (error) {
    if (error instanceof ApiError) {
      return fail(error.code, error.message)
    }
    return fail(500000, error instanceof Error ? error.message : 'Sign up failed')
  }
}

/**
 * POST /api/v1/auth/signin — password login via rust-service.
 */
async function POST_SIGNIN(data: SignInBody): Promise<RSF<SignInResult>> {
  try {
    const result = await requestJson<SignInResult>(API_PATHS.AUTH_SIGNIN, {
      method: 'POST',
      body: {
        username: data.username.trim(),
        password: data.password,
        captchaKey: data.captchaKey,
        captchaValue: data.captchaValue,
        captchaKind: data.captchaKind
      }
    })
    if (isApiSuccess(result.code) && result.data?.token) {
      rememberSession(result.data)
    }
    return result
  } catch (error) {
    if (error instanceof ApiError) {
      return fail(error.code, error.message)
    }
    return fail(500000, error instanceof Error ? error.message : 'Sign in failed')
  }
}

/**
 * POST /api/v1/auth/signout — blacklist JWT on rust-service.
 */
async function POST_SIGNOUT(token?: string | null): Promise<RSF<null>> {
  try {
    if (token) {
      await requestJson<null>(API_PATHS.AUTH_SIGNOUT, {
        method: 'POST',
        token
      })
    }
  } catch {
    // Always clear local session.
  }
  clearSession()
  return {
    code: 200000,
    success: true,
    msg: 'ok',
    data: null,
    timestamp: Date.now()
  }
}

/**
 * GET /api/v1/auth/profile
 */
async function GET_PROFILE(token: string): Promise<RSF<Profile>> {
  try {
    return await requestJson<Profile>(API_PATHS.AUTH_PROFILE, { token })
  } catch (error) {
    if (error instanceof ApiError) {
      return fail(error.code, error.message)
    }
    return fail(500000, error instanceof Error ? error.message : 'Profile failed')
  }
}

/**
 * PUT /api/v1/auth/profile
 */
async function PUT_PROFILE(token: string, body: ProfileUpdateBody): Promise<RSF<Profile>> {
  try {
    return await requestJson<Profile>(API_PATHS.AUTH_PROFILE, {
      method: 'PUT',
      token,
      body
    })
  } catch (error) {
    if (error instanceof ApiError) {
      return fail(error.code, error.message)
    }
    return fail(500000, error instanceof Error ? error.message : 'Profile update failed')
  }
}

/**
 * PUT /api/v1/auth/password
 */
async function PUT_PASSWORD(token: string, body: PasswordChangeBody): Promise<RSF<null>> {
  try {
    const result = await requestJson<null>(API_PATHS.AUTH_PASSWORD, {
      method: 'PUT',
      token,
      body
    })
    if (isApiSuccess(result.code)) {
      clearSession()
    }
    return result
  } catch (error) {
    if (error instanceof ApiError) {
      return fail(error.code, error.message)
    }
    return fail(500000, error instanceof Error ? error.message : 'Password change failed')
  }
}

/**
 * Convenience unwrap used by UI flows that prefer thrown errors.
 */
async function fetchCaptchaChallenge(kind?: string) {
  return assertApiSuccess(await POST_CAPTCHA(kind))
}

export type { SlideProof }
export {
  GET_PROFILE,
  POST_CAPTCHA,
  POST_SIGNIN,
  POST_SIGNOUT,
  POST_SIGNUP,
  PUT_PASSWORD,
  PUT_PROFILE,
  clearSession,
  fetchCaptchaChallenge,
  findSession
}
