import { conditionKind } from '@/views/directive/model/condition.ts'
import type { Condition } from '@/views/directive/model/types.ts'

function operandText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

function conditionChildKey(kind: string, child: Condition | string): string {
  if (typeof child === 'string') return `${kind}-str-${child}`
  return `${kind}-${conditionKind(child)}-${operandText(child)}`
}

export { operandText, conditionChildKey }
