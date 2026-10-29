import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ImportResult } from '@/shared/ipc/specs/sidecar'

import { useLibrary } from './use-library.ts'

type ImportOptions = {
  path: string
  folder?: string
  is_overwrite?: boolean
  is_dry_run?: boolean
}

const corex = vi.hoisted(function () {
  const state = {
    directives: [] as unknown[],
    runs: [] as unknown[],
    isLoaded: true,
    isLoading: false,
    fetchError: null as string | null,
    initialize: vi.fn(function (): Promise<void> {
      return Promise.resolve()
    }),
    refreshDirectives: vi.fn(function (): Promise<void> {
      return Promise.resolve()
    }),
    importDirectivesFromHost: vi.fn()
  }

  function select(selector: (current: typeof state) => unknown) {
    return selector(state)
  }

  return { ...state, select }
})

const dialog = vi.hoisted(function () {
  return { open: vi.fn() }
})

const toasts = vi.hoisted(function () {
  type ToastArgs = [message: string, options?: { description?: string }]
  return {
    success: vi.fn<(...args: ToastArgs) => void>(),
    error: vi.fn<(...args: ToastArgs) => void>(),
    message: vi.fn<(...args: ToastArgs) => void>()
  }
})

vi.mock('@/stores/corex.ts', function () {
  return { useCorexStore: corex.select }
})

vi.mock('@tauri-apps/plugin-dialog', function () {
  return { open: dialog.open }
})

vi.mock('sonner', function () {
  return { toast: toasts }
})

type Status = 'created' | 'skipped'

function makeResult(entries: readonly { name: string; status: Status }[]): ImportResult {
  const counts: Record<Status, number> = { created: 0, skipped: 0 }
  entries.forEach(function (entry) {
    counts[entry.status] += 1
  })
  return {
    entries: entries.map(function (entry) {
      return { name: entry.name, path: `/lib/${entry.name}.yaml`, status: entry.status }
    }),
    created: counts.created,
    updated: 0,
    skipped: counts.skipped,
    failed: 0
  }
}

function renderLibrary() {
  return renderHook(
    function () {
      return useLibrary({})
    },
    {
      wrapper(props: { children: ReactNode }) {
        return <MemoryRouter>{props.children}</MemoryRouter>
      }
    }
  )
}

beforeEach(function () {
  dialog.open.mockReset()
  corex.importDirectivesFromHost.mockReset()
  corex.refreshDirectives.mockReset()
  toasts.success.mockReset()
  toasts.error.mockReset()
})

