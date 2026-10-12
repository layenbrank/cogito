import type { Step } from '@/views/directive/model/types.ts'

function findStepByToken(steps: Step[], token: string | null): Step | null {
  if (!token) return null
  for (const step of steps) {
    if ((step.token ?? step.id) === token) return step
    const branches: Step[][] = []
    if ('if' in step) branches.push(step.then, ...(step.else ? [step.else] : []))
    else if ('parallel' in step) branches.push(step.parallel)
    else if ('repeat' in step) branches.push(step.steps)
    else if ('steps' in step && !('action' in step)) branches.push(step.steps)
    for (const branch of branches) {
      const found = findStepByToken(branch, token)
      if (found) return found
    }
  }
  return null
}

export { findStepByToken }
