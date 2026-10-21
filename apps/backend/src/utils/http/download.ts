import { findAuthToken } from '@/utils/auth.ts'
import { findActiveTenantID } from '@/utils/tenant.ts'
import { ENV_URLS } from '@/utils/http/env.ts'
import { createTraceparent, TRACEPARENT_HEADER } from '@/utils/http/trace.ts'
import { HttpException } from '@/utils/http/errors.ts'

interface DownloadQuery {
  [key: string]: string | number | undefined
}

async function downloadFile(path: string, filename: string, query: DownloadQuery = {}) {
  const base = ENV_URLS.thinking.replace(/\/$/, '')
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`)
  Object.entries(query).forEach(function ([key, value]) {
    if (value != null && value !== '') url.searchParams.set(key, String(value))
  })

  const headers = new Headers()
  headers.set(TRACEPARENT_HEADER, createTraceparent())
  const token = findAuthToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const tenantID = findActiveTenantID()
  if (tenantID) headers.set('X-Tenant-ID', tenantID)

  const response = await fetch(url.toString(), { headers })
  if (!response.ok) {
    let message = `导出失败（${response.status}）`
    let code = response.status
    let traceId: string | undefined
    try {
      const body = (await response.json()) as RSF<unknown>
      message = body.msg || message
      code = body.code ?? code
      traceId = body.traceID
    } catch {
      /* 文件流错误体可能非 JSON */
    }
    throw new HttpException(message, code, { status: response.status, traceId })
  }

  const blob = await response.blob()
  const disposition = response.headers.get('Content-Disposition')
  const matched = disposition?.match(/filename="?([^"]+)"?/i)
  const resolvedName = matched?.[1] ?? filename
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = resolvedName
  anchor.click()
  URL.revokeObjectURL(objectUrl)
}

export { downloadFile }
