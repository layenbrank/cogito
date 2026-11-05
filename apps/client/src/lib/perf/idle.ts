/**
 * 启动期非关键工作排到空闲（对齐 VS Code 的 `IdleValue` / `RunOnceScheduler`）。
 *
 * 用途：把「读几 MB 的 @types」「树刷新」「git status」这类不能省、但也不该
 * 抢占首帧的工作推到浏览器空闲时段。超时兜底保证机器一直忙时也会执行，
 * 不会出现「永远不跑」。
 */

/** requestIdleCallback 在某些 webview 里缺失；降级到 setTimeout 保证一定执行 */
const IDLE_TIMEOUT_MS = 2000

type IdleScheduler = (callback: () => void, options?: { timeout?: number }) => number

function pickScheduler(): IdleScheduler {
  if (typeof window !== 'undefined') {
    const candidate = (
      window as unknown as {
        requestIdleCallback?: IdleScheduler
      }
    ).requestIdleCallback
    if (typeof candidate === 'function') return candidate.bind(window)
  }
  return function (callback) {
    return window.setTimeout(callback, 1)
  }
}

/**
 * 空闲时执行 `task` 并返回其结果。
 *
 * 抛错不吞：reject 由调用方处理（同步 TS 库失败不该静默）。
 */
function runWhenIdle<T>(task: () => T | Promise<T>, timeoutMs = IDLE_TIMEOUT_MS): Promise<T> {
  const schedule = pickScheduler()
  return new Promise<T>(function (resolve, reject) {
    schedule(
      function () {
        try {
          void Promise.resolve(task()).then(resolve, reject)
        } catch (error) {
          // 同步抛错也要留痕：调用方可能只在 await 处兜底
          console.warn('[perf] idle 任务同步抛错', error)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      },
      { timeout: timeoutMs }
    )
  })
}

export { IDLE_TIMEOUT_MS, runWhenIdle }
