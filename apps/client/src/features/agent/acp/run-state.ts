/**
 * 正在跑一轮的会话（按 threadID）。
 *
 * assistant-ui 的线程列表只给「当前会话」的运行态，库本身不会把后台会话的 `isRunning`
 * 暴露到我们读的那个 `threads.threadItems` 快照上。而多会话并发的前提是用户能看见
 * 「我切走的那条还在生成」—— 否则切回来发现没跑完，只会以为它被中断了。
 *
 * 所以运行态在 ACP 控制器这一层记：`runThreadPrompt` 起止各打一次标记，左栏订阅。
 */
import { useMemo, useSyncExternalStore } from 'react'

const running = new Set<string>()
let snapshot: readonly string[] = []
const listeners = new Set<() => void>()

function publish() {
  snapshot = [...running]
  for (const listener of listeners) listener()
}

function markRunStarted(threadID: string) {
  if (running.has(threadID)) return
  running.add(threadID)
  publish()
}

function markRunFinished(threadID: string) {
  if (!running.delete(threadID)) return
  publish()
}

/** goose 连接断开：旧会话全部不可用，运行态一并清掉 */
function clearRunState() {
  if (running.size === 0) return
  running.clear()
  publish()
}

function subscribeRunState(listener: () => void) {
  listeners.add(listener)
  return function () {
    listeners.delete(listener)
  }
}

function findRunSnapshot(): readonly string[] {
  return snapshot
}

/** 订阅「哪些会话在跑」；登录/重连时随 `runtimeHook` 重建也不丢 */
function useRunningThreads(): ReadonlySet<string> {
  const ids = useSyncExternalStore(subscribeRunState, findRunSnapshot, findRunSnapshot)
  return useMemo(function () {
    return new Set(ids)
  }, [ids])
}

export { clearRunState, markRunFinished, markRunStarted, useRunningThreads }
