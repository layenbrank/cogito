/**
 * 条件（corex `Condition`）的判定与构造 —— 编辑器靠这张表驱动，
 * 新增一种条件类型只改 `CONDITION_KINDS` 与 `CONDITION_LABELS`。
 */

import type { Condition } from '@/views/directive/model/types.ts'

const CONDITION_KINDS = ['expr', 'eq', 'ne', 'gt', 'lt', 'contains', 'and', 'or', 'not'] as const

type ConditionKind = (typeof CONDITION_KINDS)[number]

/** 二元比较：`contains` 是「左边里找右边」（corex：字符串找子串、数组找元素、map 找键） */
type CompareKind = Extract<ConditionKind, 'eq' | 'ne' | 'gt' | 'lt' | 'contains'>

const CONDITION_LABELS: Record<ConditionKind, string> = {
  expr: '表达式',
  eq: '等于',
  ne: '不等于',
  gt: '大于',
  lt: '小于',
  contains: '包含',
  and: '且',
  or: '或',
  not: '非'
}

/** 比较两侧的输入提示：`contains` 的右边是「要找的东西」，不是拿来比较的值 */
const COMPARE_PLACEHOLDER: Record<CompareKind, [string, string]> = {
  eq: ['{{表达式}}', '字面量'],
  ne: ['{{表达式}}', '字面量'],
  gt: ['{{表达式}}', '字面量'],
  lt: ['{{表达式}}', '字面量'],
  contains: ['{{表达式}}', '要找的子串 / 元素']
}

/** 由已存的条件值反推它在 UI 上属于哪种类型：YAML 里的键名就是类型 */
function conditionKind(condition: Condition): ConditionKind {
  if (typeof condition === 'string') return 'expr'
  if (condition.eq) return 'eq'
  if (condition.ne) return 'ne'
  if (condition.gt) return 'gt'
  if (condition.lt) return 'lt'
  if (condition.contains) return 'contains'
  if (condition.and) return 'and'
  if (condition.or) return 'or'
  if (condition.not !== undefined) return 'not'
  return 'expr'
}

/** 数值字面量：`5`、`-3.5`、`.5`、`1e3`；`+5` 与空白不算（YAML 里也不认） */
const NUMBER_LITERAL = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

/**
 * 比较操作数的一行文本 → 值。
 *
 * 文本最终要变成 YAML，所以按 YAML 的字面量规则认标量：数字给数字、`true` / `false`
 * 给布尔，其余（含 `${...}` 表达式）仍是字符串。
 *
 * 一律当字符串存的后果不只在类型上：corex 的 `gt` / `lt` 走 `as_f64()`，字符串的
 * `as_f64()` 是 `None` —— 界面上配出来的数值比较会直接报「需要数值比较」，`eq` 则是
 * 静默变假（`Value::Str("1") != Value::Int(1)`）。
 */
function parseOperand(text: string): unknown {
  if (text === '') return ''
  if (text === 'true') return true
  if (text === 'false') return false
  if (NUMBER_LITERAL.test(text)) {
    const num = Number(text)
    // 超出双精度范围的字面量（`1e999`）当数字会把 corex 的解析搞成 Infinity
    if (Number.isFinite(num)) return num
  }
  return text
}

/** 换类型时给个空壳：不能把上一类型的键留在对象里，否则两种条件同时成立 */
function makeCondition(kind: ConditionKind): Condition {
  if (kind === 'expr' || kind === 'not') return kind === 'not' ? { not: '' } : ''
  if (kind === 'and') return { and: [] }
  if (kind === 'or') return { or: [] }
  return { [kind]: ['', ''] }
}

export {
  COMPARE_PLACEHOLDER,
  CONDITION_KINDS,
  CONDITION_LABELS,
  conditionKind,
  makeCondition,
  parseOperand
}
export type { CompareKind, ConditionKind }
