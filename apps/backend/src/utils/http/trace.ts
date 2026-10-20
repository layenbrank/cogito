export const TRACEPARENT_HEADER = 'traceparent'

const TRACEPARENT = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/
const ZERO_TRACE_ID = '0'.repeat(32)
const TRACE_ID_BYTES = 16
const SPAN_ID_BYTES = 8

export function createTraceparent(): string {
  const bytes = randomBytes(TRACE_ID_BYTES + SPAN_ID_BYTES)
  bytes[0] |= 1
  bytes[TRACE_ID_BYTES] |= 1
  return ['00', hex(bytes.subarray(0, TRACE_ID_BYTES)), hex(bytes.subarray(TRACE_ID_BYTES)), '01'].join(
    '-'
  )
}

export function traceIdOf(traceparent: string | null | undefined): string | undefined {
  if (!traceparent) return undefined
  const traceId = TRACEPARENT.exec(traceparent.trim())?.[1]
  if (!traceId || traceId === ZERO_TRACE_ID) return undefined
  return traceId
}

function randomBytes(size: number) {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return bytes
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, function (byte) {
    return byte.toString(16).padStart(2, '0')
  }).join('')
}
