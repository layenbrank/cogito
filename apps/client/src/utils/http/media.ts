import { ENV_URLS } from '@/utils/http/env.ts'

/**
 * 把服务端回的相对媒体路径（如 `/api/v1/upload/asset/{id}`）拼成绝对 URL。
 * `VITE_COGITO` 已带 `/api/v1`，路径本身也带完整 URI 前缀，所以只取 origin 再拼。
 */
function findCogitoMediaUrl(path: string | null | undefined): string | null {
  if (!path) return null
  if (/^(https?:|blob:|data:)/i.test(path)) return path

  const base = ENV_URLS.cogito?.trim()
  if (!base) return path

  try {
    const origin = new URL(base).origin
    return `${origin}${path.startsWith('/') ? path : `/${path}`}`
  } catch (error) {
    console.warn('[media] findCogitoMediaUrl: invalid VITE_COGITO', error)
    return path
  }
}

export { findCogitoMediaUrl }
