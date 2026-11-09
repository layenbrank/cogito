import { describe, expect, it } from 'vitest'

import type { FileTreeNode } from '@/views/workspace/overlay/file-tree-node.ts'
import {
  appendFileTreeChildren,
  dropFileTreeChildren,
  findFileTreeNode,
  patchFileTreeNode,
  updateFileTreeNodes
} from '@/views/workspace/overlay/file-tree.ts'

function makeFile(key: string, title: string = key): FileTreeNode {
  return { title, key, isLeaf: true }
}

function makeDir(key: string, children: FileTreeNode[] = []): FileTreeNode {
  return { title: key, key, isDirectory: true, isLoaded: true, children }
}

/**
 * 0::
 *   └─ 0::a        (children: 0::a/one.ts)
 *   └─ 0::b        (children: 0::b/c → 0::b/c/two.ts)
 */
function makeTree(): FileTreeNode[] {
  return [
    makeDir('0::', [makeDir('0::a', [makeFile('0::a/one.ts')]), makeDir('0::b', [makeDir('0::b/c', [makeFile('0::b/c/two.ts')])])])
  ]
}

describe('updateFileTreeNodes（结构共享）', function () {
  it('目标 key 不在树里：返回同一个 reference，一遍都没克隆', function () {
    const tree = makeTree()
    const next = updateFileTreeNodes(tree, '0::missing', [makeFile('0::missing/x.ts')])
    expect(next).toBe(tree)
    expect(next[0]).toBe(tree[0])
    expect(next[0].children?.[0]).toBe(tree[0].children?.[0])
  })

  it('命中深层目录：只克隆从根到目标这条路径，兄弟子树引用不变', function () {
    const tree = makeTree()
    const dirB = tree[0].children![1]
    const dirA = tree[0].children![0]
    const leaf: FileTreeNode[] = [makeFile('0::b/c/three.ts')]

    const next = updateFileTreeNodes(tree, '0::b/c', leaf)
    expect(next).not.toBe(tree)
    // 目标节点的兄弟（dirA）以及它的整棵子树都应保持同一引用
    expect(next[0].children![0]).toBe(dirA)
    // 路径上的节点被克隆
    expect(next[0]).not.toBe(tree[0])
    expect(next[0].children![1]).not.toBe(dirB)
    expect(next[0].children![1].children![0].children).toEqual(leaf)
    // 入参本身没被改动（纯函数）
    expect(tree[0].children![1].children![0].children?.length).toBe(1)
  })

  it('写入后标记 isLoaded 并记录 hasMore / nextOffset', function () {
    const tree = makeTree()
    const next = updateFileTreeNodes(tree, '0::a', [makeFile('0::a/one.ts')], {
      hasMore: true,
      nextOffset: 200
    })
    const target = findFileTreeNode(next, '0::a')
    expect(target?.isLoaded).toBe(true)
    expect(target?.isLoading).toBe(false)
    expect(target?.hasMore).toBe(true)
    expect(target?.nextOffset).toBe(200)
  })
})

describe('dropFileTreeChildren（折叠即失效）', function () {
  it('只清目标节点的子节点，其它子树引用不变', function () {
    const tree = makeTree()
    const dirB = tree[0].children![1]
    const next = dropFileTreeChildren(tree, '0::a')
    const target = findFileTreeNode(next, '0::a')
    expect(target?.children).toBeUndefined()
    expect(target?.isLoaded).toBe(false)
    expect(next[0].children![1]).toBe(dirB)
    expect(next[0].children![0]).not.toBe(tree[0].children![0])
  })

  it('未命中的 key 返回同一引用；本来就空的目标不再换身份', function () {
    const tree = makeTree()
    expect(dropFileTreeChildren(tree, '0::nope')).toBe(tree)
    const dropped = dropFileTreeChildren(tree, '0::a')
    expect(dropFileTreeChildren(dropped, '0::a')).toBe(dropped)
  })
})

describe('appendFileTreeChildren（显示更多）', function () {
  it('未命中返回同一引用，命中则拼接并更新 hasMore', function () {
    const tree = makeTree()
    expect(
      appendFileTreeChildren(tree, '0::nope', [makeFile('0::nope/x.ts')], {
        hasMore: false,
        nextOffset: 1
      })
    ).toBe(tree)

    const next = appendFileTreeChildren(tree, '0::a', [makeFile('0::a/two.ts')], {
      hasMore: false,
      nextOffset: 2
    })
    const target = findFileTreeNode(next, '0::a')
    expect(target?.children?.map(function (node) {
      return node.key
    })).toEqual(['0::a/one.ts', '0::a/two.ts'])
    expect(target?.hasMore).toBe(false)
    expect(target?.nextOffset).toBe(2)
  })
})

describe('patchFileTreeNode', function () {
  it('只克隆命中路径，未命中返回同一引用', function () {
    const tree = makeTree()
    expect(patchFileTreeNode(tree, '0::nope', { isLoading: true })).toBe(tree)
    const next = patchFileTreeNode(tree, '0::b/c', { isLoading: true })
    expect(next[0].children![0]).toBe(tree[0].children![0])
    expect(findFileTreeNode(next, '0::b/c')?.isLoading).toBe(true)
  })
})

describe('findFileTreeNode', function () {
  it('深层命中返回节点，缺失返回 null', function () {
    const tree = makeTree()
    expect(findFileTreeNode(tree, '0::b/c/two.ts')?.title).toBe('0::b/c/two.ts')
    expect(findFileTreeNode(tree, '0::b/zzz')).toBeNull()
  })
})
