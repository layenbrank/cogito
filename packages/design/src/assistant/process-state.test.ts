import { describe, expect, it } from 'vitest'

import {
  findResponseStart,
  formatRunDuration,
  toProcessDigest,
  toProcessRows,
  toProcessRuns,
  toRunActivityStatus,
  toRunCounts,
  toRunStatus,
  toThinkingHint,
  toToolArgDetail,
  type PartLike
} from './process-state'

/** 造一条 part：只填过程区真正会读的字段 */
function part(type: string, status: PartLike['status'], extra?: Partial<PartLike>): PartLike {
  return { type, status, ...extra }
}

describe('findResponseStart', function () {
  it('从末尾倒找最后一段正文：它之前的一切都算过程', function () {
    const parts = [
      part('reasoning', { type: 'complete' }),
      part('tool-call', { type: 'complete' }),
      part('text', { type: 'complete' }, { text: '结论' })
    ]
    expect(findResponseStart(parts)).toBe(2)
  })

  it('紧邻最后一段正文的正文一起算进来（模型分段写结论时不把它当过程）', function () {
    const parts = [
      part('tool-call', { type: 'complete' }),
      part('text', { type: 'complete' }, { text: '第一段结论' }),
      part('text', { type: 'complete' }, { text: '第二段结论' })
    ]
    expect(findResponseStart(parts)).toBe(1)
  })

  it('最后的正文是空串时不算结论，只认非空正文', function () {
    const parts = [
      part('text', { type: 'complete' }, { text: '正文' }),
      part('text', { type: 'complete' }, { text: '   \n ' })
    ]
    expect(findResponseStart(parts)).toBe(0)
  })

  it('还没吐出正文时整条都算过程', function () {
    const parts = [part('reasoning', { type: 'running' }), part('tool-call', { type: 'running' })]
    expect(findResponseStart(parts)).toBe(parts.length)
  })
})

describe('toProcessRuns', function () {
  it('相邻思考合成一块，工具与解说各占一块', function () {
    const parts = [
      part('reasoning', { type: 'complete' }),
      part('reasoning', { type: 'complete' }),
      part('tool-call', { type: 'complete' }, { toolCallId: 'a' }),
      part('text', { type: 'complete' }, { text: '我看到了问题' }),
      part('tool-call', { type: 'complete' }, { toolCallId: 'b' })
    ]

    expect(toProcessRuns(parts, 0, parts.length)).toEqual([
      { kind: 'reasoning', indices: [0, 1] },
      { kind: 'tool', indices: [2] },
      { kind: 'single', indices: [3] },
      { kind: 'tool', indices: [4] }
    ])
  })

  it('相邻工具合成一段（渲染时仍一件一行，分组只是可选能力）', function () {
    const parts = [
      part('tool-call', { type: 'complete' }, { toolCallId: 'a' }),
      part('tool-call', { type: 'complete' }, { toolCallId: 'b' })
    ]
    expect(toProcessRuns(parts, 0, parts.length)).toEqual([{ kind: 'tool', indices: [0, 1] }])
  })

  it('未知 part 不合并（plan / file / image 各自常驻）', function () {
    const parts = [part('file', { type: 'complete' }), part('image', { type: 'complete' })]
    expect(toProcessRuns(parts, 0, parts.length)).toEqual([
      { kind: 'single', indices: [0] },
      { kind: 'single', indices: [1] }
    ])
  })

  it('只切 [from, to) 这一段', function () {
    const parts = [
      part('text', { type: 'complete' }),
      part('tool-call', { type: 'complete' }),
      part('text', { type: 'complete' }),
      part('text', { type: 'complete' })
    ]
    expect(toProcessRuns(parts, 1, 3)).toEqual([
      { kind: 'tool', indices: [1] },
      { kind: 'single', indices: [2] }
    ])
  })
})

describe('toRunStatus / toRunCounts', function () {
  it('块里有一个在跑就算在跑（与库的 getGroupStatus 同规则）', function () {
    const parts = [part('tool-call', { type: 'complete' }), part('tool-call', { type: 'running' })]
    expect(toRunStatus(parts, [0, 1]).type).toBe('running')
    expect(toRunStatus(parts, [0]).type).toBe('complete')
  })

  it('计数之和等于 part 数', function () {
    const parts = [
      part('reasoning', { type: 'complete' }),
      part('reasoning', { type: 'running' }),
      part('reasoning', { type: 'requires-action', reason: 'tool-calls' }),
      part('reasoning', { type: 'incomplete', reason: 'error' })
    ]
    expect(toRunCounts(parts, [0, 1, 2, 3])).toEqual({
      running: 1,
      complete: 1,
      incomplete: 1,
      requiresAction: 1
    })
  })
})

