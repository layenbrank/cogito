import { TooltipProvider } from '@i-thinking/design/components/tooltip'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { DirectiveEntry } from '@/shared/ipc/specs/sidecar'
import { EMPTY_RUNS } from '@/views/directive/run/run-status'

import Card from './card.tsx'

/** 不带 cron / watch，免得挂载时去对账守护状态 */
const entry: DirectiveEntry = {
  name: 'nightly',
  folder: null,
  source: null,
  visible: true,
  updated_at_ms: 0,
  bucket: null,
  summary: {
    description: '每晚备份',
    step_count: 2,
    input_count: 1,
    trigger_count: 0,
    has_cron: false,
    has_watch: false
  }
}

function setup() {
  const onOpen = vi.fn()
  const onRun = vi.fn()
  const onDelete = vi.fn()

  const view = render(
    <TooltipProvider>
      <Card
        entry={entry}
        isActive={false}
        runs={EMPTY_RUNS}
        stepCount={2}
        now={0}
        onOpen={onOpen}
        onRun={onRun}
        onDelete={onDelete}
      />
    </TooltipProvider>
  )

  // 卡片根：正文只盖住其中一部分，空白处（内边距）落在根上
  const root = view.container.firstElementChild
  if (!(root instanceof HTMLElement)) throw new Error('卡片根节点没渲染出来')

  return { onOpen, onRun, onDelete, root }
}

describe('Card', function () {
  it('点正文就打开编排台', function () {
    const { onOpen } = setup()

    fireEvent.click(screen.getByText('每晚备份'))

    expect(onOpen).toHaveBeenCalledWith('nightly')
  })

  /**
   * 卡片空白处必须由根节点接住。
   *
   * 教训：曾经在根上叠过一个 `absolute inset-0` 的透明按钮来接管点击，结果它和
   * 根上原有的（无 onClick 的）焦点按钮同层，后写的把先写的盖死 —— 整张卡就点不开了。
   */
  it('点卡片空白处也能打开编排台', function () {
    const { onOpen, root } = setup()

    fireEvent.click(root)

    expect(onOpen).toHaveBeenCalledWith('nightly')
  })

  it('点运行只跑这一条，不顺带进编排台', function () {
    const { onOpen, onRun } = setup()

    fireEvent.click(screen.getByRole('button', { name: '运行 nightly' }))

    expect(onRun).toHaveBeenCalledWith('nightly')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('点删除只删这一条，不顺带进编排台', function () {
    const { onOpen, onDelete } = setup()

    fireEvent.click(screen.getByRole('button', { name: '删除 nightly' }))

    expect(onDelete).toHaveBeenCalledWith('nightly')
    expect(onOpen).not.toHaveBeenCalled()
  })
})
