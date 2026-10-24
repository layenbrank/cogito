import { API_SUCCESS_CODE } from '@/constants/api'
import { POST_CAPTCHA, POST_SIGNIN, POST_SIGNUP, findSession } from '@/api/auth'

const CAPTCHA = {
  kind: 'slide-default',
  captchaKey: 'test-key',
  masterImage: 'aaa',
  thumbImage: 'bbb',
  thumbX: 0,
  thumbY: 12,
  thumbWidth: 40,
  thumbHeight: 40
}

describe('rust-service auth api', () => {
  beforeEach(() => {
    global.fetch = jest.fn()
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  test('POST_CAPTCHA calls /api/v1/auth/captcha', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        code: API_SUCCESS_CODE,
        success: true,
        msg: 'ok',
        data: CAPTCHA,
        timestamp: Date.now()
      })
    })

    const result = await POST_CAPTCHA()
    expect(result.code).toBe(API_SUCCESS_CODE)
    expect(result.data.captchaKey).toBe('test-key')
    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toContain('/api/v1/auth/captcha')
  })

  test('POST_SIGNIN posts username password captcha to /signin', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        code: API_SUCCESS_CODE,
        success: true,
        msg: 'ok',
        data: {
          token: 'jwt-token',
          id: 'user-1',
          username: 'alice',
          role: 'USER',
          status: 'ACTIVE',
          createdAt: 1,
          updatedAt: 1
        },
        timestamp: Date.now()
      })
    })

    const result = await POST_SIGNIN({
      username: 'alice',
      password: 'secret1',
      captchaKey: 'k',
      captchaValue: '10,12',
      captchaKind: 'slide-default'
    })

    expect(result.code).toBe(API_SUCCESS_CODE)
    expect(result.data.token).toBe('jwt-token')
    expect(findSession()?.token).toBe('jwt-token')

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(String(url)).toContain('/api/v1/auth/signin')
    expect(JSON.parse(init.body)).toEqual({
      username: 'alice',
      password: 'secret1',
      captchaKey: 'k',
      captchaValue: '10,12',
      captchaKind: 'slide-default'
    })
  })

  test('POST_SIGNUP posts to /signup', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        code: API_SUCCESS_CODE,
        success: true,
        msg: 'ok',
        data: {
          token: 'jwt-2',
          id: 'user-2',
          username: 'bob',
          role: 'USER',
          status: 'ACTIVE',
          createdAt: 1,
          updatedAt: 1
        },
        timestamp: Date.now()
      })
    })

    const result = await POST_SIGNUP({
      username: 'bob',
      password: 'secret1',
      captchaKey: 'k',
      captchaValue: '1,2'
    })

    expect(result.success).toBe(true)
    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toContain('/api/v1/auth/signup')
  })
})
