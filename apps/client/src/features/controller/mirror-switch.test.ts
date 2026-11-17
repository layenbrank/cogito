/**
 * 镜像切换的通道语义：
 *
 * 正常路径由 `Controller.Mirror` 注册（带退场动画）；但标题栏可能在没有墙的上下文里
 * 发起切换（墙还没挂上 / 不在工作台路由）。那种情况以前是**直接 return** ——
 * 用户点了菜单没有任何反应。这里锁住「没有动画通道也要把切换做完」。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', function () {
  return { invoke: vi.fn(async function () { return [] }) }
})

import { requestMirrorSwitch } from '@/features/controller/mirror-switch'
import { useMirrorStore } from '@/stores/mirror.ts'

function buildMirror(id: string, index: number): Mirror {
  const now = Date.now()
  return {
    id,
    title: id,
    description: '',
    index,
    mark: '',
    background: null,
    backdrop: null,
    overlay: '',
    archivedAt: null,
    createdAt: now,
    updatedAt: now
  }
}

const MIRRORS = [buildMirror('m1', 0), buildMirror('m2', 1)]

afterEach(function () {
  useMirrorStore.setState({ mirrors: [], active: { mirror: null, magneticTile: null } })
})

describe('requestMirrorSwitch', function () {
  it('没有注册动画通道时仍然提交 store（不再静默失败）', async function () {
    useMirrorStore.setState({ mirrors: MIRRORS })
    useMirrorStore.getState().toCommitMirrorPayload({ mirror: MIRRORS[0], magneticTiles: [] })

    await requestMirrorSwitch('m2')

    expect(useMirrorStore.getState().active.mirror?.id).toBe('m2')
  })
})
