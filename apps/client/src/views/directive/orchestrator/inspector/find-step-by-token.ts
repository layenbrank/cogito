import type { Step } from '@/views/directive/model/types.ts'

function findStepByToken(steps: Step[], token: string | null): Step | null {
  if (!token) return null
  for (const step of steps) {
    if ((step.token ?? step.id) === token) return step
    const nested: Step[][] = []
    if ('if' in step) nested.push(step.then, ...(step.else ? [step.else] : []))
    else if ('parallel' in step) nested.push(step.parallel)
    else if ('repeat' in step) nested.push(step.steps)
    else if ('steps' in step && !('action' in step)) nested.push(step.steps)
    for (const list of nested) {
      const found = findStepByToken(list, token)
      if (found) return found
    }
  }
  return null
}

export { findStepByToken }
