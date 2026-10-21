/**
 * cogito 异常上报（`POST /api/v1/exception`，可匿名；有 Bearer 时回填 userID）。
 */
import { HttpEnvelope } from '@/utils/http/errors.ts'
import { http } from '@/utils/http/http.ts'

interface ExceptionWrite {
  eventID: string
  message: string
  timestamp: number
  url: string
  stack?: string
  level?: string
  status?: number
  method?: string
  reqID?: string
  ip?: string
  userAgent?: string
  userID?: string
  environment?: string
  release?: string
  context?: unknown
  fingerprint?: string
  source?: string
}

interface ExceptionRecord {
  id: string
  eventID: string
  fingerprint: string
  source: string
  level: string
  message: string
  url: string
  timestamp: number
  receivedAt: number
}

function POST_EXCEPTION(body: ExceptionWrite) {
  return http
    .post<RSF<ExceptionRecord>>('/exception', body, { env: 'thinking' })
    .then(HttpEnvelope)
}

export { POST_EXCEPTION }
export type { ExceptionRecord, ExceptionWrite }
