import { describe, expect, it } from 'vitest'

import {
  buildControlStep,
  cloneStep,
  duplicateStep,
  findStepKind,
  mergeTokens,
  moveByToken,
  moveStep,
  nextStepId,
  replaceStep,
  removeStep,
  sanitizeSteps,
  stampSteps,
  switchStepKind
} from '@/views/directive/model/step-utils.ts'
import type { Step } from '@/views/directive/model/types.ts'

/**
 * YAML 步骤 id 不能和兄弟撞车；列表身份是 token，和可编辑的 id 分开。
 */

function actionStep(id: string, token?: string): Step {
  return token ? { id, token, action: 'shell.run' } : { id, action: 'shell.run' }
}

function idsOf(steps: Step[]): (string | undefined)[] {
  return steps.map(function (step) {
    return step.id
  })
}

describe('nextStepId', function () {
  it('starts at one and takes the short name of the action', function () {
    expect(nextStepId('file.write', [])).toBe('write-1')
    expect(nextStepId('shell.run', [])).toBe('run-1')
    expect(nextStepId('scan', [])).toBe('scan-1')
  })

  it('fills the hole a deleted step left instead of colliding', function () {
    const steps = [actionStep('run-1'), actionStep('run-3')]
    expect(nextStepId('shell.run', steps)).toBe('run-2')
  })

  it('keeps counting when the numbers in use are consecutive', function () {
    const steps = [actionStep('run-1'), actionStep('run-2')]
    expect(nextStepId('shell.run', steps)).toBe('run-3')
  })

  it('ignores ids belonging to other actions', function () {
    expect(nextStepId('shell.run', [actionStep('write-1')])).toBe('run-1')
  })
})

describe('cloneStep', function () {
  it('copies the content and gives the copy its own id and token', function () {
    const source = { id: 'run-1', token: 't-a', action: 'shell.run', params: { command: 'ls' } }
    const copy = cloneStep(source)

    expect(copy).not.toBe(source)
    expect(copy).toMatchObject({ action: 'shell.run', params: { command: 'ls' } })
    expect(copy.id).not.toBe('run-1')
    expect(copy.token).toBeTruthy()
    expect(copy.token).not.toBe('t-a')
  })
})

describe('moveStep', function () {
  it('moves one step and leaves the rest in order', function () {
    const steps = ['a', 'b', 'c'].map(function (id) {
      return actionStep(id)
    })

    expect(idsOf(moveStep(steps, 2, 0))).toEqual(['c', 'a', 'b'])
    expect(idsOf(steps)).toEqual(['a', 'b', 'c'])
  })
})

describe('buildControlStep', function () {
  it('builds a skeleton corex can read for every control-flow kind', function () {
    expect(sanitizeSteps([buildControlStep('if', 'if-1')])[0]).toEqual({
      id: 'if-1',
      if: '',
      then: []
    })
    expect(sanitizeSteps([buildControlStep('repeat', 'repeat-1')])[0]).toEqual({
      id: 'repeat-1',
      repeat: { count: 1 },
      steps: []
    })
    expect(sanitizeSteps([buildControlStep('parallel', 'parallel-1')])[0]).toEqual({
      id: 'parallel-1',
      parallel: []
    })
    expect(sanitizeSteps([buildControlStep('steps', 'steps-1')])[0]).toEqual({
      id: 'steps-1',
      steps: []
    })
  })

  it('stamps a list token on every skeleton', function () {
    expect(buildControlStep('if', 'a').token).toEqual(expect.any(String))
  })

  it('names the kind of every skeleton it builds', function () {
    expect(findStepKind(buildControlStep('if', 'a'))).toBe('if')
    expect(findStepKind(buildControlStep('repeat', 'a'))).toBe('repeat')
    expect(findStepKind(buildControlStep('parallel', 'a'))).toBe('parallel')
    expect(findStepKind(buildControlStep('steps', 'a'))).toBe('steps')
    expect(findStepKind(actionStep('a'))).toBe('action')
  })
})

