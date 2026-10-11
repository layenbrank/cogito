import { describe, expect, it } from 'vitest'

import {
  FORGOT_SCHEMA,
  MODE,
  SIGNIN_SCHEMA,
  SIGNUP_SCHEMA,
  findIdentity
} from '@/features/signin/constants.ts'

describe('findIdentity', function () {
  it('returns username for username mode', function () {
    expect(findIdentity(MODE.USERNAME, { username: 'alice' })).toBe('alice')
  })

  it('returns phone for phone mode', function () {
    expect(findIdentity(MODE.PHONE, { phone: '13800138000' })).toBe('13800138000')
  })

  it('returns email for email mode', function () {
    expect(findIdentity(MODE.EMAIL, { email: 'a@b.com' })).toBe('a@b.com')
  })

  it('returns empty string when value is missing', function () {
    expect(findIdentity(MODE.USERNAME, {})).toBe('')
  })
})

describe('SIGNUP_SCHEMA confirm', function () {
  it('passes when confirm matches password', function () {
    const result = SIGNUP_SCHEMA.safeParse({
      username: 'alice',
      password: 'secret',
      confirm: 'secret'
    })
    expect(result.success).toBe(true)
  })

  it('rejects when confirm differs from password', function () {
    const result = SIGNUP_SCHEMA.safeParse({
      username: 'alice',
      password: 'secret',
      confirm: 'other'
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]?.message).toBe('两次输入的密码不一致！')
    expect(result.error.issues[0]?.path).toEqual(['confirm'])
  })
})

describe('SIGNIN_SCHEMA', function () {
  it('手机号模式要求 6 位数字验证码', function () {
    expect(SIGNIN_SCHEMA.phone.safeParse({ phone: '13800138000', captcha: '123456' }).success).toBe(
      true
    )
    expect(SIGNIN_SCHEMA.phone.safeParse({ phone: '13800138000', captcha: '12' }).success).toBe(
      false
    )
    expect(
      SIGNIN_SCHEMA.phone.safeParse({ phone: '13800138000', captcha: 'abcdef' }).success
    ).toBe(false)
  })

  it('邮箱模式要求邮箱格式与验证码（OTP）', function () {
    expect(SIGNIN_SCHEMA.email.safeParse({ email: 'a@b.com', captcha: '123456' }).success).toBe(
      true
    )
    expect(SIGNIN_SCHEMA.email.safeParse({ email: 'nope', captcha: '123456' }).success).toBe(false)
    expect(SIGNIN_SCHEMA.email.safeParse({ email: 'a@b.com', captcha: '12' }).success).toBe(false)
  })

  it('用户名模式校验 2–12 个字符，密码至少 6 位', function () {
    expect(
      SIGNIN_SCHEMA.username.safeParse({ username: 'alice', password: 'secret' }).success
    ).toBe(true)
    expect(SIGNIN_SCHEMA.username.safeParse({ username: 'a', password: 'secret' }).success).toBe(
      false
    )
    expect(SIGNIN_SCHEMA.username.safeParse({ username: 'alice', password: '12345' }).success).toBe(
      false
    )
  })
})

describe('FORGOT_SCHEMA confirm', function () {
  it('新密码与确认密码一致时通过', function () {
    const result = FORGOT_SCHEMA.phone.safeParse({
      phone: '13800138000',
      captcha: '123456',
      password: 'secret',
      confirm: 'secret'
    })
    expect(result.success).toBe(true)
  })

  it('新密码与确认密码不一致时给出提示', function () {
    const result = FORGOT_SCHEMA.phone.safeParse({
      phone: '13800138000',
      captcha: '123456',
      password: 'secret',
      confirm: 'other'
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]?.message).toBe('两次输入的密码不一致！')
    expect(result.error.issues[0]?.path).toEqual(['confirm'])
  })
})
