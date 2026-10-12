import type { Step } from '@/views/directive/model/types.ts'

/**
 * 步骤的四种控制流（动作之外）与它们的骨架。
 *
 * 骨架只给 corex 认得了的最小形状：新增一个空分支/空循环也要能画出来，
 * 剩下的交给编辑器里的表单填。
 */
const CONTROL_KINDS = ['if', 'repeat', 'parallel', 'steps'] as const

type ControlKind = (typeof CONTROL_KINDS)[number]

const STEP_KINDS = ['action', ...CONTROL_KINDS] as const

type StepKind = (typeof STEP_KINDS)[number]

/** 列表身份：只给 React key，不落盘、不给用户改 */
function nextToken(): string {
  return crypto.randomUUID()
}

function mapSteps(steps: Step[], map: (step: Step) => Step): Step[] {
  let changed = false
  const next = steps.map(function (step) {
    const mapped = map(step)
    if (mapped !== step) changed = true
    return mapped
  })
  return changed ? next : steps
}

/** 只动子步骤数组；动作步骤没有子树 */
function mapChildren(step: Step, map: (steps: Step[]) => Step[]): Step {
  if ('action' in step) return step
  if ('if' in step) {
    const then = map(step.then)
    const elses = step.else ? map(step.else) : undefined
    if (then === step.then && elses === step.else) return step
    return elses === undefined ? { ...step, then } : { ...step, then, else: elses }
  }
  if ('parallel' in step) {
    const parallel = map(step.parallel)
    return parallel === step.parallel ? step : { ...step, parallel }
  }
  const steps = map(step.steps)
  return steps === step.steps ? step : { ...step, steps }
}

function assignTokens(step: Step, keep: boolean): Step {
  const token = keep && step.token ? step.token : nextToken()
  const stamped = step.token === token ? step : { ...step, token }
  return mapChildren(stamped, function (steps) {
    return mapSteps(steps, function (child) {
      return assignTokens(child, keep)
    })
  })
}

/** 读盘 / 已有草稿：缺 token 才补，已有的保持不变 */
function stampSteps(steps: Step[]): Step[] {
  return mapSteps(steps, function (step) {
    return assignTokens(step, true)
  })
}

function stripToken(step: Step): Step {
  const next = { ...step }
  delete next.token
  return mapChildren(next, function (steps) {
    return steps.map(stripToken)
  })
}

/** 落盘前剥掉 token，避免写进 corex YAML */
function sanitizeSteps(steps: Step[]): Step[] {
  return steps.map(stripToken)
}

function replaceStep(steps: Step[], token: string, next: Step): Step[] {
  return mapSteps(steps, function (step) {
    if (step.token === token) return next
    return mapChildren(step, function (children) {
      return replaceStep(children, token, next)
    })
  })
}

function removeStep(steps: Step[], token: string): Step[] {
  const filtered = steps.filter(function (step) {
    return step.token !== token
  })
  if (filtered.length !== steps.length) return filtered
  return mapSteps(steps, function (step) {
    return mapChildren(step, function (children) {
      return removeStep(children, token)
    })
  })
}

function duplicateStep(steps: Step[], token: string): Step[] {
  const index = steps.findIndex(function (step) {
    return step.token === token
  })
  if (index >= 0) {
    const next = [...steps]
    next.splice(index + 1, 0, cloneStep(steps[index]))
    return next
  }
  return mapSteps(steps, function (step) {
    return mapChildren(step, function (children) {
      return duplicateStep(children, token)
    })
  })
}

function moveByToken(steps: Step[], token: string, delta: number): Step[] {
  const index = steps.findIndex(function (step) {
    return step.token === token
  })
  if (index >= 0) {
    const to = index + delta
    if (to < 0 || to >= steps.length) return steps
    return moveStep(steps, index, to)
  }
  return mapSteps(steps, function (step) {
    return mapChildren(step, function (children) {
      return moveByToken(children, token, delta)
    })
  })
}

/** 复制步骤：深拷贝、换 YAML id、整棵子树换新 token（避免和原行抢 React key） */
function cloneStep(step: Step): Step {
  const copy = structuredClone(step) as Step
  return assignTokens({ ...copy, id: `${step.id}-${crypto.randomUUID().slice(0, 4)}` }, false)
}

/** 把第 from 个步骤移动到 to（只动顺序，不改内容） */
function moveStep(steps: Step[], from: number, to: number): Step[] {
  const next = [...steps]
  const moved = next.splice(from, 1)[0]
  next.splice(to, 0, moved)
  return next
}

/** 动作 id 的短名：`file.write` → `write`，拿它给步骤 id 起头 */
function stepBase(actionID: string): string {
  const parts = actionID.split('.')
  return parts[parts.length - 1] || actionID
}

