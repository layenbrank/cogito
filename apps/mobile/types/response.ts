/**
 * rust-service success envelope (HTTP 200; business result in `code`).
 */
interface RSF<T> {
  code: number
  success: boolean
  msg: string
  data: T
  timestamp: number
}

/**
 * Paginated envelope.
 */
interface RSP<T> extends RSF<T> {
  total: number
}

export type { RSF, RSP }
