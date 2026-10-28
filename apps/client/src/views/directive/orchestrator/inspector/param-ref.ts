import type { DirectiveInput, Step } from '@/views/directive/model/types.ts'

/** 参数引用作用域（写入 YAML 时的前缀） */
type RefScope = 'variables' | 'input' | 'env' | 'step'

interface RefLeaf {
  scope: RefScope
  /** 花括号内路径，如 `variables.base` / `input.deploy` / `env.TEMP` / `step.build.stdout` */
  path: string
  /** 叶节点展示名 */
  label: string
  /** 可选副标题（默认值预览等） */
  hint?: string
  /** 步骤叶：可再选子路径 */
  children?: RefLeaf[]
}

interface RefGroup {
  scope: RefScope
  title: string
  leaves: RefLeaf[]
}

interface StepRef {
  id: string
  action?: string
}

interface ParamRefContext {
  variables: Record<string, unknown>
  inputs: DirectiveInput[]
  /** 可供引用的步骤（通常已排除当前步） */
  steps: StepRef[]
}

/** 纯 `{{ expr }}`（整串只含一段占位符） */
const PURE_REF = /^\{\{\s*([^}]+?)\s*\}\}$/

const ENV_LEAVES: RefLeaf[] = [
  { scope: 'env', path: 'env.TEMP', label: 'TEMP', hint: '临时目录' },
  { scope: 'env', path: 'env.TMP', label: 'TMP' },
  { scope: 'env', path: 'env.HOME', label: 'HOME' },
  { scope: 'env', path: 'env.USERPROFILE', label: 'USERPROFILE', hint: 'Windows 用户目录' },
  { scope: 'env', path: 'env.PATH', label: 'PATH' },
  { scope: 'env', path: 'env.APPDATA', label: 'APPDATA' },
  { scope: 'env', path: 'env.LOCALAPPDATA', label: 'LOCALAPPDATA' },
  { scope: 'env', path: 'env.USERNAME', label: 'USERNAME' }
]

/** shell / exec 类动作常见输出字段 */
const SHELL_STEP_FIELDS = [
  { key: 'stdout', hint: '标准输出' },
  { key: 'stderr', hint: '标准错误' },
  { key: 'exit_code', hint: '退出码' },
  { key: 'success', hint: '是否成功' }
] as const

const GENERIC_STEP_FIELDS = [{ key: 'value', hint: '常用取值别名' }] as const

const SCOPE_TITLE: Record<RefScope, string> = {
  variables: '变量',
  input: '输入',
  env: '环境',
  step: '步骤输出'
}

function wrapRef(path: string): string {
  return `{{${path}}}`
}

function parsePureRef(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const matched = value.trim().match(PURE_REF)
  if (!matched) return null
  return matched[1].replace(/\s+/g, '')
}

/**
 * 把 YAML 里常见写法收成选择器 canonical path，便于高亮匹配：
 * - `var.x` → `variables.x`；`inputs.x` → `input.x`；`steps.x` → `step.x`
 * - 裸名 `dist`：先变量表，再输入表
 */
function normalizeRefPath(path: string, context?: ParamRefContext): string {
  const trimmed = path.trim()
  if (trimmed.startsWith('var.')) return `variables.${trimmed.slice(4)}`
  if (trimmed.startsWith('inputs.')) return `input.${trimmed.slice(7)}`
  if (trimmed.startsWith('steps.')) return `step.${trimmed.slice(6)}`
  if (trimmed.includes('.')) return trimmed

  if (context?.variables && Object.prototype.hasOwnProperty.call(context.variables, trimmed)) {
    return `variables.${trimmed}`
  }
  if (
    context?.inputs.some(function (input) {
      return input.name === trimmed
    })
  ) {
    return `input.${trimmed}`
  }
  return trimmed
}

function formatRefLabel(path: string, context?: ParamRefContext): string {
  const normalized = normalizeRefPath(path, context)
  const parts = normalized.split('.')
  const head = parts[0]
  const rest = parts.slice(1).join('.')

  if (head === 'variables') {
    return `${SCOPE_TITLE.variables} · ${rest || '(根)'}`
  }
  if (head === 'input') {
    return `${SCOPE_TITLE.input} · ${rest || '(全部)'}`
  }
  if (head === 'env') {
    return `${SCOPE_TITLE.env} · ${rest || '(?)'}`
  }
  if (head === 'step') {
    return `${SCOPE_TITLE.step} · ${rest || '(?)'}`
  }
  return `引用 · ${normalized}`
}