/**
 * 新步骤的 YAML id：`<短名>-<序号>`，序号取第一个还没被兄弟占用的。
 *
 * 不能用「兄弟数量 + 1」推：删掉中间一条再新增，推出来的号会撞上还活着的那条。
 */
function nextStepId(actionID: string, siblings: readonly Step[]): string {
  const base = stepBase(actionID)
  const taken = new Set(
    siblings.map(function (step) {
      return step.id
    })
  )
  let index = 1
  while (taken.has(`${base}-${index}`)) {
    index += 1
  }
  return `${base}-${index}`
}

/** 这条步骤现在是哪一种（判据与 StepNode 的分派一致，只此一份） */
function findStepKind(step: Step): StepKind {
  if ('action' in step) return 'action'
  if ('if' in step) return 'if'
  if ('repeat' in step) return 'repeat'
  if ('parallel' in step) return 'parallel'
  return 'steps'
}

/** 新控制流步骤的骨架；`repeat` 给一个 count 1，corex 的循环得二选一才跑得起来 */
function buildControlStep(kind: ControlKind, id: string, token?: string): Step {
  const mark = token ?? nextToken()
  if (kind === 'if') return { id, token: mark, if: '', then: [] }
  if (kind === 'repeat') return { id, token: mark, repeat: { count: 1 }, steps: [] }
  if (kind === 'parallel') return { id, token: mark, parallel: [] }
  return { id, token: mark, steps: [] }
}

/**
 * 这一步装的子步骤。换类型时只搬两边都说得通的那些 ——
 * 循序块 / 循环都有 `steps`，条件分支的 `then`、并行的分支数组也都是「一串步骤」，
 * 语义相通；换掉的只是外层怎么走。动作的参数没人接，只能丢。
 */
function childStepsOf(step: Step): Step[] {
  if ('action' in step) return []
  if ('if' in step) return [...step.then, ...(step.else ?? [])]
  if ('parallel' in step) return step.parallel
  return step.steps
}

/**
 * 换一种步骤类型（原地重建）。
 *
 * YAML `id` 与列表 `token` 都留着：换类型不该让输入框卸掉，也不该改用户填的别名。
 * 换成动作要一份动作目录才能填 `action`，所以那一路由 step-node 自己走 `buildStep`。
 */
function switchStepKind(step: Step, kind: ControlKind): Step {
  if (findStepKind(step) === kind) return step

  const next = buildControlStep(kind, step.id ?? '', step.token)
  const children = childStepsOf(step)
  if (children.length === 0) return next
  // 换成条件分支时整串进 then（不替用户编 else）；离开条件分支时 then+else 并进目标列表
  if ('if' in next) return { ...next, then: children }
  if ('parallel' in next) return { ...next, parallel: children }
  return { ...next, steps: children }
}

/**
 * 保存回来的模型没有 token：按兄弟位置把草稿上的列表身份贴回去，
 * 避免整棵步骤树换 key、输入框卸掉。对不上的节点再补新 token。
 */
function mergeTokens(prior: Step[], incoming: Step[]): Step[] {
  return incoming.map(function (step, index) {
    return mergeToken(findPrior(prior, step, index), step)
  })
}

/** 有 YAML id 就按 id 认人，避免保存后顺序微调把 token 贴到邻行 */
function findPrior(prior: Step[], incoming: Step, index: number): Step | undefined {
  if (incoming.id) {
    return prior.find(function (step) {
      return step.id === incoming.id && findStepKind(step) === findStepKind(incoming)
    })
  }
  const at = prior[index]
  if (at && findStepKind(at) === findStepKind(incoming)) return at
  return undefined
}

function mergeToken(prior: Step | undefined, incoming: Step): Step {
  const token = prior?.token || incoming.token || nextToken()
  const next = { ...incoming, token }
  if (!prior || findStepKind(prior) !== findStepKind(incoming)) {
    return assignTokens(next, true)
  }
  if ('if' in incoming && 'if' in prior) {
    return {
      ...next,
      then: mergeTokens(prior.then, incoming.then),
      ...(incoming.else !== undefined ? { else: mergeTokens(prior.else ?? [], incoming.else) } : {})
    }
  }
  if ('parallel' in incoming && 'parallel' in prior) {
    return { ...next, parallel: mergeTokens(prior.parallel, incoming.parallel) }
  }
  if ('steps' in incoming && 'steps' in prior) {
    return { ...next, steps: mergeTokens(prior.steps, incoming.steps) }
  }
  return next
}

export {
  CONTROL_KINDS,
  STEP_KINDS,
  buildControlStep,
  cloneStep,
  duplicateStep,
  childStepsOf,
  findStepKind,
  moveByToken,
  moveStep,
  nextStepId,
  mergeTokens,
  nextToken,
  removeStep,
  replaceStep,
  sanitizeSteps,
  stampSteps,
  switchStepKind
}
export type { ControlKind, StepKind }
