import { describe, expect, it } from 'vitest'

import { EVENTS } from '@/shared/ipc/channels'
import {
  GOOSE_STATUS_EVENT,
  GooseStatusSchema
} from '@/shared/ipc/specs/gooseStatus'

describe('goose 就绪状态契约', function () {
  it('事件名与 channels 单源', function () {
    expect(GOOSE_STATUS_EVENT).toBe(EVENTS.GOOSE_STATUS)
    expect(GOOSE_STATUS_EVENT).toBe('goose://status')
  })

  it('接受 ready 相位（带就绪耗时与 RSS 基线）', function () {
    const parsed = GooseStatusSchema.parse({
      state: 'ready',
      readyMs: 1234,
      rssBytes: 512 * 1024 * 1024,
      gooseRssBytes: 96 * 1024 * 1024
    })
    expect(parsed.state).toBe('ready')
    expect(parsed.readyMs).toBe(1234)
    expect(parsed.gooseRssBytes).toBe(96 * 1024 * 1024)
  })

  it('接受 starting / failed，failed 可带 reason', function () {
    expect(GooseStatusSchema.parse({ state: 'starting' }).state).toBe('starting')
    const failed = GooseStatusSchema.parse({
      state: 'failed',
      reason: 'goose serve 启动失败: 端口被占'
    })
    expect(failed.reason).toContain('端口')
  })

  it('拒绝未知相位与负数指标', function () {
    expect(GooseStatusSchema.safeParse({ state: 'readying' }).success).toBe(false)
    expect(GooseStatusSchema.safeParse({ state: 'ready', readyMs: -1 }).success).toBe(false)
  })
})
