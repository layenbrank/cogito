import { afterEach, describe, expect, it } from 'vitest'

import { findWindowsProxyUrl } from './install-http-proxy.ts'

const ORIGINAL = {
  HTTPS_PROXY: process.env.HTTPS_PROXY,
  HTTP_PROXY: process.env.HTTP_PROXY,
  ALL_PROXY: process.env.ALL_PROXY
}

afterEach(function () {
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

describe('findWindowsProxyUrl', function () {
  // 这个用例真的会起 powershell 读注册表：机器忙/杀软扫描时会超过默认的 5s。
  it(
    '在 Windows 上返回 http(s) URL 或 undefined（视本机 IE 代理而定）',
    function () {
      if (process.platform !== 'win32') {
        expect(findWindowsProxyUrl()).toBeUndefined()
        return
      }
      const proxy = findWindowsProxyUrl()
      if (proxy === undefined) return
      expect(proxy).toMatch(/^https?:\/\//i)
    },
    30_000
  )
})
