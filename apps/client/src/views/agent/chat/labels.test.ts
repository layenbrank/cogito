/**
 * 思考折叠条的**完成态**文案。
 *
 * 回归点：这一行曾经在跑完之后只写「思考」两个字 —— 光秃秃的名词摆在折叠条上，
 * 读者分不清是跑完了还是卡住了（用户反馈：整轮只剩「思考」两字，像会话已终止）。
 * 所以完成态必须带完成标记，并且和进行中的「思考中…」不共用词。
 */
import { describe, expect, it } from 'vitest'

import { ASSISTANT_LABELS_ZH } from './labels'

describe('思考折叠条文案', function () {
  it('进行中与完成态不共用词', function () {
    expect(ASSISTANT_LABELS_ZH.working).toBe('思考中…')
    expect(ASSISTANT_LABELS_ZH.reasoning?.()).toBe('已思考')
  })

  it('有时长就带上秒数，仍然不带「中」', function () {
    expect(ASSISTANT_LABELS_ZH.reasoning?.(3)).toBe('已思考 3 秒')
    expect(ASSISTANT_LABELS_ZH.reasoning?.(3)).not.toContain('中')
  })
})
