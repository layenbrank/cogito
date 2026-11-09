import { beforeEach, describe, expect, it } from 'vitest'

import { useCodeStore, type CodeTab } from '@/stores/code'
import { findOrphanTabIDs, switchWorkspace } from '@/views/code/lib/workspace-switch.ts'

function makeTab(id: string, path: string, kind: CodeTab['kind'], isDirty = false): CodeTab {
  return {
    id,
    path,
    title: path.split('/').pop() ?? path,
    language: 'plaintext',
    isDirty,
    kind
  }
}

describe('findOrphanTabIDs', function () {
  it('保留落在任一新根下的 file / diff，其余全部进入关闭集', function () {
    const tabs = [
      makeTab('a', 'C:/work/front/src/a.ts', 'file'),
      makeTab('b', 'C:/work/kb/docs/b.md', 'file'),
      makeTab('c', 'C:/other/c.ts', 'file'),
      makeTab('d', 'C:/other/d.ts', 'diff'),
      makeTab('e', 'cogito://git/commits', 'commits')
    ]
    expect(findOrphanTabIDs(tabs, ['C:/work/front', 'C:/work/kb'])).toEqual(['c', 'd', 'e'])
  })

  it('根去重与尾分隔符不影响归属判定', function () {
    const tabs = [makeTab('a', 'C:/work/front/src/a.ts', 'file')]
    expect(findOrphanTabIDs(tabs, ['C:/work/front/'])).toEqual([])
  })
})

describe('findOrphanTabIDs（虚拟标签）', function () {
  it('编辑器设置标签跨工作区保留，不随切根关闭', function () {
    const tabs = [
      makeTab('a', 'C:/other/a.ts', 'file'),
      makeTab('s', 'cogito://code/settings', 'settings')
    ]
    expect(findOrphanTabIDs(tabs, ['C:/work'])).toEqual(['a'])
  })
})

describe('switchWorkspace', function () {
  beforeEach(function () {
    useCodeStore.setState({
      roots: ['C:/old'],
      workspaceRoot: 'C:/old',
      workspaceID: null,
      tabs: [],
      activeTabId: null,
      pendingRootsChange: null,
      recentRoots: []
    })
  })

  it('脏标签走 pending 分支，状态不落库', function () {
    useCodeStore.setState({
      tabs: [makeTab('dirty', 'C:/old/src/a.ts', 'file', true)]
    })
    const outcome = switchWorkspace(['C:/new'], { workspaceID: 'ws-1' })
    expect(outcome).toBe('pending')
    const state = useCodeStore.getState()
    expect(state.roots).toEqual(['C:/old'])
    expect(state.pendingRootsChange).toEqual({
      roots: ['C:/new'],
      workspaceID: 'ws-1',
      dirtyTabIDs: ['dirty']
    })
  })

  it('干净标签直接切根并清空展开态 / 定位请求', function () {
    useCodeStore.setState({
      tabs: [makeTab('clean', 'C:/old/src/a.ts', 'file')],
      expandedKeys: ['0::src'],
      pendingReveal: { path: 'C:/old/src/a.ts', line: 1, column: 1 }
    })
    const outcome = switchWorkspace(['C:/new/'], { workspaceID: null })
    expect(outcome).toBe('applied')
    const state = useCodeStore.getState()
    expect(state.roots).toEqual(['C:/new'])
    expect(state.workspaceRoot).toBe('C:/new')
    expect(state.tabs).toEqual([])
    expect(state.expandedKeys).toEqual([])
    expect(state.pendingReveal).toBeNull()
  })
})
