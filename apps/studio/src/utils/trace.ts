/**
 * 跨进程链路标识（W3C Trace Context）。
 *
 * 服务端契约：所有跨进程端点都接受并回显 `traceparent`，响应信封另带 `traceID`。前端在请求
 * 发出前注入一条新链路的根上下文，服务端据此把入口日志与下游调用（compute 等）串成同一条
 * 链路；失败时再把服务端回显的 trace-id 带回 `HttpException.traceId`（见 `http.errors.ts`）。
 */

/** 链路头（W3C Trace Context） */
export const TRACEPARENT_HEADER = 'traceparent'

/** `00-<32 位 trace-id>-<16 位 span-id>-<2 位 flags>` */
const TRACEPARENT = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/

/** W3C 不允许全零标识 */
const ZERO_TRACE_ID = '0'.repeat(32)

/** trace-id 16 字节 / span-id 8 字节 */
const TRACE_ID_BYTES = 16
const SPAN_ID_BYTES = 8

/**
 * 新建链路根上下文（浏览器侧一次请求一条链路）。
 *
 * flags 段置 `01`（sampled）：前端请求都是用户可感知的交互，标成已采样后服务端 `ParentBased`
 * 采样器会沿用该决定（见 `apps/service/guide/configuration.md` 的 `telemetry.sample_ratio`），
 * 保证这些流程一定有链路可查；要按比例降采样得改服务端采样器。
 */
export function createTraceparent(): string {
  const bytes = randomBytes(TRACE_ID_BYTES + SPAN_ID_BYTES)
  // 全零标识非法，把两个标识的首字节最低位钉成 1
  bytes[0] |= 1
  bytes[TRACE_ID_BYTES] |= 1
  return [
    '00',
    hex(bytes.subarray(0, TRACE_ID_BYTES)),
    hex(bytes.subarray(TRACE_ID_BYTES)),
    '01'
  ].join('-')
}

/** 从 `traceparent` 里取 trace-id（响应头与入站头同格式）；格式非法或全零标识返回 undefined */
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
