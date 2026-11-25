import type { ThreadMessage } from '@assistant-ui/react'
import { describe, expect, it } from 'vitest'

import { findPanelDraft, findPlanDraft, isPlanDocument, parsePlanText } from '@/features/agent/plan-draft'

/** 只需要 role + text part，其余字段与判定无关 */
function assistant(text: string): ThreadMessage {
  return { role: 'assistant', content: [{ type: 'text', text }] } as unknown as ThreadMessage
}

function user(text: string): ThreadMessage {
  return { role: 'user', content: [{ type: 'text', text }] } as unknown as ThreadMessage
}

describe('计划草稿抽取', function () {
  it('编号列表进 steps，正文原样保留', function () {
    const body = [
      '# 终端块折叠',
      '',
      '## 概述',
      '工具卡的终端改成默认折叠。',
      '',
      '## 实施步骤',
      '1. `tool-card-terminal-body` 加折叠',
      '2. 详情页列出正在运行的命令',
      '',
      '## 验证',
      '| 命令 | 断言 |',
      '| --- | --- |',
      '| tsc | 通过 |'
    ].join('\n')

    const draft = findPlanDraft([user('改一下终端'), assistant(body)])
    expect(draft?.title).toBe('终端块折叠')
    expect(draft?.overview).toBe('工具卡的终端改成默认折叠。')
    expect(draft?.steps).toEqual([
      'tool-card-terminal-body 加折叠',
      '详情页列出正在运行的命令'
    ])
    // 正文必须是全量：验证表格不能被裁掉
    expect(draft?.body).toContain('| tsc | 通过 |')
  })

  it('计划类标题下的普通项目符号也算步骤（清单不再落盘后模型常这么写）', function () {
    const body = [
      '# 审阅工作台',
      '',
      '## 实施步骤',
      '- 先补 upstream 读取',
      '- 再补 push 与远端分支',
      '- 最后收敛状态栏'
    ].join('\n')

    const draft = findPlanDraft([assistant(body)])
    expect(draft?.steps).toHaveLength(3)
  })

  it('没有计划类标题时，普通项目符号不当作计划（避免任何列表都被认成计划）', function () {
    const body = ['## 说明', '', '- 这是解释', '- 不是步骤'].join('\n')
    expect(findPlanDraft([assistant(body)])).toBeNull()
  })

  it('没有列表时不产出草稿，正文段不会被当成步骤', function () {
    const body = ['# 汇报', '', '一切都好，没有后续步骤。'].join('\n')
    expect(findPlanDraft([assistant(body)])).toBeNull()
  })

  it('取最后一条有正文的 assistant 消息', function () {
    const first = '# 旧计划\n\n## 实施步骤\n1. 旧步骤一\n2. 旧步骤二'
    const second = '# 新计划\n\n## 实施步骤\n1. 新步骤一\n2. 新步骤二'
    const draft = findPlanDraft([assistant(first), assistant(second)])
    expect(draft?.title).toBe('新计划')
  })
})

describe('计划文档判定（recorder 用）', function () {
  const skeleton = [
    '# 计划标题',
    '',
    '## 概述',
    '一段话总结。',
    '',
    '## 实施步骤',
    '1. 第一步',
    '2. 第二步'
  ].join('\n')

  it('普通问答不算计划文档', function () {
    const body = '这个函数在 `plan-draft.ts:89`，它从后往前找最后一条 assistant 正文。'
    expect(isPlanDocument(body)).toBe(false)
    expect(parsePlanText(body)).toBeNull()
  })

  it('带两个 bullet 的普通解释也不算（避免右栏挂假计划）', function () {
    const body = ['## 说明', '', '- 第一点解释', '- 第二点解释'].join('\n')
    expect(isPlanDocument(body)).toBe(false)
  })

  it('标准骨架为 true，steps 来自「实施步骤」', function () {
    expect(isPlanDocument(skeleton)).toBe(true)
    const draft = parsePlanText(skeleton)
    expect(draft?.title).toBe('计划标题')
    expect(draft?.steps).toEqual(['第一步', '第二步'])
    expect(draft?.body).toBe(skeleton)
  })

  it('只有一处「步骤」也算（模型没写 H1 时）', function () {
    const body = ['## 实施步骤', '1. 甲', '2. 乙'].join('\n')
    expect(isPlanDocument(body)).toBe(true)
  })
})

describe('右栏画布兜底（findPanelDraft）', function () {
  /** 没按模板写、但确实是一份方案的回复（> 200 字） */
  const loosePlan = [
    '## 方案：终端卡默认折叠',
    '',
    '终端输出默认折叠成一行摘要，点开才展开。折叠状态存在消息 part 里，不写回数据库。',
    '工具卡头部显示命令与耗时，展开后保留原来的滚动行为与 ANSI 清洗逻辑。',
    '正在运行的命令继续在右栏详情页列出，停止按钮只在该命令仍在跑时出现。',
    '这次改动只动渲染层，agentd 的事件协议与审批链路保持不变，避免与后台回合冲突。',
    '风险是折叠后用户看不到报错，所以失败的命令自动展开，并在头部标红。'
  ].join('\n')

  /** 带「发送那一刻模式快照」的用户消息（真实链路里由 `stampUserModeSnapshot` 写入） */
  function userInMode(text: string, mode: 'plan' | 'agent' | 'ask' | 'goal'): ThreadMessage {
    return {
      role: 'user',
      content: [{ type: 'text', text }],
      metadata: { custom: { modeSnapshot: { mode, at: 1 } } }
    } as unknown as ThreadMessage
  }

  it('计划轮没命中骨架的长方案也算可执行草稿（否则右栏没有「开始执行」）', function () {
    expect(isPlanDocument(loosePlan)).toBe(false)
    const draft = findPanelDraft([userInMode('出个方案', 'plan'), assistant(loosePlan)])
    expect(draft?.body).toBe(loosePlan)
    expect(draft?.overview.length).toBeGreaterThan(0)
  })

  it('随手聊完再切到计划模式，旧回答不算计划（判定认该轮快照，不认当前档位）', function () {
    expect(findPanelDraft([userInMode('随便聊聊', 'agent'), assistant(loosePlan)])).toBeNull()
  })

  it('计划轮里的短问答也不当计划（用长度挡住）', function () {
    const short = '这个文件负责\n\n把正文解析成计划草稿，没有列表时返回 null。'
    expect(findPanelDraft([userInMode('这是什么', 'plan'), assistant(short)])).toBeNull()
  })

  it('命中骨架时按骨架抽 steps（与轮次模式无关）', function () {
    const body = ['# 计划标题', '', '## 实施步骤', '1. 第一步', '2. 第二步'].join('\n')
    expect(findPanelDraft([userInMode('出个计划', 'plan'), assistant(body)])?.steps).toEqual([
      '第一步',
      '第二步'
    ])
    expect(findPanelDraft([userInMode('顺手写个计划', 'agent'), assistant(body)])?.steps).toHaveLength(
      2
    )
  })

  it('没有模式快照的老数据：不猜，只认骨架', function () {
    expect(findPanelDraft([user('随便聊聊'), assistant(loosePlan)])).toBeNull()
  })
})
