import { HttpEnvelope } from '@/utils/http/errors.ts'
import { http } from '@/utils/http/http.ts'

interface ExceptionQuery {
  take?: number
  skip?: number
  source?: string
  level?: string
  fingerprint?: string
  environment?: string
  q?: string
  receivedFrom?: string
  receivedTo?: string
}

interface ExceptionRecord {
  id: string
  eventID: string
  fingerprint: string
  source: string
  level: string
  message: string
  stack?: string | null
  status?: number | null
  method?: string | null
  url: string
  reqID?: string | null
  ip?: string | null
  userAgent?: string | null
  userID?: string | null
  environment?: string | null
  release?: string | null
  context?: unknown
  timestamp: number
  receivedAt: number
}

interface ExceptionPage {
  items: ExceptionRecord[]
  total: number
}

interface ExceptionGroup {
  fingerprint: string
  count: number
  lastSeen: number
  firstSeen: number
  message: string
  level: string
  source: string
  url: string
  environment?: string | null
  status?: number | null
}

interface ExceptionGroupPage {
  items: ExceptionGroup[]
  total: number
}

interface ExceptionSummary {
  total: number
  byLevel: Record<string, number>
  bySource: Record<string, number>
}

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

const ENV = { env: 'cogito' as const }

async function unwrap<T>(pending: Promise<RSF<T>>): Promise<T> {
  return HttpEnvelope(await pending)
}

/** 客户端上报；失败由调用方吞掉，勿再包 toast */
function POST_EXCEPTION(body: ExceptionWrite) {
  return unwrap(http.post<RSF<ExceptionRecord>>('/exception', body, ENV))
}

function GET_EXCEPTIONS(query: ExceptionQuery = {}) {
  return unwrap(http.get<RSF<ExceptionPage>>('/exception', { ...ENV, query }))
}

function GET_EXCEPTION(id: string) {
  return unwrap(http.get<RSF<ExceptionRecord>>(`/exception/${id}`, ENV))
}

function DELETE_EXCEPTION(id: string) {
  return unwrap(http.delete<RSF<null>>(`/exception/${id}`, ENV))
}

function GET_EXCEPTION_GROUPS(query: ExceptionQuery = {}) {
  return unwrap(http.get<RSF<ExceptionGroupPage>>('/exception/groups', { ...ENV, query }))
}

function GET_EXCEPTION_SOURCES() {
  return unwrap(http.get<RSF<string[]>>('/exception/sources', ENV))
}

function GET_EXCEPTION_SUMMARY(query: ExceptionQuery = {}) {
  return unwrap(http.get<RSF<ExceptionSummary>>('/exception/summary', { ...ENV, query }))
}

export {
  DELETE_EXCEPTION,
  GET_EXCEPTION,
  GET_EXCEPTIONS,
  GET_EXCEPTION_GROUPS,
  GET_EXCEPTION_SOURCES,
  GET_EXCEPTION_SUMMARY,
  POST_EXCEPTION
}
export type {
  ExceptionGroup,
  ExceptionGroupPage,
  ExceptionPage,
  ExceptionQuery,
  ExceptionRecord,
  ExceptionSummary,
  ExceptionWrite
}
