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
  } catch (error) {
    // BigInt / 循环引用等序列化不了的值：按空串处理，但留痕
    console.debug('[directive] 条件操作数无法序列化，按空串处理:', error)
    return ''
  }
}

function conditionChildKey(kind: string, child: Condition | string): string {
  if (typeof child === 'string') return `${kind}-str-${child}`
  return `${kind}-${conditionKind(child)}-${operandText(child)}`
}

export { operandText, conditionChildKey }
