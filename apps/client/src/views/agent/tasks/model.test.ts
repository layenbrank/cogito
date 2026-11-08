import { describe, expect, it } from 'vitest'

import type { Automation, AutomationRun } from '@/shared/ipc/specs/automation'
import {
  OWNER,
  RUN_STATUS,
  buildTaskGroups,
  canRunNow,
  createDraft,
  filterRuns,
  findDraftProblem,
  findOwnerHint,
  findRunDuration,
  findTaskBadge,
  formatDuration,
  summarizeRuns,
  toDraft,
  toSaveInput
} from '@/views/agent/tasks/model'

function task(patch: Partial<Automation>): Automation {
  return {
    id: patch.id ?? 'task-1',
    name: '每日整理',
    prompt: '整理昨天的变更',
    knowledgeBaseId: null,
    workspaceId: null,
    approval: 'readonly',
    schedule: '0 9 * * *',
    timezone: 'Asia/Shanghai',
    enabled: true,
    owner: OWNER.CLIENT,
    runAsKind: 'user',
    runAsUserId: null,
    tenantId: null,
    remoteId: null,
    nextRunAt: 1_000,
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: 1,
    updatedAt: 1,
    ...patch
  }
}

function run(patch: Partial<AutomationRun>): AutomationRun {
  return {
    id: patch.id ?? 'run-1',
    automationId: 'task-1',
    scheduledFor: 1_000,
    triggerKind: '018',
    runAsKind: 'user',
    runAsUserId: null,
    startedAt: 1_000,
    finishedAt: 2_500,
    status: RUN_STATUS.SUCCEEDED,
    output: null,
    error: null,
    createdAt: 1_000,
    ...patch
  }
}

describe('buildTaskGroups', function () {
  it('按本机 → goose → 服务端分组，空组不出现', function () {
    const groups = buildTaskGroups(
      [task({ id: 'c1' }), task({ id: 'g1', owner: OWNER.GOOSE })],
      [task({ id: 'r1', owner: OWNER.CLOUD })]
    )
    expect(
      groups.map(function (group) {
        return group.owner
      })
    ).toEqual([OWNER.CLIENT, OWNER.GOOSE, OWNER.CLOUD])
  })

  it('组内按下次触发时间从近到远；有排期的排在没排期的前面，再按名称', function () {
    const groups = buildTaskGroups(
      [
        task({ id: 'late', name: 'B', nextRunAt: 3_000 }),
        task({ id: 'soon', name: 'C', nextRunAt: 2_000 }),
        task({ id: 'off', name: 'A', enabled: false, nextRunAt: null }),
        task({ id: 'none', name: 'D', nextRunAt: null })
      ],
      []
    )
    expect(
      groups[0].items.map(function (item) {
        return item.id
      })
    ).toEqual(['soon', 'late', 'off', 'none'])
  })

  it('未知 owner 归到末组，不会被丢掉', function () {
    const groups = buildTaskGroups([task({ id: 'x', owner: '099' })], [])
    expect(groups[0].owner).toBe('other')
    expect(groups[0].items).toHaveLength(1)
  })
})

describe('findTaskBadge', function () {
  it('执行中优先于停用与上次结果', function () {
    expect(findTaskBadge(task({ enabled: false, lastStatus: RUN_STATUS.FAILED }), true).tone).toBe(
      'running'
    )
    expect(findTaskBadge(task({ enabled: false }), false).tone).toBe('off')
    expect(findTaskBadge(task({ lastStatus: RUN_STATUS.SUCCEEDED }), false).tone).toBe('ok')
    expect(findTaskBadge(task({ lastStatus: RUN_STATUS.FAILED }), false)).toEqual({
      tone: 'fail',
      label: '失败'
    })
    expect(findTaskBadge(task({}), false).label).toBe('未执行')
  })
})

describe('canRunNow / findOwnerHint', function () {
  it('服务端任务不能手动触发，并且要说明原因', function () {
    expect(canRunNow(task({ owner: OWNER.CLOUD }))).toBe(false)
    expect(canRunNow(task({ owner: OWNER.CLIENT }))).toBe(true)
    expect(findOwnerHint(OWNER.CLIENT)).toContain('关掉应用')
    expect(findOwnerHint(OWNER.CLOUD)).toContain('关掉客户端')
  })
})

