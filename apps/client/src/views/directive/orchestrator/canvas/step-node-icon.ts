import type { findStepKind } from '@/views/directive/model/step-utils.ts'
import type { Step } from '@/views/directive/model/types.ts'

const KIND_LABEL: Record<string, string> = {
  action: '动作',
  if: '条件',
  repeat: '循环',
  parallel: '并行',
  steps: '步骤块'
}

function findStepHint(step: Step): string {
  if ('action' in step) {
    const keys = step.params ? Object.keys(step.params) : []
    if (step.save_to) return `→ ${step.save_to}`
    if (keys.length > 0) return `${keys.length} 个参数`
    return '未配置参数'
  }
  if ('if' in step) {
    const thenCount = step.then.length
    const elseCount = step.else?.length ?? 0
    return `then ${thenCount} · else ${elseCount}`
  }
  if ('repeat' in step) {
    if (typeof step.repeat.count === 'number') return `count ${step.repeat.count}`
    if (step.repeat.each) return `each ${step.repeat.each}`
    return '未设置循环'
  }
  if ('parallel' in step) return `${step.parallel.length} 条并行`
  if ('steps' in step) return `${step.steps.length} 个子步骤`
  return ''
}

function findStepIcon(kind: ReturnType<typeof findStepKind>): string {
  if (kind === 'action') return 'lucide:zap'
  if (kind === 'if') return 'lucide:git-branch'
  if (kind === 'repeat') return 'lucide:repeat'
  if (kind === 'parallel') return 'lucide:layers'
  return 'lucide:folder-tree'
}

function findStepTitle(step: Step, kind: ReturnType<typeof findStepKind>): string {
  if (kind === 'action' && 'action' in step) return step.action
  return `${KIND_LABEL[kind]} · ${step.id ?? '—'}`
}

export { KIND_LABEL, findStepHint, findStepIcon, findStepTitle }
