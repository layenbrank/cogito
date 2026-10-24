/**
 * CoreX / rust-service API constants.
 */
const API_SUCCESS_CODE = 200000

const API_PATHS = {
  HEALTH: '/api/health',
  AUTH_CAPTCHA: '/api/v1/auth/captcha',
  AUTH_SIGNIN: '/api/v1/auth/signin',
  AUTH_SIGNUP: '/api/v1/auth/signup',
  AUTH_PROFILE: '/api/v1/auth/profile',
  AUTH_SIGNOUT: '/api/v1/auth/signout',
  AUTH_PASSWORD: '/api/v1/auth/password',
  AUTH_PASSWORD_FORGOT: '/api/v1/auth/password/forgot',
  AUTH_PASSWORD_RESET: '/api/v1/auth/password/reset',
  AUTH_OTP: '/api/v1/auth/otp',
  AUTH_SIGNIN_PHONE: '/api/v1/auth/signin/phone',
  AUTH_SIGNIN_EMAIL: '/api/v1/auth/signin/email',
  GATEWAY_CHAT: '/api/v1/gateway/chat/completions',
  GATEWAY_MODELS: '/api/v1/gateway/models',
  APPLICATION_TO_READ: '/api/v1/application/toRead'
} as const

export { API_PATHS, API_SUCCESS_CODE }