describe('filterRuns', function () {
  const runs = [
    run({ id: 'a', status: RUN_STATUS.SUCCEEDED }),
    run({ id: 'b', status: RUN_STATUS.FAILED }),
    run({ id: 'c', status: RUN_STATUS.RUNNING })
  ]

  it('按状态筛选，all 原样返回', function () {
    expect(filterRuns(runs, 'all')).toHaveLength(3)
    expect(
      filterRuns(runs, 'failed').map(function (item) {
        return item.id
      })
    ).toEqual(['b'])
    expect(filterRuns(runs, 'running')).toHaveLength(1)
    expect(filterRuns(runs, 'succeeded')).toHaveLength(1)
  })
})

describe('耗时与汇总', function () {
  it('没跑完就没有耗时', function () {
    expect(findRunDuration(run({ finishedAt: null }))).toBeNull()
    expect(findRunDuration(run({ finishedAt: 2_500 }))).toBe(1_500)
    // 时钟回拨时不显示负数
    expect(findRunDuration(run({ startedAt: 5_000, finishedAt: 4_000 }))).toBeNull()
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(400)).toBe('400 毫秒')
    expect(formatDuration(42_000)).toBe('42 秒')
    expect(formatDuration(180_000)).toBe('3 分')
    expect(formatDuration(125_000)).toBe('2 分 5 秒')
  })

  it('汇总统计失败数与最近一次时间', function () {
    const summary = summarizeRuns([
      run({ id: 'a', status: RUN_STATUS.FAILED, startedAt: 1_000 }),
      run({ id: 'b', status: RUN_STATUS.SUCCEEDED, startedAt: 9_000 }),
      run({ id: 'c', startedAt: null, createdAt: 5_000 })
    ])
    expect(summary).toEqual({ total: 3, failed: 1, lastAt: 9_000 })
  })
})

describe('草稿与保存入参', function () {
  it('toDraft 把服务端任务还原成只读草稿', function () {
    const draft = toDraft(task({ id: 'x', approval: 'auto', workspaceId: 'ws-1' }))
    expect(draft).toMatchObject({
      id: 'x',
      approval: 'auto',
      workspaceId: 'ws-1',
      owner: OWNER.CLIENT
    })
    // 非法取值回落只读，不会把未知档位写回界面
    expect(toDraft(task({ approval: 'ask' })).approval).toBe('readonly')
  })

  it('新建草稿默认只读、不指定工作目录', function () {
    const draft = createDraft(OWNER.CLIENT)
    expect(draft).toMatchObject({ id: null, approval: 'readonly', workspaceId: null })
    expect(findDraftProblem(draft)).not.toBeNull()
  })

  it('自动批准必须有工作目录（与服务端 toSave 同一条规则）', function () {
    const draft = { ...createDraft(OWNER.CLIENT), name: 'A', prompt: 'B' }
    expect(findDraftProblem(draft)).toBeNull()
    const auto = { ...draft, approval: 'auto' as const }
    expect(findDraftProblem(auto)).toContain('工作目录')
    expect(findDraftProblem({ ...auto, workspaceId: 'ws-1' })).toBeNull()
  })

  it('保存入参去空格并补默认时区', function () {
    const input = toSaveInput({
      ...createDraft(OWNER.CLIENT),
      name: '  整理  ',
      prompt: '  写报告 ',
      timezone: '  '
    })
    expect(input.name).toBe('整理')
    expect(input.prompt).toBe('写报告')
    expect(input.timezone).toBe('Asia/Shanghai')
    expect(input.id).toBeUndefined()
  })

  it('未知 owner 收窄回本机，不会把脏值写进契约', function () {
    const input = toSaveInput({ ...createDraft(OWNER.CLIENT), owner: 'zzz' })
    expect(input.owner).toBe(OWNER.CLIENT)
    expect(toSaveInput(createDraft(OWNER.CLOUD)).owner).toBe(OWNER.CLOUD)
  })
})
