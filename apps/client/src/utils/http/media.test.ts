import { afterEach, describe, expect, it, vi } from 'vitest'

describe('findCogitoMediaUrl', function () {
  afterEach(function () {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  it('把 /api/v1/... 相对路径拼到 VITE_COGITO 的 origin', async function () {
    vi.stubEnv('VITE_COGITO', 'http://127.0.0.1:3000/api/v1')
    const { findCogitoMediaUrl } = await import('@/utils/http/media.ts')
    expect(findCogitoMediaUrl('/api/v1/upload/asset/abc')).toBe(
      'http://127.0.0.1:3000/api/v1/upload/asset/abc'
    )
  })

  it('绝对 URL / blob / data 原样返回', async function () {
    vi.stubEnv('VITE_COGITO', 'http://127.0.0.1:3000/api/v1')
    const { findCogitoMediaUrl } = await import('@/utils/http/media.ts')
    expect(findCogitoMediaUrl('https://cdn.example/a.png')).toBe('https://cdn.example/a.png')
    expect(findCogitoMediaUrl('blob:http://localhost/1')).toBe('blob:http://localhost/1')
    expect(findCogitoMediaUrl('data:image/png;base64,xx')).toBe('data:image/png;base64,xx')
  })

  it('空值返回 null', async function () {
    const { findCogitoMediaUrl } = await import('@/utils/http/media.ts')
    expect(findCogitoMediaUrl(null)).toBeNull()
    expect(findCogitoMediaUrl(undefined)).toBeNull()
    expect(findCogitoMediaUrl('')).toBeNull()
  })
})
