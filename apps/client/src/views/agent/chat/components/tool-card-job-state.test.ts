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

  it('运行中没有收据，结束时才按 isError 分出成功 / 失败', function () {
    expect(findCommandOutcome({ isRunning: true, isError: false })).toBeUndefined()
    expect(findCommandOutcome({ isRunning: false, isError: false })).toEqual({ status: 'success' })
    expect(findCommandOutcome({ isRunning: false, isError: true })).toEqual({ status: 'failed' })
  })
})
