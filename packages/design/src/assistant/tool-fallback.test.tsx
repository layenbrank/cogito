import type { ToolCallMessagePartStatus } from '@assistant-ui/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AssistantLabelsProvider } from './labels'
import {
  TOOL_TRIGGER_ROW_CLASS,
  ToolFallbackError,
  ToolFallbackResult,
  ToolFallbackRoot,
  toolTriggerClassName
} from './tool-fallback.aui'

/**
 * 工具卡的可见文案必须走 labels：宿主换语言时不该还剩半句英文。
 * 这里覆盖能独立渲染的几块（`Trigger` 的元素依赖 assistant-ui 的 tool-call 上下文，
 * 渲染交给 app 侧集成测试；它的**行高口径**是纯函数，在这里锁）。
 */
describe('ToolFallback 文案', function () {
  it('结果表头默认英文', function () {
    const html = renderToStaticMarkup(<ToolFallbackResult result="ok" />)
    expect(html).toContain('Result:')
  })

  it('宿主可以把结果表头换成中文', function () {
    const html = renderToStaticMarkup(
      <AssistantLabelsProvider labels={{ toolResult: '结果：' }}>
        <ToolFallbackResult result="ok" />
      </AssistantLabelsProvider>
    )
    expect(html).toContain('结果：')
    expect(html).not.toContain('Result:')
  })

  it('没有结果时不渲染空壳', function () {
    expect(renderToStaticMarkup(<ToolFallbackResult />)).toBe('')
  })

  it('失败用 toolError、取消用 toolCancelledReason', function () {
    const failed = renderToStaticMarkup(
      <ToolFallbackError
        status={{ type: 'incomplete', reason: 'error', error: 'boom' } as ToolCallMessagePartStatus}
      />
    )
    expect(failed).toContain('Error:')
    expect(failed).toContain('boom')

    const cancelled = renderToStaticMarkup(
      <AssistantLabelsProvider labels={{ toolCancelledReason: '取消原因：' }}>
        <ToolFallbackError
          status={{ type: 'incomplete', reason: 'cancelled', error: '用户取消' } as ToolCallMessagePartStatus}
        />
      </AssistantLabelsProvider>
    )
    expect(cancelled).toContain('取消原因：')
    expect(cancelled).toContain('用户取消')
  })

  it('跑着的工具不渲染错误块', function () {
    const html = renderToStaticMarkup(
      <ToolFallbackError status={{ type: 'running' } as ToolCallMessagePartStatus} />
    )
    expect(html).toBe('')
  })

  it('外壳只画插槽，不自己产出文案', function () {
    const html = renderToStaticMarkup(
      <ToolFallbackRoot defaultOpen>
        <span>body</span>
      </ToolFallbackRoot>
    )
    expect(html).toContain('data-slot="tool-fallback-root"')
    expect(html).toContain('body')
  })

  it('折叠行高度是常数：所有状态同一行高，不靠 padding 凑', function () {
    // 一次回答几十行工具调用，行高只要有一行不同就会显得排版坏了
    expect(TOOL_TRIGGER_ROW_CLASS).toBe('h-7')
    const base = toolTriggerClassName()
    expect(base).toContain('h-7')
    expect(base).toContain('items-center')
    // 旧的 py-1.5 + 行高会把高度算成 32px，也不再是常数
    expect(base).not.toContain('py-1.5')
    expect(base).not.toMatch(/\bpy-\d/)
  })

  it('宿主追加 className 不会顶掉固定行高', function () {
    const merged = toolTriggerClassName('w-full')
    expect(merged).toContain('h-7')
    expect(merged).toContain('w-full')
  })
})