describe('formatRunDuration', function () {
  it('没有时长（0 / 负数 / NaN）不写数字', function () {
    expect(formatRunDuration(0)).toBe('')
    expect(formatRunDuration(-1)).toBe('')
    expect(formatRunDuration(Number.NaN)).toBe('')
  })

  it('不到 1 秒说 <1s，不假装精确', function () {
    expect(formatRunDuration(400)).toBe('<1s')
    expect(formatRunDuration(999)).toBe('<1s')
  })

  it('10 秒内留一位小数（元素页同款 4.8s）', function () {
    expect(formatRunDuration(4800)).toBe('4.8s')
    expect(formatRunDuration(9990)).toBe('9.9s')
  })

  it('10 秒以上取整秒', function () {
    expect(formatRunDuration(10000)).toBe('10s')
    expect(formatRunDuration(59999)).toBe('59s')
  })

  it('一分钟以上写成 m s', function () {
    expect(formatRunDuration(133000)).toBe('2m 13s')
  })

  it('一小时以上写成 h m', function () {
    expect(formatRunDuration(3840000)).toBe('1h 4m')
  })
})

describe('toThinkingHint', function () {
  it('取最后一行：思考是往后长的，最新那句才代表现在在想什么', function () {
    expect(toThinkingHint('先看一下组件\n然后再读样式')).toBe('然后再读样式')
    expect(toThinkingHint('先看一下组件\n\n   \n最后这句  ')).toBe('最后这句')
  })

  it('抹掉 Markdown 记号、压成一行', function () {
    expect(toThinkingHint('- 结论：改 `thread.aui.tsx`')).toBe('结论：改 thread.aui.tsx')
  })

  it('没有正文 / 只有空行时不给提示，折叠行退回只有状态词', function () {
    expect(toThinkingHint(undefined)).toBeUndefined()
    expect(toThinkingHint('')).toBeUndefined()
    expect(toThinkingHint('  \n\n')).toBeUndefined()
  })

  it('超长截断（默认 40 字）', function () {
    expect(toThinkingHint('a'.repeat(80))).toHaveLength(40)
    expect(toThinkingHint('a'.repeat(80))?.endsWith('…')).toBe(true)
    expect(toThinkingHint('b'.repeat(40))?.endsWith('…')).toBe(false)
  })
})

describe('toRunActivityStatus', function () {
  it('没有状态按未完成处理', function () {
    expect(toRunActivityStatus(undefined)).toBe('incomplete')
  })

  it('三种正常状态各归各位', function () {
    expect(toRunActivityStatus({ type: 'running' })).toBe('running')
    expect(toRunActivityStatus({ type: 'requires-action', reason: 'tool-calls' })).toBe(
      'requires-action'
    )
    expect(toRunActivityStatus({ type: 'complete', reason: 'stop' })).toBe('complete')
  })

  it('用户停止与出错单独区分', function () {
    expect(toRunActivityStatus({ type: 'incomplete', reason: 'cancelled' })).toBe('cancelled')
    expect(toRunActivityStatus({ type: 'incomplete', reason: 'error' })).toBe('error')
  })

  it('截断 / 内容过滤 / 工具中断都算未完成', function () {
    for (const reason of ['length', 'content-filter', 'other', 'tool-calls'] as const) {
      expect(toRunActivityStatus({ type: 'incomplete', reason })).toBe('incomplete')
    }
  })
})

describe('toProcessRows', function () {
  it('工具一件一行：连续 5 次调用不能被写成 1 步', function () {
    const parts = [0, 1, 2, 3, 4].map(function () {
      return part('tool-call', { type: 'complete' }, { toolName: 'read_file' })
    })
    const rows = toProcessRows(toProcessRuns(parts, 0, parts.length))
    expect(rows).toBe(5)
  })

  it('思考段与解说各占一行，和渲染出来的行数一致', function () {
    const parts = [
      part('reasoning', { type: 'complete' }),
      part('reasoning', { type: 'complete' }),
      part('tool-call', { type: 'complete' }, { toolName: 'run_command' }),
      part('text', { type: 'complete' }, { text: '先说一句' })
    ]
    expect(toProcessRows(toProcessRuns(parts, 0, parts.length))).toBe(3)
  })

  it('没有过程时是 0 行（外壳不出现）', function () {
    expect(toProcessRows([])).toBe(0)
  })
})

