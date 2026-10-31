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

import { readRunningTurns } from '@/features/agent/acp/background-turn'

const running = new Set<string>()
/** 最近跑完、尚未被用户「领取」的会话；重新开跑或用户点开时清掉 */
const finished = new Set<string>()
let snapshot: readonly string[] = []
let finishedSnapshot: readonly string[] = []
const listeners = new Set<() => void>()

function publish() {
  snapshot = [...running]
  finishedSnapshot = [...finished]
  for (const listener of listeners) listener()
}

function markRunStarted(threadID: string) {
  let changed = false
  if (!running.has(threadID)) {
    running.add(threadID)
    changed = true
  }
  if (finished.delete(threadID)) changed = true
  if (changed) publish()
}

function markRunFinished(threadID: string) {
  let changed = false
  if (running.delete(threadID)) changed = true
  if (!finished.has(threadID)) {
    finished.add(threadID)
    changed = true
  }
  if (changed) publish()
}

/** 用户点开了这条已跑完的会话：从「待领取」里移除 */
function clearFinishedRun(threadID: string) {
  if (!finished.delete(threadID)) return
  publish()
}

/** goose 连接断开：旧会话全部不可用，运行态一并清掉 */
function clearRunState() {
  if (running.size === 0 && finished.size === 0) return
  running.clear()
  finished.clear()
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

function findFinishedSnapshot(): readonly string[] {
  return finishedSnapshot
}

/** 订阅「哪些会话在跑」；登录/重连时随 `runtimeHook` 重建也不丢 */
function useRunningThreads(): ReadonlySet<string> {
  const ids = useSyncExternalStore(subscribeRunState, findRunSnapshot, findRunSnapshot)
  return useMemo(function () {
    return new Set(ids)
  }, [ids])
}

/** 订阅「哪些会话跑完待领取」 */
function useFinishedThreads(): ReadonlySet<string> {
  const ids = useSyncExternalStore(subscribeRunState, findFinishedSnapshot, findFinishedSnapshot)
  return useMemo(function () {
    return new Set(ids)
  }, [ids])
}

function hasRunningThreads(): boolean {
  return running.size > 0
}

/**
 * 刷新后水合：把 localStorage 里的 running 标记回到内存态。
 *
 * 内存 Set 是运行时层、localStorage 是持久化层 —— 启动时同步一次，会话列表据此标注
 * 「生成中」、自动选中据此定位；之后的增删仍走内存态（markRunStarted / markRunFinished），
 * 持久化层由 background-turn 的 mark/clearPersistedRunning 维护。
 */
function hydrateRunningFromPersistence(): void {
  let changed = false
  for (const id of readRunningTurns()) {
    if (running.has(id)) continue
    running.add(id)
    changed = true
  }
  if (changed) publish()
}
hydrateRunningFromPersistence()

export {
  clearFinishedRun,
  clearRunState,
  findFinishedSnapshot,
  findRunSnapshot,
  hasRunningThreads,
  markRunFinished,
  markRunStarted,
  useFinishedThreads,
  useRunningThreads
}
