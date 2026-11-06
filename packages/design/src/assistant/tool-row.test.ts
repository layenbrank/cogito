/**
 * 折叠行高度是**一个常数**，不是「padding + 行高凑出来的」。
 *
 * 这里的用例锁的是「唯一源」本身：三处折叠行（ToolFallback.Trigger / 命令卡 / CodeDiff
 * 标题栏）都引用 `TOOL_ROW_HEIGHT_CLASS`，所以只要这个常量不被改成 `py-*` 之类，
 * 一次回答里几十张工具卡的行高就齐。
 */
import { describe, expect, it } from 'vitest'

import { TOOL_ROW_HEIGHT_CLASS, TOOL_ROW_HEIGHT_PX } from './tool-row'

describe('工具行高度口径', function () {
  it('折叠行是 28px 的常数（h-7），不是 padding 凑出来的', function () {
    expect(TOOL_ROW_HEIGHT_CLASS).toBe('h-7')
    expect(TOOL_ROW_HEIGHT_PX).toBe(28)
    expect(TOOL_ROW_HEIGHT_CLASS).not.toMatch(/\bpy-\d/)
  })
})
