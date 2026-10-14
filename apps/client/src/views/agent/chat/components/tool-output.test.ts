import { describe, expect, it } from 'vitest'

import {
  collapseOutput,
  formatTerminalText,
  TERMINAL_PREVIEW_LINES,
  toCodeSource,
  toShellCommand
} from './tool-output'

describe('toShellCommand', function () {
  it('reads command / workdir / background', function () {
    expect(
      toShellCommand({ command: 'bun test', workdir: 'packages/core', background: true })
    ).toEqual({ command: 'bun test', workdir: 'packages/core', background: true })
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
