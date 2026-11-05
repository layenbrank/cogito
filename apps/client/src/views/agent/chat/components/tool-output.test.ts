import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock } = vi.hoisted(function () {
  return {
    invokeMock: vi.fn(function (): Promise<{ text: string }> {
      return Promise.resolve({ text: 'from-rust' })
    })
  }
})

vi.mock('@tauri-apps/api/core', function () {
  return { invoke: invokeMock }
})

import {
  collapseOutput,
  formatTerminalText,
  normalizeToolOutput,
  TERMINAL_PREVIEW_LINES,
  toCodeSource,
  toShellCommand
} from './tool-output'

describe('toShellCommand', function () {
  it('reads command / workdir / background', function () {
    expect(
      toShellCommand({ command: 'pnpm test', workdir: 'packages/core', background: true })
    ).toEqual({ command: 'pnpm test', workdir: 'packages/core', background: true })
  })

  it('returns null without a command', function () {
    expect(toShellCommand({ description: 'run tests' })).toBeNull()
    expect(toShellCommand(null)).toBeNull()
  })
})

describe('toCodeSource', function () {
  it('takes the first non-empty candidate key', function () {
    expect(toCodeSource({ code: 'return 1' })).toBe('return 1')
    expect(toCodeSource({ code: '  ', script: 'return 2' })).toBe('return 2')
  })
})

describe('collapseOutput', function () {
  it('folds past maxLines and unescapes literal breaks', function () {
    expect(collapseOutput('a\\r\\nb\\r\\nc', 2)).toEqual({
      lines: ['a', 'b'],
      hidden: 1
    })
  })

  it('uses the terminal preview as the default budget', function () {
    const raw = Array.from({ length: TERMINAL_PREVIEW_LINES + 3 }, function (_v, index) {
      return `line ${index}`
    }).join('\n')

    expect(collapseOutput(raw).hidden).toBe(3)
  })
})

describe('formatTerminalText', function () {
  it('keeps plain multiline text', function () {
    expect(formatTerminalText('a\nb')).toBe('a\nb')
  })

  it('unescapes literal \\r\\n / \\n in a single-line blob', function () {
    expect(formatTerminalText('import Vue\\r\\nfrom "vue"')).toBe('import Vue\nfrom "vue"')
  })

  it('unwraps a JSON-encoded string', function () {
    expect(formatTerminalText(JSON.stringify('line1\nline2'))).toBe('line1\nline2')
  })

  it('extracts stdout/stderr from result objects', function () {
    expect(
      formatTerminalText({
        stdout: 'ok\\nmore',
        stderr: 'warn'
      })
    ).toBe('ok\nmore\nwarn')
  })

  it('reads ACP content blocks', function () {
    expect(
      formatTerminalText([
        { type: 'text', text: 'hello\\nworld' },
        { type: 'text', text: 'done' }
      ])
    ).toBe('hello\nworld\ndone')
  })

  it('does not treat normal Windows paths as escaped breaks', function () {
    expect(formatTerminalText('D:\\Documents\\workspace\\front')).toBe(
      'D:\\Documents\\workspace\\front'
    )
  })
})

describe('normalizeToolOutput', function () {
  beforeEach(function () {
    invokeMock.mockClear()
  })

  it('结果还没到（undefined）时不打 IPC，也不刷 warn', async function () {
    Reflect.set(window, '__TAURI_INTERNALS__', {})
    try {
      expect(await normalizeToolOutput(undefined)).toBe('')
      expect(invokeMock).not.toHaveBeenCalled()
    } finally {
      Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
    }
  })

  it('有结果时走 Rust 命令并取 text', async function () {
    Reflect.set(window, '__TAURI_INTERNALS__', {})
    try {
      expect(await normalizeToolOutput('a\nb')).toBe('from-rust')
      expect(invokeMock).toHaveBeenCalledWith('agentTool:normalizeOutput', {
        params: { value: 'a\nb' }
      })
    } finally {
      Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
    }
  })
})
