import { describe, expect, it, vi } from 'vitest'

import { pickWorkspaceCwd, WorkspaceCwdError } from '@/features/agent/acp/workspace-cwd'
import { isExpectedError } from '@/utils/expected-error'

function probeOf(map: Record<string, boolean | null>) {
  return vi.fn(async function (path: string) {
    return path in map ? map[path] : false
  })
}

describe('pickWorkspaceCwd', function () {
  it('按列表顺序取第一个真实存在的目录', async function () {
    const probe = probeOf({ '/gone': false, '/alive': true, '/later': true })
    const cwd = await pickWorkspaceCwd(
      [{ path: '/gone' }, { path: '/alive' }, { path: '/later' }],
      probe,
      async function () {
        return '/home'
      }
    )
    expect(cwd).toBe('/alive')
    // 命中即停：后面那些目录不必再探测
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('全部不存在时抛带路径的可预期错误（不当崩溃上报）', async function () {
    const probe = probeOf({ '/gone-a': false, '/gone-b': false })
    let caught: unknown = null
    await pickWorkspaceCwd([{ path: '/gone-a' }, { path: '/gone-b' }], probe, async function () {
      return '/home'
    }).then(
      function () {
        return null
      },
      function (error: unknown) {
        caught = error
        return null
      }
    )
    expect(caught).toBeInstanceOf(WorkspaceCwdError)
    const failure = caught as WorkspaceCwdError
    expect(failure.paths).toEqual(['/gone-a', '/gone-b'])
    // 提示里必须同时出现路径和「去哪里改」—— 这才是这条报错存在的意义
    expect(failure.message).toContain('/gone-a')
    expect(failure.message).toContain('/gone-b')
    expect(failure.message).toContain('设置 → 工作区')
    expect(isExpectedError(failure)).toBe(true)
  })

  it('探测不出来时沿用第一个候选，不拦人发消息', async function () {
    const probe = probeOf({ '/unknown': null })
    const cwd = await pickWorkspaceCwd([{ path: '/unknown' }], probe, async function () {
      return '/home'
    })
    expect(cwd).toBe('/unknown')
  })

  it('有存在的目录时忽略探测不出来的那些', async function () {
    const probe = probeOf({ '/unknown': null, '/alive': true })
    const cwd = await pickWorkspaceCwd(
      [{ path: '/unknown' }, { path: '/alive' }],
      probe,
      async function () {
        return '/home'
      }
    )
    expect(cwd).toBe('/alive')
  })

  it('没有配置文件夹时回落到家目录', async function () {
    const probe = probeOf({})
    const fallback = vi.fn(async function () {
      return '/home'
    })
    const cwd = await pickWorkspaceCwd([], probe, fallback)
    expect(cwd).toBe('/home')
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(probe).not.toHaveBeenCalled()
  })

  it('空路径与重复路径不会当成候选', async function () {
    const probe = probeOf({ '/alive': true })
    const cwd = await pickWorkspaceCwd(
      [{ path: '  ' }, { path: null }, { path: '/alive' }, { path: '/alive' }],
      probe,
      async function () {
        return '/home'
      }
    )
    expect(cwd).toBe('/alive')
    expect(probe).toHaveBeenCalledTimes(1)
  })
})