function isShellLikeAction(action?: string): boolean {
  if (!action) return false
  return /^(shell|exec)\./.test(action) || action === 'shell.run' || action === 'exec.run'
}

function buildStepFieldLeaves(stepId: string, action?: string): RefLeaf[] {
  const fields = isShellLikeAction(action) ? SHELL_STEP_FIELDS : GENERIC_STEP_FIELDS
  return fields.map(function (field) {
    return {
      scope: 'step' as const,
      path: `step.${stepId}.${field.key}`,
      label: field.key,
      hint: field.hint
    }
  })
}

function collectStepRefs(steps: Step[], options?: { excludeId?: string | null }): StepRef[] {
  const refs: StepRef[] = []
  const excludeId = options?.excludeId ?? null

  function walk(list: Step[]) {
    list.forEach(function (step) {
      if (step.id && step.id !== excludeId) {
        refs.push({
          id: step.id,
          action: 'action' in step ? step.action : undefined
        })
      }
      if ('if' in step) {
        walk(step.then)
        if (step.else) walk(step.else)
      } else if ('parallel' in step) {
        walk(step.parallel)
      } else if ('steps' in step) {
        walk(step.steps)
      }
    })
  }

  walk(steps)
  return refs
}

function buildRefGroups(context: ParamRefContext): RefGroup[] {
  const variableLeaves = Object.keys(context.variables).map(function (name) {
    const value = context.variables[name]
    const hint =
      value === undefined || value === null
        ? undefined
        : typeof value === 'string'
          ? value
          : JSON.stringify(value)
    return {
      scope: 'variables' as const,
      path: `variables.${name}`,
      label: name,
      hint: hint && hint.length > 48 ? `${hint.slice(0, 48)}…` : hint
    }
  })

  const inputLeaves = context.inputs
    .filter(function (input) {
      return Boolean(input.name)
    })
    .map(function (input) {
      return {
        scope: 'input' as const,
        path: `input.${input.name}`,
        label: input.name,
        hint: input.description || undefined
      }
    })

  const stepLeaves = (context.steps ?? []).map(function (step) {
    const children: RefLeaf[] = [
      {
        scope: 'step',
        path: `step.${step.id}`,
        label: '整段输出',
        hint: step.action ? `动作 ${step.action}` : undefined
      },
      ...buildStepFieldLeaves(step.id, step.action)
    ]
    return {
      scope: 'step' as const,
      path: `step.${step.id}`,
      label: step.id,
      hint: step.action,
      children
    }
  })

  return [
    { scope: 'variables', title: SCOPE_TITLE.variables, leaves: variableLeaves },
    { scope: 'input', title: SCOPE_TITLE.input, leaves: inputLeaves },
    { scope: 'env', title: SCOPE_TITLE.env, leaves: ENV_LEAVES },
    { scope: 'step', title: SCOPE_TITLE.step, leaves: stepLeaves }
  ]
}

/** 在字符串指定区间插入引用（用于混合模板） */
function insertAt(text: string, start: number, end: number, insertion: string): string {
  const from = Math.max(0, Math.min(start, text.length))
  const to = Math.max(from, Math.min(end, text.length))
  return text.slice(0, from) + insertion + text.slice(to)
}

type PathKind = 'file' | 'directory'

/** 根据参数名 / 类型推断是否适合本机路径选择 */
function findPathKind(param: { name: string; ty: string }): PathKind | null {
  const name = param.name.toLowerCase()
  const ty = param.ty.toLowerCase()

  if (/cwd|dir|folder|directory|outdir|outdir|destdir/.test(name)) return 'directory'
  if (name === 'from' || name === 'to' || name === 'dest' || name === 'destination') {
    return 'directory'
  }
  if (/file|filepath|filename/.test(name)) return 'file'
  if (/\bpath\b/.test(name) || ty.includes('path') || ty.includes('file')) {
    return /dir|folder/.test(ty) ? 'directory' : 'file'
  }
  return null
}

export {
  PURE_REF,
  SCOPE_TITLE,
  wrapRef,
  parsePureRef,
  normalizeRefPath,
  formatRefLabel,
  collectStepRefs,
  buildRefGroups,
  insertAt,
  findPathKind
}
export type { RefScope, RefLeaf, RefGroup, ParamRefContext, StepRef, PathKind }
