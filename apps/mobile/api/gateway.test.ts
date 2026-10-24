import { parseSseDelta } from '@/api/gateway'

describe('gateway sse parsing', () => {
  test('reads delta content', () => {
    expect(parseSseDelta('{"choices":[{"delta":{"content":"你好"}}]}')).toBe('你好')
    expect(parseSseDelta('[DONE]')).toBe('')
  })

  test('ignores malformed payloads', () => {
    expect(parseSseDelta('{')).toBe('')
  })
})
