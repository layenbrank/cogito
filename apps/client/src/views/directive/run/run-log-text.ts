import type { CorexFrame } from '@/stores/run-logs.ts'

function normalizeLogText(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex -- 剥 ANSI 颜色就是要点名 ESC（\u001b），绕不开控制字符
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

function formatControlLine(frame: Exclude<CorexFrame, { kind: 'step_output' }>): string {
  if (frame.kind === 'step_start') {
    return `▶ 开始  ${frame.step} · ${frame.action}`
  }
  if (frame.kind === 'step_end') {
    const mark = frame.ok === false ? '✗' : '✓'
    const took = frame.took_ms ? `  (${frame.took_ms}ms)` : ''
    return `${mark} 结束  ${frame.step} · ${frame.action}${took}`
  }
  const total = frame.total ? `/${frame.total}` : ''
  const unit = frame.unit ? ` ${frame.unit}` : ''
  const done = frame.done ? `${frame.done}${total}${unit}` : '进行中'
  return `… 进度  ${frame.step} · ${done}`
}

function formatRunLogText(frames: readonly CorexFrame[]): string {
  const lines: string[] = []
  let pendingOutput = ''

  function flushOutput() {
    if (!pendingOutput) return
    lines.push(pendingOutput.replace(/\n+$/, ''))
    pendingOutput = ''
  }

  frames.forEach(function (frame) {
    if (frame.kind === 'step_output') {
      const stream = frame.stream === 'stderr' ? 'stderr' : 'stdout'
      const chunk = normalizeLogText(frame.text ?? '')
      if (!chunk) return
      const header = `[${stream}] ${frame.step}`
      if (!pendingOutput.startsWith(`${header}\n`) && pendingOutput !== header) {
        flushOutput()
        pendingOutput = `${header}\n${chunk}`
      } else {
        pendingOutput += chunk
      }
      return
    }
    flushOutput()
    lines.push(formatControlLine(frame))
  })
  flushOutput()
  return lines.join('\n')
}

export { formatRunLogText }