describe('switchStepKind', function () {
  it('keeps the id, token, and carries the child steps over', function () {
    const steps = [actionStep('one', 't1'), actionStep('two', 't2')]
    const next = switchStepKind({ id: 'keep-me', token: 'keep-token', if: '', then: steps }, 'steps')

    expect(next).toEqual({ id: 'keep-me', token: 'keep-token', steps })
    expect(switchStepKind({ id: 'p', token: 'pt', parallel: steps }, 'repeat')).toEqual({
      id: 'p',
      token: 'pt',
      repeat: { count: 1 },
      steps
    })
  })

  it('puts children on parallel when switching to a parallel step', function () {
    const steps = [actionStep('one', 't1'), actionStep('two', 't2')]
    expect(switchStepKind({ id: 's', token: 'st', steps }, 'parallel')).toEqual({
      id: 's',
      token: 'st',
      parallel: steps
    })
    expect(switchStepKind({ id: 'i', token: 'it', if: '', then: steps }, 'parallel')).toEqual({
      id: 'i',
      token: 'it',
      parallel: steps
    })
  })

  it('folds else into the child list when leaving a condition', function () {
    const thenSteps = [actionStep('a', 'ta')]
    const elseSteps = [actionStep('b', 'tb')]
    expect(
      switchStepKind(
        { id: 'i', token: 'it', if: '', then: thenSteps, else: elseSteps },
        'steps'
      )
    ).toEqual({
      id: 'i',
      token: 'it',
      steps: [...thenSteps, ...elseSteps]
    })
  })

  it('gives a condition branch the children as its then', function () {
    expect(
      switchStepKind({ id: 's', token: 'st', steps: [actionStep('one', 't1')] }, 'if')
    ).toEqual({
      id: 's',
      token: 'st',
      if: '',
      then: [actionStep('one', 't1')]
    })
  })

  it('drops the fields the new kind cannot hold', function () {
    const next = switchStepKind(
      { id: 'a', token: 'at', action: 'shell.run', params: { command: 'ls' }, save_to: 'out' },
      'parallel'
    )

    expect(next).toEqual({ id: 'a', token: 'at', parallel: [] })
  })

  it('returns the very same step when the kind did not change', function () {
    const step = buildControlStep('parallel', 'a')
    expect(switchStepKind(step, 'parallel')).toBe(step)
  })
})

describe('stampSteps and sanitizeSteps', function () {
  it('fills missing tokens and leaves existing ones', function () {
    const stamped = stampSteps([actionStep('a', 'keep'), actionStep('b')])
    expect(stamped[0].token).toBe('keep')
    expect(stamped[1].token).toEqual(expect.any(String))
  })

  it('strips tokens for save', function () {
    expect(sanitizeSteps([actionStep('a', 't1')])).toEqual([{ id: 'a', action: 'shell.run' }])
  })
})

describe('replaceStep / duplicateStep / moveByToken', function () {
  it('replaces a nested step by token', function () {
    const child = actionStep('inner', 'child')
    const tree = [buildControlStep('steps', 'outer', 'parent')]
    tree[0] = { ...tree[0], steps: [child] }
    const next = replaceStep(tree, 'child', { ...child, id: 'renamed' })
    expect(next[0].token).toBe('parent')
    expect('steps' in next[0] && next[0].steps[0].id).toBe('renamed')
  })

  it('duplicates beside the original and gives the copy a new token', function () {
    const steps = [actionStep('a', 'ta'), actionStep('b', 'tb')]
    const next = duplicateStep(steps, 'ta')
    expect(next).toHaveLength(3)
    expect(next[0].token).toBe('ta')
    expect(next[1].token).not.toBe('ta')
    expect(next[1].token).not.toBe('tb')
    expect(next[2].token).toBe('tb')
  })

  it('moves among siblings by token', function () {
    const steps = [actionStep('a', 'ta'), actionStep('b', 'tb'), actionStep('c', 'tc')]
    expect(idsOf(moveByToken(steps, 'tc', -1))).toEqual(['a', 'c', 'b'])
  })
})

describe('nested sanitize, remove, mergeTokens', function () {
  const child = actionStep('inner', 'child')
  const branch = actionStep('else-1', 'else-t')
  const tree: Step[] = [
    {
      id: 'if-1',
      token: 'if-t',
      if: '',
      then: [child],
      else: [branch]
    }
  ]

  it('strips tokens through then and else', function () {
    expect(sanitizeSteps(tree)).toEqual([
      {
        id: 'if-1',
        if: '',
        then: [{ id: 'inner', action: 'shell.run' }],
        else: [{ id: 'else-1', action: 'shell.run' }]
      }
    ])
  })

  it('removes a step in else by token', function () {
    const next = removeStep(tree, 'else-t')
    expect(next[0]).toMatchObject({ token: 'if-t', then: [child], else: [] })
  })

  it('keeps draft tokens when the saved model has none', function () {
    const incoming = sanitizeSteps(tree)
    const merged = mergeTokens(tree, incoming)
    expect(merged).toMatchObject([
      {
        token: 'if-t',
        then: [{ token: 'child' }],
        else: [{ token: 'else-t' }]
      }
    ])
  })

  it('matches prior tokens by step id when order changes', function () {
    const prior = [actionStep('a', 'ta'), actionStep('b', 'tb')]
    const incoming = [
      { id: 'b', action: 'shell.run' },
      { id: 'a', action: 'shell.run' }
    ]
    expect(mergeTokens(prior, incoming)).toMatchObject([
      { id: 'b', token: 'tb' },
      { id: 'a', token: 'ta' }
    ])
  })
})
