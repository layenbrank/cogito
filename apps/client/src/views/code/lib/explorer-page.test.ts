/**
 * 资源管理器分页的「读盘 → 排序 → 切片」契约。
 *
 * `listWorkspaceEntries` 是分页的唯一入口：后端一次给整层 `readDir`，前端先排序再按
 * `offset/limit` 切片。这里的用例锁死「同一目录多次翻页不重复、不漏项、不因隐藏文件
 * 过滤而错位」—— 这三件事一旦破了，虚表里的行会跳动，用户会以为文件丢了。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readDirMock } = vi.hoisted(function () {
  return { readDirMock: vi.fn() }
})

vi.mock('@tauri-apps/plugin-fs', function () {
  return {
    readDir: readDirMock,
    exists: vi.fn(),
    mkdir: vi.fn(),
    readTextFile: vi.fn(),
    remove: vi.fn(),
    rename: vi.fn(),
    stat: vi.fn(),
    writeTextFile: vi.fn()
  }
})

vi.mock('@tauri-apps/plugin-dialog', function () {
  return { open: vi.fn() }
})

import { listWorkspaceEntries } from '@/views/code/lib/fs.ts'
import { EXPLORER_PAGE_SIZE } from '@/views/code/lib/paging.ts'

const ROOT = 'C:/work/app'

interface FakeDirent {
  name: string
  isDirectory: boolean
}

/** 造一层「目录 / 文件」混排的条目，顺序刻意打乱，让排序逻辑真正起作用 */
function makeEntries(count: number): FakeDirent[] {
  const entries: FakeDirent[] = []
  for (let index = 0; index < count; index += 1) {
    const isDirectory = index % 3 === 0
    entries.push({
      name: `${isDirectory ? 'dir' : 'file'}-${String(count - index).padStart(4, '0')}`,
      isDirectory
    })
  }
  return entries
}

describe('explorer 分页：读目录的 offset / limit 契约', function () {
  beforeEach(function () {
    readDirMock.mockReset()
  })

  it('先排序后切片：首屏目录在前、按名称升序，且标记还有更多', async function () {
    readDirMock.mockResolvedValue(makeEntries(450))

    const page = await listWorkspaceEntries(ROOT, '', { isHiddenVisible: true })

    expect(page.entries).toHaveLength(EXPLORER_PAGE_SIZE)
    expect(page.total).toBe(450)
    expect(page.isTruncated).toBe(true)
    expect(page.nextOffset).toBe(EXPLORER_PAGE_SIZE)
    // 目录全部排在文件前面
    const flags = page.entries.map(function (entry) {
      return entry.isDirectory
    })
    expect(flags.indexOf(false)).toBeGreaterThan(0)
    expect(flags.slice(flags.indexOf(false)).some(Boolean)).toBe(false)
    // 同类型内部按名称升序
    const dirNames = page.entries
      .filter(function (entry) {
        return entry.isDirectory
      })
      .map(function (entry) {
        return entry.name
      })
    expect(dirNames).toEqual([...dirNames].sort())
  })

  it('offset 连续：翻页拼起来等于排序后全量，无重复无遗漏', async function () {
    readDirMock.mockResolvedValue(makeEntries(450))

    const collected: string[] = []
    let offset = 0
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await listWorkspaceEntries(ROOT, '', { isHiddenVisible: true, offset })
      collected.push(...page.entries.map((entry) => entry.name))
      offset = page.nextOffset
      if (!page.isTruncated) break
    }

    expect(collected).toHaveLength(450)
    expect(new Set(collected).size).toBe(450)
    // 每页都是同一份排序结果的前缀拼接：整体仍然有序
    expect(collected).toEqual([...collected].sort(function (a, b) {
      const dirA = a.startsWith('dir-')
      const dirB = b.startsWith('dir-')
      if (dirA !== dirB) return dirA ? -1 : 1
      return a.localeCompare(b)
    }))
  })

  it('隐藏条目在切片前剔除，不影响后续页的 offset 口径', async function () {
    readDirMock.mockResolvedValue([
      { name: '.git', isDirectory: true },
      { name: 'src', isDirectory: true },
      { name: '.env', isDirectory: false },
      { name: 'index.ts', isDirectory: false }
    ])

    const visible = await listWorkspaceEntries(ROOT, '', { limit: 10 })
    expect(visible.total).toBe(2)
    expect(visible.entries.map((entry) => entry.name)).toEqual(['src', 'index.ts'])

    const withHidden = await listWorkspaceEntries(ROOT, '', { isHiddenVisible: true, limit: 10 })
    expect(withHidden.total).toBe(4)
    expect(withHidden.entries.map((entry) => entry.name)).toEqual(['.git', 'src', '.env', 'index.ts'])
  })

  it('显式 limit 生效，nextOffset 按 limit 递增', async function () {
    readDirMock.mockResolvedValue(makeEntries(30))

    const first = await listWorkspaceEntries(ROOT, '', { isHiddenVisible: true, limit: 7 })
    expect(first.entries).toHaveLength(7)
    expect(first.nextOffset).toBe(7)
    expect(first.isTruncated).toBe(true)

    const second = await listWorkspaceEntries(ROOT, '', {
      isHiddenVisible: true,
      limit: 7,
      offset: first.nextOffset
    })
    expect(second.entries).toHaveLength(7)
    expect(second.nextOffset).toBe(14)
    expect(second.entries[0]).not.toBe(first.entries[0])
  })

  it('越界 offset 返回空页而不是抛错', async function () {
    readDirMock.mockResolvedValue(makeEntries(5))

    const page = await listWorkspaceEntries(ROOT, '', { isHiddenVisible: true, offset: 99 })
    expect(page.entries).toEqual([])
    expect(page.isTruncated).toBe(false)
  })

  it('子目录按相对路径拼出完整 path，供树 key 使用', async function () {
    readDirMock.mockResolvedValue([{ name: 'index.ts', isDirectory: false }])

    const page = await listWorkspaceEntries(ROOT, 'src/views', { isHiddenVisible: true })
    expect(page.entries[0]?.path).toBe('src/views/index.ts')
  })
})
