import { HttpError } from '@/utils/http/errors.ts'

interface FriendlyError {
  message: string
  traceId?: string
}

/** 将原始网络 / 业务错误收成控制台可读中文 */
function findFriendlyError(error: unknown): FriendlyError {
  const err = HttpError(error)
  const raw = err.message || ''

  if (
    /Failed to fetch|NetworkError|ERR_CONNECTION|ECONNREFUSED|<no response>|Load failed|network/i.test(
      raw
    )
  ) {
    return {
      message: '无法连接服务，请确认 cogito 已启动后重试',
      traceId: err.traceId
    }
  }

  if (err.status === 404 || /资源不存在|NOT_FOUND/i.test(raw)) {
    return {
      message: '接口不存在或服务版本过旧，请更新 cogito 后重试',
      traceId: err.traceId
    }
  }

  if (/^\[(GET|POST|PUT|PATCH|DELETE)\]/i.test(raw)) {
    return { message: '请求失败，请稍后重试', traceId: err.traceId }
  }

  return { message: raw || '请求失败', traceId: err.traceId }
}

export { findFriendlyError }
export type { FriendlyError }
