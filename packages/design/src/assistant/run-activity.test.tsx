/**
 * 折叠条文案 + 心跳点：整轮只剩一个短标签时（「思考」「调用 shell」），
 * 不动的字很容易被读成「会话已经终止 / 卡住了」。
 *
 * 这里锁两件事：
 * - running 一定有 `run-activity-pulse`（唯一的「还活着」信号）；
 * - 跑完之后不再有动效，只留结算文案，不去抢最终回答的注意力。
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ASSISTANT_LABELS_EN } from './labels'
import { RunActivity } from './run-activity'

describe('RunActivity 折叠条', function () {
  it('running 时有心跳点：文案再短也不会被读成「已经停了」', function () {
    const html = renderToStaticMarkup(
      <RunActivity
        status="running"
        statusLabel="思考中…"
      />
    )
    expect(html).toContain('data-slot="run-activity-pulse"')
    expect(html).toContain('思考中…')
  })

  it('跑完不再动：没有心跳点、没有 shimmer，只留结算时长', function () {
    const html = renderToStaticMarkup(
      <RunActivity
        status="complete"
        statusLabel="已工作"
        durationLabel="4.8s"
      />
    )
    expect(html).not.toContain('run-activity-pulse')
    expect(html).not.toContain('shimmer')
    expect(html).toContain('4.8s')
  })

  it('没有条目时只出一行状态，不渲染空折叠按钮', function () {
    const html = renderToStaticMarkup(
      <RunActivity
        status="running"
        statusLabel="思考中…"
      />
    )
    expect(html).toContain('data-slot="run-activity-status"')
    expect(html).not.toContain('run-activity-trigger')
  })

  it('完成态用过去时，和进行中的词不共用（否则只剩一个名词，像卡住了）', function () {
    expect(ASSISTANT_LABELS_EN.working).toBe('Thinking…')
    expect(ASSISTANT_LABELS_EN.reasoning()).toBe('Thought')
    expect(ASSISTANT_LABELS_EN.reasoning()).not.toContain('…')
    expect(ASSISTANT_LABELS_EN.reasoning(3)).toBe('Thought for 3s')
  })
})
