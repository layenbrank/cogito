import type { DirectiveInput } from '@/shared/ipc/specs/sidecar'

function seedInputValues(inputs: DirectiveInput[]): Record<string, string> {
  const values: Record<string, string> = {}
  inputs.forEach(function (input) {
    if (input.default === undefined || input.default === null) {
      values[input.name] = ''
      return
    }
    values[input.name] =
      typeof input.default === 'string' ? input.default : JSON.stringify(input.default)
  })
  return values
}

function buildInputPayload(
  inputs: DirectiveInput[],
  values: Record<string, string>
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  inputs.forEach(function (input) {
    const raw = values[input.name] ?? ''
    if (raw === '') {
      if (input.required) throw new Error(`请填写 ${input.name}`)
      return
    }
    try {
      payload[input.name] = JSON.parse(raw) as unknown
    } catch (error) {
      // 参数本来就可以是普通文本（不是 JSON）：回落原字符串
      console.debug('[directive] 运行参数不是 JSON，按字符串传入:', error)
      payload[input.name] = raw
    }
  })
  return payload
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('需要 JSON 对象')
  }
  return parsed as Record<string, unknown>
}

export { seedInputValues, buildInputPayload, parseJsonObject }
