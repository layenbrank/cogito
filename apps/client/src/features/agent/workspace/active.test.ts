import { beforeEach, describe, expect, it, vi } from 'vitest'

const prefState: { activeRootByWorkspace: Record<string, string> } = {
  activeRootByWorkspace: {}
}

vi.mock('@/features/persist/store', function () {
  return {
    findPref: function () {
      return { activeRootByWorkspace: prefState.activeRootByWorkspace }
    },
    patchPref: async function () {}
  }
})

const { resolveRootPath } = await import('@/features/agent/workspace/active')
const { selectActiveRootPath, readActiveRootPath } = await import(
  '@/features/agent/workspace/active-root'
)

const folders = [
  { workspaceID: 'ws-1', path: '/repo/frontend' },
  { workspaceID: 'ws-1', path: '/repo/backend' },
  { workspaceID: 'ws-2', path: '/other/app' }
] as never

describe('当前文件夹（resolveRootPath）', function () {
  beforeEach(function () {
    selectActiveRootPath('ws-1', null)
    selectActiveRootPath('ws-2', null)
  })

  it('没有工作区或没有文件夹时返回 null', function () {
    expect(resolveRootPath(null, folders)).toBeNull()
    expect(resolveRootPath('ws-1', [])).toBeNull()
  })

  it('未选择时回落到列表第一个文件夹', function () {
    expect(resolveRootPath('ws-1', folders)).toBe('/repo/frontend')
  })

  it('选中后返回选中的那个，且不影响其它工作区', function () {
    selectActiveRootPath('ws-1', '/repo/backend')
    expect(resolveRootPath('ws-1', folders)).toBe('/repo/backend')
    expect(resolveRootPath('ws-2', folders)).toBe('/other/app')
  })

  it('选中的文件夹被移除后回落第一个（不返回失效路径）', function () {
    selectActiveRootPath('ws-1', '/repo/removed')
    expect(resolveRootPath('ws-1', folders)).toBe('/repo/frontend')
    // 失效值仍留在内存里，等用户下次显式选择才覆盖；对外不暴露
    expect(readActiveRootPath('ws-1')).toBe('/repo/removed')
  })

  it('传 null 表示放弃选择、回落主文件夹', function () {
    selectActiveRootPath('ws-1', '/repo/backend')
    selectActiveRootPath('ws-1', null)
    expect(resolveRootPath('ws-1', folders)).toBe('/repo/frontend')
    expect(readActiveRootPath('ws-1')).toBeNull()
  })
})
