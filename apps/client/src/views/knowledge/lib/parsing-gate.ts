/**
 * 文档解析并发闸（对齐 llm_wiki source-preprocess 的 acquireParser）。
 */
import {
  MAX_USER_CONCURRENCY,
  MIN_USER_CONCURRENCY,
  readSourceWatchConfig
} from '@/views/knowledge/lib/source-watch-config.ts'

interface WaitingParser {
  limit: number
  resolve: () => void
}

let activeParsers = 0
const waitingParsers: WaitingParser[] = []

function drainWaitingParsers(): void {
  while (waitingParsers.length > 0 && activeParsers < waitingParsers[0]!.limit) {
    const waiter = waitingParsers.shift()
    if (!waiter) return
    activeParsers += 1
    waiter.resolve()
  }
}

async function acquireParser(limit: number): Promise<() => void> {
  const capped = Math.max(
    MIN_USER_CONCURRENCY,
    Math.min(MAX_USER_CONCURRENCY, Math.floor(limit) || MIN_USER_CONCURRENCY)
  )
  await new Promise<void>(function (resolve) {
    waitingParsers.push({ limit: capped, resolve })
    drainWaitingParsers()
  })
  let released = false
  return function releaseParser() {
    if (released) return
    released = true
    activeParsers -= 1
    drainWaitingParsers()
  }
}

async function withParsingGate<T>(run: () => Promise<T>): Promise<T> {
  const limit = readSourceWatchConfig().parsingConcurrency
  const release = await acquireParser(limit)
  try {
    return await run()
  } finally {
    release()
  }
}

export { acquireParser, withParsingGate }
