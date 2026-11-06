import { describe, expect, it } from 'vitest'

import {
  findRunStatusLabel,
  formatRunDuration,
  partNeedsAttention,
  toActivityLabel,
  toActivitySegments,
  toRunActivityStatus,
  type PartLike
} from './run-activity-state'

const LABELS = {
  runWorking: '工作中',
  runWorked: '已工作',
  runCompleted: '已完成',
  runNeedsAction: '等待确认',
  runStopped: '已停止',
  runFailed: '运行失败',
  runIncomplete: '未完成'
}

/** 造一条 part：只填活动流水真正会读的字段 */
function part(type: string, status: PartLike['status'], extra?: Partial<PartLike>): PartLike {
  return { type, status, ...extra }
}

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

describe('toActivityLabel', function () {
  it('没有正文就不给标签', function () {
    expect(toActivityLabel(undefined)).toBeUndefined()
    expect(toActivityLabel('')).toBeUndefined()
    expect(toActivityLabel('  \n\n  ')).toBeUndefined()
  })

  it('取第一行非空内容，跳过空行', function () {
    expect(toActivityLabel('\n\n先看一下文件\n然后再说别的')).toBe('先看一下文件')
  })

  it('抹掉标题与列表记号', function () {
    expect(toActivityLabel('## 结论')).toBe('结论')
    expect(toActivityLabel('- 一条列表项')).toBe('一条列表项')
  })

  it('抹掉行内 markdown（不解析整段）', function () {
    // 源码里 `的 **实现**` 中间本来就有一个空格，抹掉记号后保留它（与渲染出来一致）
    expect(toActivityLabel('看 `src/a.ts` 的 **实现**')).toBe('看 src/a.ts 的 实现')
    // 记号之间挨着的空白收成一格
    expect(toActivityLabel('**先**   **后**')).toBe('先 后')
  })

  it('超长截断并带省略号', function () {
    const long = 'a'.repeat(60)
    const label = toActivityLabel(long)
    expect(label).toHaveLength(48)
    expect(label?.endsWith('…')).toBe(true)
    expect(toActivityLabel('b'.repeat(48))).toHaveLength(48)
    expect(toActivityLabel('c'.repeat(48))?.endsWith('…')).toBe(false)
  })

  it('截断长度可调', function () {
    expect(toActivityLabel('a'.repeat(20), 10)).toBe(`${'a'.repeat(9)}…`)
  })

  it('只有记号的行等于没内容', function () {
    expect(toActivityLabel('###   ')).toBeUndefined()
  })
})

describe('toActivitySegments', function () {
  it('相邻解说合成一条，思考相邻也合，工具与未知 part 各自独占', function () {
    const parts = [
      part('text', { type: 'complete' }, { text: '先说一句' }),
      part('text', { type: 'complete' }, { text: '再说一句' }),
      part('tool-call', { type: 'complete' }, { toolName: 'read_file', toolCallId: 'a' }),
      part('text', { type: 'complete' }, { text: '我看到了问题' }),
      part('reasoning', { type: 'complete' }),
      part('reasoning', { type: 'complete' }),
      part('data', { type: 'complete' })
    ]

    expect(toActivitySegments(parts, 0, parts.length)).toEqual([
      { kind: 'commentary', indices: [0, 1] },
      { kind: 'tool', indices: [2] },
      { kind: 'commentary', indices: [3] },
      { kind: 'reasoning', indices: [4, 5] },
      { kind: 'other', indices: [6] }
    ])
  })

  it('两次相邻的工具调用是两条（各自 toolCallId 就是边界）', function () {
    const parts = [
      part('tool-call', { type: 'complete' }, { toolCallId: 'a' }),
      part('tool-call', { type: 'complete' }, { toolCallId: 'b' })
    ]
    expect(toActivitySegments(parts, 0, parts.length)).toHaveLength(2)
  })

  it('相邻的未知 part 不合并（要各自常驻可见）', function () {
    const parts = [part('file', { type: 'complete' }), part('image', { type: 'complete' })]
    expect(toActivitySegments(parts, 0, parts.length)).toEqual([
      { kind: 'other', indices: [0] },
      { kind: 'other', indices: [1] }
    ])
  })

  it('只切 [from, to) 这一段', function () {
    const parts = [
      part('text', { type: 'complete' }),
      part('tool-call', { type: 'complete' }),
      part('text', { type: 'complete' }),
      part('text', { type: 'complete' })
    ]
    expect(toActivitySegments(parts, 1, 3)).toEqual([
      { kind: 'tool', indices: [1] },
      { kind: 'commentary', indices: [2] }
    ])
  })
})

describe('partNeedsAttention', function () {
  it('等审批的工具调用必须露在折叠区外面', function () {
    expect(partNeedsAttention(part('tool-call', { type: 'requires-action', reason: 'tool-calls' }))).toBe(true)
    expect(partNeedsAttention(part('tool-call', { type: 'requires-action', reason: 'interrupt' }))).toBe(true)
  })

  it('失败的工具调用也算（不只是审批）', function () {
    expect(partNeedsAttention(part('tool-call', { type: 'incomplete', reason: 'tool-calls' }))).toBe(true)
    expect(partNeedsAttention(part('text', { type: 'incomplete', reason: 'error' }))).toBe(true)
  })

  it('用户自己取消的不算失败', function () {
    expect(partNeedsAttention(part('text', { type: 'incomplete', reason: 'cancelled' }))).toBe(false)
  })

  it('跑完 / 在跑都不需要打扰用户', function () {
    expect(partNeedsAttention(part('tool-call', { type: 'complete' }))).toBe(false)
    expect(partNeedsAttention(part('tool-call', { type: 'running' }))).toBe(false)
  })
})

describe('toRunActivityStatus', function () {
  it('没有状态按未完成处理', function () {
    expect(toRunActivityStatus(undefined)).toBe('incomplete')
  })

  it('四种状态各归各位', function () {
    expect(toRunActivityStatus({ type: 'running' })).toBe('running')
    expect(toRunActivityStatus({ type: 'requires-action', reason: 'tool-calls' })).toBe('requires-action')
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

describe('findRunStatusLabel', function () {
  it('跑完有时长写「已工作」，没时长退回「已完成」', function () {
    expect(findRunStatusLabel('complete', LABELS, true)).toBe('已工作')
    expect(findRunStatusLabel('complete', LABELS, false)).toBe('已完成')
  })

  it('运行中 / 等审批 / 停止 / 失败 / 未完成各有文案', function () {
    expect(findRunStatusLabel('running', LABELS, false)).toBe('工作中')
    expect(findRunStatusLabel('requires-action', LABELS, false)).toBe('等待确认')
    expect(findRunStatusLabel('cancelled', LABELS, false)).toBe('已停止')
    expect(findRunStatusLabel('error', LABELS, false)).toBe('运行失败')
    expect(findRunStatusLabel('incomplete', LABELS, false)).toBe('未完成')
  })
})
