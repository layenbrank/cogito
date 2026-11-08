/**
 * 过程区是**两层**：外层 `ProcessGroup` 把整轮过程收成一行，里层每块自己开合。
 * 这里锁外壳那层的三件事 —— 跑的时候展开（看得见在干什么）、结算后收起（不占版面）、
 * 秒数只在结算后写进行尾（跑的时候数字一跳一跳，写上是噪音）。
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DefaultProcessGroup, type ProcessSummary, type ThreadGroupPart } from './thread.aui'
import { toRunCounts, toRunStatus, type PartLike } from './process-state'

const parts: PartLike[] = [
  { type: 'reasoning', status: { type: 'complete' } },
  { type: 'tool-call', status: { type: 'complete' }, toolCallId: 'a' }
]

const group: ThreadGroupPart = {
  type: 'group-process',
  status: toRunStatus(parts, [0, 1]),
  counts: toRunCounts(parts, [0, 1]),
  indices: [0, 1]
}

/** 清单列得全：`toProcessSummary` 这时不给构成行（不给同一份数字说两遍） */
const summary: ProcessSummary = {
  lines: [
    { verb: 'Thought', detail: '先看目录' },
    { verb: 'Read', detail: 'src/main.ts' }
  ],
  hidden: 0
}

/** 清单被截断：构成行交代被折掉的总量 */
const summaryTruncated: ProcessSummary = {
  detail: '2 tool calls · 1 thought',
  lines: summary.lines,
  hidden: 3
}

/** 跑的时候折叠行那一格是「当前这一步」，不是构成行 */
const summaryRunning: ProcessSummary = {
  detail: 'Read · src/main.ts',
  lines: summary.lines,
  hidden: 0
}

function render(props: {
  running: boolean
  seconds?: number
  summary?: ProcessSummary
  attention?: boolean
}): string {
  return renderToStaticMarkup(
    <DefaultProcessGroup
      group={group}
      steps={2}
      {...props}>
      <span data-slot="process-child">思考一段一条</span>
    </DefaultProcessGroup>
  )
}

describe('DefaultProcessGroup', function () {
  it('外壳上挂自己的 data-slot，子折叠留在里面（两级结构的定位点）', function () {
    const html = render({ running: true })
    expect(html).toContain('data-slot="aui_assistant-process-shell"')
    expect(html).toContain('data-slot="aui_assistant-process-blocks"')
  })

  it('跑的时候展开：一眼看得见这一轮走了哪几步', function () {
    const html = render({ running: true })
    expect(html).toContain('Process · 2 steps')
    expect(html).toContain('思考一段一条')
  })

  it('结算后收起：整轮收成一行，子内容不再占版面', function () {
    const html = render({ running: false })
    expect(html).toContain('Process · 2 steps')
    expect(html).not.toContain('思考一段一条')
  })

  it('有结算时长才写行尾的秒数（没有就不留空尾巴）', function () {
    expect(render({ running: false, seconds: 5 })).toContain('Process · 2 steps · 5s')
    // 秒数由 AssistantMessage 在结算后才传进来；没传时不能出现「· s」这种半截尾巴
    expect(render({ running: true })).not.toMatch(/steps · \d+s/)
  })
})

/**
 * 收起后不能只剩「过程 · 2 步」：用户要能在不展开的情况下知道刚才走了哪几步。
 * 明细在**收起态**出现、展开后消失（展开由块级折叠条接管，同一信息不摆两遍）。
 */
describe('DefaultProcessGroup · 收起态的详细信息', function () {
  it('收起时列出逐步明细；清单列得全就不再重复报数', function () {
    const html = render({ running: false, summary })
    expect(html).toContain('data-slot="aui_assistant-process-outline"')
    expect(html).toContain('先看目录')
    expect(html).toContain('src/main.ts')
    // 5 条以内清单已经逐条列出工具与思考，头顶不再重复「N 步」「N 次工具」
    expect(html).not.toContain('2 tool calls · 1 thought')
    expect(html).not.toContain('2 steps')
  })

  it('清单列不全时才用构成行交代被折掉的总量', function () {
    const html = render({ running: false, summary: summaryTruncated })
    expect(html).toContain('3 more steps')
    expect(html).toContain('2 tool calls · 1 thought')
  })

  it('明细为空（只有没名字的工具）时保留「N 步」，不把收起行掏空', function () {
    const html = render({
      running: false,
      summary: { detail: undefined, lines: [], hidden: 0 }
    })
    expect(html).toContain('Process · 2 steps')
    expect(html).not.toContain('aui_assistant-process-outline')
  })

  it('展开后明细让位给块级卡片，不再重复摆一份', function () {
    const html = render({ running: true, summary: summaryRunning })
    expect(html).not.toContain('data-slot="aui_assistant-process-outline"')
    expect(html).toContain('思考一段一条')
    // 跑的时候折叠条那一格是「当前这一步」，不是构成行
    expect(html).toContain('Read · src/main.ts')
    expect(html).not.toContain('2 tool calls · 1 thought')
  })

  it('宿主不传 summary 时退回原来的一行，不报错也不留空壳', function () {
    const html = render({ running: false })
    expect(html).not.toContain('aui_assistant-process-outline')
    expect(html).toContain('Process · 2 steps')
  })

  it('等审批（attention）时不自动收起：允许 / 拒绝按钮不能被折叠藏起来', function () {
    const html = render({ running: false, attention: true })
    expect(html).toContain('思考一段一条')
    expect(html).not.toContain('aui_assistant-process-outline')
  })
})