describe('useLibrary 导入', function () {
  it('多选一批文件就逐个落库，不是每个文件弹一次框', async function () {
    dialog.open.mockResolvedValue(['/lib/a.yaml', '/lib/b.yaml'])
    corex.importDirectivesFromHost.mockImplementation(function (
      options: ImportOptions
    ): Promise<ImportResult> {
      return Promise.resolve(
        options.is_dry_run
          ? makeResult([])
          : makeResult([{ name: options.path, status: 'created' }])
      )
    })

    const { result } = renderLibrary()
    await act(async function () {
      await result.current.handleImportFiles()
    })

    expect(dialog.open).toHaveBeenCalledWith(expect.objectContaining({ multiple: true }))
    const calls: ImportOptions[] = corex.importDirectivesFromHost.mock.calls.map(function (call) {
      return call[0] as ImportOptions
    })
    expect(calls).toEqual([
      { path: '/lib/a.yaml', is_dry_run: true },
      { path: '/lib/b.yaml', is_dry_run: true },
      { path: '/lib/a.yaml', is_overwrite: false },
      { path: '/lib/b.yaml', is_overwrite: false }
    ])
    expect(corex.refreshDirectives).toHaveBeenCalledTimes(1)
  })

  it('目录导入按目录语义走，预检没同名就直接落库', async function () {
    dialog.open.mockResolvedValue('/lib/directives')
    corex.importDirectivesFromHost.mockImplementation(function (
      options: ImportOptions
    ): Promise<ImportResult> {
      return Promise.resolve(
        options.is_dry_run ? makeResult([]) : makeResult([{ name: 'a', status: 'created' }])
      )
    })

    const { result } = renderLibrary()
    await act(async function () {
      await result.current.handleImportFolder()
    })

    expect(dialog.open).toHaveBeenCalledWith({ directory: true })
    expect(corex.importDirectivesFromHost).toHaveBeenLastCalledWith({
      path: '/lib/directives',
      is_overwrite: false
    })
  })

  it('扫出同名先问一轮，不问完不落库；选了覆盖才带 is_overwrite', async function () {
    dialog.open.mockResolvedValue(['/lib/a.yaml', '/lib/b.yaml'])
    corex.importDirectivesFromHost.mockImplementation(function (
      options: ImportOptions
    ): Promise<ImportResult> {
      if (!options.is_dry_run)
        return Promise.resolve(makeResult([{ name: 'a', status: 'created' }]))
      return Promise.resolve(
        options.path === '/lib/a.yaml'
          ? makeResult([{ name: 'a', status: 'skipped' }])
          : makeResult([{ name: 'b', status: 'created' }])
      )
    })

    const { result } = renderLibrary()
    await act(async function () {
      await result.current.handleImportFiles()
    })

    expect(result.current.importConflicts).toEqual(['a'])
    expect(corex.importDirectivesFromHost).toHaveBeenCalledTimes(2)
    expect(corex.refreshDirectives).not.toHaveBeenCalled()

    act(function () {
      result.current.confirmImport(true)
    })

    expect(result.current.importConflicts).toBeNull()
    await vi.waitFor(function () {
      expect(corex.refreshDirectives).toHaveBeenCalledTimes(1)
    })
    expect(corex.importDirectivesFromHost).toHaveBeenCalledWith({
      path: '/lib/a.yaml',
      is_overwrite: true
    })
  })

  it('取消就一个文件都不落库', async function () {
    dialog.open.mockResolvedValue(['/lib/a.yaml'])
    corex.importDirectivesFromHost.mockResolvedValue(makeResult([{ name: 'a', status: 'skipped' }]))

    const { result } = renderLibrary()
    await act(async function () {
      await result.current.handleImportFiles()
    })
    expect(result.current.importConflicts).toEqual(['a'])

    act(function () {
      result.current.cancelImport()
    })

    expect(result.current.importConflicts).toBeNull()
    expect(corex.refreshDirectives).not.toHaveBeenCalled()
  })

  it('一条路径落库时炸了，不连累其余的，并在提示里点名', async function () {
    dialog.open.mockResolvedValue(['/lib/a.yaml', '/lib/b.yaml'])
    corex.importDirectivesFromHost.mockImplementation(function (options: ImportOptions) {
      if (options.is_dry_run) return Promise.resolve(makeResult([]))
      if (options.path === '/lib/a.yaml') return Promise.reject(new Error('corex 断了'))
      return Promise.resolve(makeResult([{ name: 'b', status: 'created' }]))
    })

    const { result } = renderLibrary()
    await act(async function () {
      await result.current.handleImportFiles()
    })

    expect(corex.importDirectivesFromHost).toHaveBeenCalledWith({
      path: '/lib/b.yaml',
      is_overwrite: false
    })
    expect(corex.refreshDirectives).toHaveBeenCalledTimes(1)
    const failure = toasts.error.mock.calls[0]
    expect(failure?.[0]).toBe('部分文件导入失败')
    expect(failure?.[1]?.description).toContain('a.yaml')
  })

  it('预检还没回来就再点一次导入，不起第二批', async function () {
    dialog.open.mockResolvedValue(['/lib/a.yaml'])
    let previewCount = 0
    let finishPreview: (value: ImportResult) => void = function () {}
    corex.importDirectivesFromHost.mockImplementation(function (options: ImportOptions) {
      if (!options.is_dry_run) {
        return Promise.resolve(makeResult([{ name: 'a', status: 'created' }]))
      }
      // 只把首次预检挂住；真的又起了第二批的话，第二批会立刻跑完，好让断言直接暴露它
      previewCount += 1
      if (previewCount === 1) {
        return new Promise<ImportResult>(function (resolve) {
          finishPreview = resolve
        })
      }
      return Promise.resolve(makeResult([]))
    })

    const { result } = renderLibrary()
    let first: Promise<void> = Promise.resolve()
    act(function () {
      first = result.current.handleImportFiles()
    })

    await act(async function () {
      await result.current.handleImportFiles()
    })
    expect(dialog.open).toHaveBeenCalledTimes(1)

    await act(async function () {
      finishPreview(makeResult([]))
      await first
    })
    expect(corex.refreshDirectives).toHaveBeenCalledTimes(1)
  })
})
