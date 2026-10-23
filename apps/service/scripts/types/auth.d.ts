declare namespace Auth {
  namespace SignIn {
    export interface Params {
      username: string
      password: string
      /** 来自 POST /auth/captcha；`auth.captcha.enabled=false` 时可填占位 */
      captchaKey: string
      captchaValue: string
      captchaKind?: string
    }

    export interface Response {
      token: string
      id: string
      username: string
      createdAt: number
      updatedAt: number
    }
  }

  namespace SignUp {
    export interface Params {
      username: string
      password: string
      captchaKey: string
      captchaValue: string
      captchaKind?: string
    }

    export interface Response {
      token: string
      id: string
      username: string
      createdAt: number
      updatedAt: number
    }
  }
}
