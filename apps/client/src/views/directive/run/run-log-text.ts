import type { CorexFrame } from '@/stores/run-logs.ts'

function normalizeLogText(text: string): string {
  return text
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
    const took = frame.took_ms != null ? `  (${frame.took_ms}ms)` : ''
    return `${mark} 结束  ${frame.step} · ${frame.action}${took}`
  }
  const total = frame.total != null ? `/${frame.total}` : ''
  const unit = frame.unit ? ` ${frame.unit}` : ''
  const done = frame.done != null ? `${frame.done}${total}${unit}` : '进行中'
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
