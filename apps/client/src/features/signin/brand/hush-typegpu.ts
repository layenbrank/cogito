/**
 * shaders（CursorRipples 等 RTT）内嵌的 TypeGPU 与应用侧可能各有一份实例。
 * 对「另一份」调用 warn.disable 无效，因此按消息特征过滤 console.warn。
 * 仅压制库已知噪音，其它警告原样透出。
 */

const NOISE = [
  '[external-omitted]',
  '[deprecated]',
  'Found duplicate TypeGPU version',
  'powerPreference option is currently ignored'
] as const

let isHushed = false
let originalWarn: typeof console.warn | null = null

function isNoise(args: unknown[]) {
  const text = args
    .map(function (arg) {
      return typeof arg === 'string' ? arg : ''
    })
    .join(' ')

  for (const marker of NOISE) {
    if (text.includes(marker)) return true
  }
  return false
}

function hushTypegpuNoise() {
  if (isHushed) return
  isHushed = true
  originalWarn = console.warn.bind(console)
  console.warn = function (...args: unknown[]) {
    if (isNoise(args)) return
    originalWarn!(...args)
  }
}

export { hushTypegpuNoise }
