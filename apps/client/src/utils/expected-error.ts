/**
 * 「用户自己能修」的失败：工作区目录没了、供应商没配、没登录……
 *
 * 这类错误必须**展示到界面上**（带下一步怎么做），但**不该按崩溃上报** ——
 * 否则用户每发一条消息就往异常表里刷一条，真正的崩溃会被淹没。
 *
 * 判定用 `Symbol.for` 打的标记，而不是 `instanceof` / `name`：
 * - HMR 与多 bundle 下同一个模块可能有多个类实例，`instanceof` 会漏；
 * - 子类（比如 `WorkspaceCwdError`）要能各自保留自己的 `name` 给日志看，
 *   所以也不能靠 `name === 'ExpectedError'`。
 */
const EXPECTED_TAG = Symbol.for('cogito.expected-error')

class ExpectedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ExpectedError'
    Object.defineProperty(this, EXPECTED_TAG, { value: true, enumerable: false })
  }
}

function isExpectedError(error: unknown): error is ExpectedError {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return false
  if (Reflect.get(error, EXPECTED_TAG) === true) return true
  // 跨 bundle 时 Symbol.for 一致，但仍兜一层名字判定（老错误对象没有标记）
  return error instanceof Error && error.name === 'ExpectedError'
}

/** 把任意错误包成「可预期」：保留原文与 cause，只换掉分类标记 */
function asExpectedError(error: unknown, message?: string): ExpectedError {
  if (isExpectedError(error)) return error
  const text = message ?? (error instanceof Error ? error.message : String(error))
  return new ExpectedError(text, { cause: error })
}

export { EXPECTED_TAG, ExpectedError, asExpectedError, isExpectedError }
