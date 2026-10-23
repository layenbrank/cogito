import { describe, expect, it } from 'vitest'

import { collapseOutput, TERMINAL_PREVIEW_LINES, toCodeSource, toShellCommand } from './tool-output'

/**
 * 这里的风险点是「显示出来的命令跟真正跑的不是一回事」以及「输出被吃掉」：
 * 认不出的入参必须交回通用卡（返回 null），而不是猜一个键渲染成空面板。
 */

describe('toShellCommand', function () {
  it('reads command / workdir / background', function () {
    expect(
      toShellCommand({ command: 'pnpm test', workdir: 'packages/core', background: true })
    ).toEqual({ command: 'pnpm test', workdir: 'packages/core', background: true })
  })

  it('defaults workdir to null and background to false', function () {
    expect(toShellCommand({ command: 'ls' })).toEqual({
      command: 'ls',
      workdir: null,
      background: false
    })
  })

  it('ignores a blank workdir', function () {
    expect(toShellCommand({ command: 'ls', workdir: '   ' })?.workdir).toBeNull()
  })

  it('returns null without a command (交给通用卡)', function () {
    expect(toShellCommand({ description: 'run tests' })).toBeNull()
    expect(toShellCommand({ command: '  ' })).toBeNull()
    expect(toShellCommand(null)).toBeNull()
    expect(toShellCommand('pnpm test')).toBeNull()
  })
})

describe('toCodeSource', function () {
  it('takes the first non-empty candidate key', function () {
    expect(toCodeSource({ code: 'return 1' })).toBe('return 1')
    expect(toCodeSource({ script: 'return 1' })).toBe('return 1')
    expect(toCodeSource({ code: '  ', script: 'return 2' })).toBe('return 2')
  })

  it('returns null when nothing looks like source', function () {
    expect(toCodeSource({ description: 'run tests' })).toBeNull()
    expect(toCodeSource([])).toBeNull()
  })
})

describe('collapseOutput', function () {
  it('keeps short output intact', function () {
    expect(collapseOutput('a\nb')).toEqual({ lines: ['a', 'b'], hidden: 0 })
  })

  it('folds everything past maxLines and counts the rest', function () {
    const actual = collapseOutput('1\n2\n3\n4', 2)

    expect(actual.lines).toEqual(['1', '2'])
    expect(actual.hidden).toBe(2)
  })

  it('treats empty, null and newline-only output as no lines', function () {
    expect(collapseOutput('')).toEqual({ lines: [], hidden: 0 })
    expect(collapseOutput(null)).toEqual({ lines: [], hidden: 0 })
    expect(collapseOutput('\n\n')).toEqual({ lines: [], hidden: 0 })
  })

  it('drops one trailing newline so no phantom last line appears', function () {
    expect(collapseOutput('a\nb\n').lines).toEqual(['a', 'b'])
  })

  it('normalizes CRLF (Windows 命令的输出)', function () {
    expect(collapseOutput('a\r\nb\r\n').lines).toEqual(['a', 'b'])
  })

  it('keeps interior blank lines', function () {
    expect(collapseOutput('a\n\nb').lines).toEqual(['a', '', 'b'])
  })

  it('uses the terminal preview as the default budget', function () {
    const raw = Array.from({ length: TERMINAL_PREVIEW_LINES + 3 }, function (_v, index) {
      return `line ${index}`
    }).join('\n')

    expect(collapseOutput(raw).hidden).toBe(3)
  })
})
