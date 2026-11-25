import { describe, expect, it } from 'vitest'

import { toAgentHandoff } from '@/views/agent/chat/components/tool-card-subagent'
import { toSubagentRoster } from '@/views/agent/chat/components/agent-run-summary'

describe('toAgentHandoff', function () {
  it('从 spawn 入参 + 任务板结果拼出交接卡', function () {
    const model = toAgentHandoff(
      { prompt: '把 README 的安装段落补齐\n并跑一次构建', title: '补文档', cwd: 'D:/repo' },
      { jobID: 'job-1', status: 'running' },
      { settled: false }
    )

    expect(model).not.toBeNull()
    expect(model?.to).toBe('补文档')
    expect(model?.reason).toContain('把 README 的安装段落补齐')
    expect(model?.carried).toEqual(['工作目录 D:/repo', '任务 job-1'])
    expect(model?.settled).toBe(false)
    expect(model?.from).toBe('主 agent')
  })

  it('没有 title 时用 prompt 首行当标题，落定后 settled 为真', function () {
    const model = toAgentHandoff(
      { prompt: '检查依赖版本' },
      { jobID: 'job-2', status: 'done' },
      { settled: true, from: '实施 agent' }
    )
    expect(model?.to).toBe('检查依赖版本')
    expect(model?.settled).toBe(true)
    expect(model?.from).toBe('实施 agent')
  })

  it('空入参不产出卡片', function () {
    expect(toAgentHandoff({}, undefined, { settled: false })).toBeNull()
  })
})

describe('toSubagentRoster', function () {
  it('已落定的排前面，completedCount 与进度对齐', function () {
    const roster = toSubagentRoster([
      { type: 'text' },
      {
        type: 'tool-call',
        toolName: 'cogito_agent_spawn',
        args: { title: '跑测试' },
        status: { type: 'running' }
      },
      {
        type: 'tool-call',
        toolName: 'cogito_agent_spawn',
        args: { title: '查依赖' },
        status: { type: 'complete' }
      }
    ])

    expect(roster?.agents.map((agent) => agent.name)).toEqual(['查依赖', '跑测试'])
    expect(roster?.completedCount).toBe(1)
    expect(roster?.progress).toEqual([100, 0])
  })

  it('非 spawn 的 agent 工具（wait/result）不进名册', function () {
    const roster = toSubagentRoster([
      { type: 'tool-call', toolName: 'cogito_agent_wait', args: { jobID: 'job-1' } },
      { type: 'tool-call', toolName: 'cogito_agent_result', args: { jobID: 'job-1' } }
    ])
    expect(roster).toBeNull()
  })

  it('没有派发时返回 null', function () {
    expect(toSubagentRoster([{ type: 'text' }])).toBeNull()
  })
})