describe('toToolArgDetail', function () {
  it('按「路径 / 命令 / 查询词」的顺序取第一个命中的字符串参数', function () {
    expect(toToolArgDetail({ path: 'src/main.ts', command: 'pnpm test' })).toBe('src/main.ts')
    expect(toToolArgDetail({ command: 'pnpm test' })).toBe('pnpm test')
    expect(toToolArgDetail({ query: '折叠 明细' })).toBe('折叠 明细')
  })

  it('跳过非字符串与空串，取不到就不写', function () {
    expect(toToolArgDetail({ path: 42, command: '   ' })).toBeUndefined()
    expect(toToolArgDetail({})).toBeUndefined()
    expect(toToolArgDetail(undefined)).toBeUndefined()
  })

  it('压成一行并截断（默认 48 字）', function () {
    expect(toToolArgDetail({ command: 'echo a\n echo b' })).toBe('echo a echo b')
    expect(toToolArgDetail({ path: 'a'.repeat(80) })).toHaveLength(48)
    expect(toToolArgDetail({ path: 'a'.repeat(80) })?.endsWith('…')).toBe(true)
  })
})

describe('toProcessDigest', function () {
  it('工具按件摊开、思考取最后一句、解说取首行', function () {
    const parts = [
      part('reasoning', { type: 'complete' }, { text: '先看目录\n再看入口文件' }),
      part(
        'tool-call',
        { type: 'complete' },
        { toolName: 'read_file', args: { path: 'src/main.ts' } }
      ),
      part(
        'tool-call',
        { type: 'complete' },
        { toolName: 'run_command', args: { command: 'pnpm test' } }
      ),
      part('text', { type: 'complete' }, { text: '跑一下测试\n顺便看看日志' })
    ]
    const digest = toProcessDigest(parts, toProcessRuns(parts, 0, parts.length))

    expect(digest.tools).toBe(2)
    expect(digest.thoughts).toBe(1)
    expect(digest.notes).toBe(1)
    expect(digest.entries).toEqual([
      { kind: 'thinking', hint: '再看入口文件' },
      { kind: 'tool', toolName: 'read_file', detail: 'src/main.ts' },
      { kind: 'tool', toolName: 'run_command', detail: 'pnpm test' },
      { kind: 'note', text: '跑一下测试' }
    ])
  })

  it('相邻思考合成一段：构成行说「1 段思考」，清单里也只有一行', function () {
    const parts = [
      part('reasoning', { type: 'complete' }, { text: '先看目录' }),
      part('reasoning', { type: 'complete' }, { text: '再看入口文件' }),
      part(
        'tool-call',
        { type: 'complete' },
        { toolName: 'read_file', args: { path: 'src/main.ts' } }
      )
    ]
    const runs = toProcessRuns(parts, 0, parts.length)
    const digest = toProcessDigest(parts, runs)

    // 段数按行算（与 toProcessRows / 清单条目同一口径），不按 part 数
    expect(digest.thoughts).toBe(1)
    expect(toProcessRows(runs)).toBe(2)
    expect(digest.entries).toEqual([
      { kind: 'thinking', hint: '再看入口文件' },
      { kind: 'tool', toolName: 'read_file', detail: 'src/main.ts' }
    ])
  })

  it('没有文字的 single 块（file / data UI）不进清单，只靠展开看', function () {
    const parts = [
      part('text', { type: 'complete' }, { text: '开场' }),
      part('file', { type: 'complete' })
    ]
    const digest = toProcessDigest(parts, toProcessRuns(parts, 0, parts.length))
    expect(digest.entries).toEqual([{ kind: 'note', text: '开场' }])
  })

  it('工具没有名字时只计数、不占一行（写不出「读取什么」）', function () {
    const parts = [part('tool-call', { type: 'complete' })]
    const digest = toProcessDigest(parts, toProcessRuns(parts, 0, parts.length))
    expect(digest.tools).toBe(1)
    expect(digest.entries).toHaveLength(0)
  })

  it('空正文的解说与空思考段也不进清单', function () {
    const parts = [
      part('reasoning', { type: 'complete' }, { text: '   ' }),
      part('text', { type: 'complete' }, { text: '\n\n' })
    ]
    const digest = toProcessDigest(parts, toProcessRuns(parts, 0, parts.length))
    expect(digest.entries).toEqual([])
    expect(digest.thoughts).toBe(1)
    expect(digest.notes).toBe(0)
  })
})
