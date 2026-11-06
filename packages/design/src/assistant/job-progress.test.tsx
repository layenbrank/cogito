import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { JobProgress } from './job-progress'
import type { JobStage } from './job-progress-state'

const STAGES: readonly JobStage[] = [
  { name: 'clone', weight: 1, description: 'Fetching the branch' },
  { name: 'install', weight: 4, description: 'Restoring dependencies' },
  { name: 'build', weight: 3 },
  { name: 'test', weight: 2 }
]

function markup(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <JobProgress
      title="Verify the fix on CI"
      stages={STAGES}
      stageIndex={1}
      stageProgress={0.6}
      eta="about 3 min"
      {...props}
    />
  )
}

const RECEIPT = {
  stageIndex: 3,
  stageProgress: 0.4,
  outcome: {
    status: 'partial' as const,
    summary: 'Build passed. Tests stopped after the preview timed out.'
  },
  elapsedMs: 72_000
}

describe('JobProgress', function () {
  it('抬头是标题 + 运行中的 ETA', function () {
    const html = markup()
    expect(html).toContain('data-slot="job-progress"')
    expect(html).toContain('data-state="running"')
    expect(html).toContain('Verify the fix on CI')
    expect(html).toContain('about 3 min')
  })

  it('进度条按权重加权，读数与宽度一致', function () {
    const html = markup()
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-label="Verify the fix on CI progress"')
    expect(html).toContain('aria-valuenow="34"')
    expect(html).toContain('width:34%')
  })

  it('eta 没给时退回「运行中」', function () {
    expect(markup({ eta: '' })).toContain('running')
  })

  it('每个阶段一个等宽标签，当前阶段带说明', function () {
    const html = markup()
    expect(html.split('data-slot="job-progress-stage"').length - 1).toBe(4)
    expect(html).toContain('data-status="done"')
    expect(html).toContain('data-status="active"')
    expect(html).toContain('data-status="ahead"')
    expect(html).toContain('Restoring dependencies')
    // 不是当前阶段的那行说明不出现
    expect(html).not.toContain('Fetching the branch')
  })

  it('读屏播报当前阶段', function () {
    const html = markup()
    expect(html).toContain('role="status"')
    expect(html).toContain('Stage install')
  })

  it('运行中给了 onCancel 才出现取消按钮', function () {
    expect(markup()).not.toContain('Cancel the job')
    const html = markup({ onCancel: vi.fn() })
    expect(html).toContain('aria-label="Cancel the job"')
  })

  it('partial 收据：琥珀条停在 88%，耗时变成 <time>，summary 与读屏结论都在', function () {
    const html = markup({ ...RECEIPT, onCancel: vi.fn() })
    expect(html).toContain('data-state="partial"')
    expect(html).toContain('aria-valuenow="88"')
    expect(html).toContain('width:88%')
    expect(html).toContain('bg-warning')
    // React 19 的 SSR 会把 `dateTime` 原样写成 camelCase（HTML 属性名不区分大小写）
    expect(html).toMatch(/<time[^>]*dateTime="PT72S"[^>]*>1m 12s<\/time>/i)
    expect(html).toContain('Build passed. Tests stopped after the preview timed out.')
    expect(html).toContain('Job partly done')
    // 收据态一律没有取消按钮，ETA 槽换成耗时
    expect(html).not.toContain('Cancel the job')
    expect(html).not.toContain('about 3 min')
  })

  it('收据没有耗时就退回状态词', function () {
    const html = markup({ ...RECEIPT, elapsedMs: undefined })
    expect(html).toContain('partly done')
    expect(html).not.toContain('<time')
  })

  it('success 收据：条拉满、绿色、词是 done', function () {
    const html = markup({ stageIndex: 4, stageProgress: 0, outcome: { status: 'success' } })
    expect(html).toContain('data-state="success"')
    expect(html).toContain('aria-valuenow="100"')
    expect(html).toContain('bg-success')
    expect(html).toContain('Job done')
  })

  it('没有 outcome 但索引走到长度：也算成功跑完', function () {
    const html = markup({ stageIndex: 4, stageProgress: 0, eta: 'finishing' })
    expect(html).toContain('data-state="success"')
    expect(html).toContain('aria-valuenow="100"')
    expect(html).toContain('done')
  })

  it('cancelled：灰色条 + 读屏说 Job cancelled', function () {
    const html = markup({ stageIndex: 0, stageProgress: 0, outcome: { status: 'cancelled' } })
    expect(html).toContain('data-state="cancelled"')
    expect(html).toContain('bg-muted-foreground')
    expect(html).toContain('aria-valuenow="0"')
    expect(html).toContain('Job cancelled')
  })

  it('空阶段表：没有阶段标签，也不假装跑完', function () {
    const html = markup({ stages: [], stageIndex: 0, stageProgress: 0 })
    expect(html).toContain('data-state="running"')
    expect(html).toContain('aria-valuenow="0"')
    expect(html.split('data-slot="job-progress-stage"').length - 1).toBe(0)
  })
})
