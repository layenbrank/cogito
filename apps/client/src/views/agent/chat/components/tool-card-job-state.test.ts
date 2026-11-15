import { describe, expect, it } from 'vitest'

import {
  JOB_COMMAND_THRESHOLD_MS,
  findCommandOutcome,
  findCommandStageIndex,
  isJobCommand
} from '@/views/agent/chat/components/tool-card-job-state'

describe('命令任务卡的判定', function () {
  it('后台命令：没有可预期结束点，直接升级成任务卡', function () {
    expect(isJobCommand(true, undefined)).toBe(true)
    expect(isJobCommand(true, 10)).toBe(true)
  })

  it('前台命令：不到 20s 还是终端条，到点才升级', function () {
    expect(isJobCommand(false, 0)).toBe(false)
    expect(isJobCommand(false, JOB_COMMAND_THRESHOLD_MS - 1)).toBe(false)
    expect(isJobCommand(false, JOB_COMMAND_THRESHOLD_MS)).toBe(true)
    expect(isJobCommand(false, JOB_COMMAND_THRESHOLD_MS * 3)).toBe(true)
  })

  it('耗时未知（测试 / 非运行时）不升级，避免把普通命令误判成长任务', function () {
    expect(isJobCommand(false, undefined)).toBe(false)
    expect(isJobCommand(false, Number.NaN)).toBe(false)
    expect(isJobCommand(false, Number.POSITIVE_INFINITY)).toBe(false)
  })
})

describe('命令任务卡的阶段与结局', function () {
  it('运行中停在第 0 段；结束就走到 stages.length（一段命令只有一段）', function () {
    expect(findCommandStageIndex(true)).toBe(0)
    expect(findCommandStageIndex(false)).toBe(1)
  })

  it('运行中 / 待确认没有收据；其余按活动状态分成功 / 失败 / 已中断', function () {
    expect(findCommandOutcome({ activity: 'running' })).toBeUndefined()
    expect(findCommandOutcome({ activity: 'waiting' })).toBeUndefined()
    expect(findCommandOutcome({ activity: 'done' })).toEqual({ status: 'success' })
    expect(findCommandOutcome({ activity: 'failed' })).toEqual({ status: 'failed' })
    // 被停掉的命令不是失败，也不能画成成功
    expect(findCommandOutcome({ activity: 'cancelled' })).toEqual({ status: 'cancelled' })
  })
})
