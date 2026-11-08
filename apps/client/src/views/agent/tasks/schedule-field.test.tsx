/**
 * 时间定义面板：只盯「面板上的选择 → 交出去的表达式」这条线。
 *
 * 纯逻辑在 `features/automation/schedule-config.test.ts` 里测过；这里验的是界面真的把
 * 「最后一天 / 工作日 / 周末」摆出来了、点了会改写表达式（不用人肉点一遍）。
 */
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ScheduleField } from './schedule-field'

describe('ScheduleField · 每月', function () {
  it('把 L 还原成「最后一天」，并说清它是按日历落的', function () {
    render(
      <ScheduleField
        value='0 9 L * *'
        onChange={function () {}}
      />
    )
    // 下拉显示的是人话而不是内部值
    expect(screen.getByLabelText('每月哪一天')).toHaveTextContent('最后一天')
    // 下方人话 + 日历解释都在
    expect(screen.getByText(/每月最后一天 09:00/)).toBeInTheDocument()
    expect(screen.getByText(/2 月 28\/29 日/)).toBeInTheDocument()
  })

  it('选了 29–31 号才提示小月会跳过', function () {
    render(
      <ScheduleField
        value='0 9 31 * *'
        onChange={function () {}}
      />
    )
    expect(screen.getByLabelText('每月哪一天')).toHaveTextContent('31 号')
    expect(screen.getByText(/小月没有 31 号/)).toBeInTheDocument()
  })
})

describe('ScheduleField · 每周', function () {
  it('「工作日 / 周末」一键改表达式', function () {
    const onChange = vi.fn()
    render(
      <ScheduleField
        value='0 9 * * 1'
        onChange={onChange}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '工作日' }))
    expect(onChange).toHaveBeenLastCalledWith('0 9 * * 1-5')
    fireEvent.click(screen.getByRole('button', { name: '周末' }))
    expect(onChange).toHaveBeenLastCalledWith('0 9 * * 6,0')
  })

  it('已经是 1-5 时「工作日」显示为选中', function () {
    render(
      <ScheduleField
        value='0 9 * * 1-5'
        onChange={function () {}}
      />
    )
    expect(screen.getByRole('button', { name: '工作日' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: '周末' })).toHaveAttribute('aria-pressed', 'false')
  })
})
