/**
 * xterm 写入队列：字节先进队，按帧（rAF）合并，再**串行**交给 `term.write`。
 *
 * 为什么需要：
 * - PTY 每读一次就推一个 chunk（可能几十到几百个/秒）。逐个 `term.write` 会让解析器
 *   与渲染器被切得很碎，长输出时容易出现「半行 / 光标乱跳 / 清屏序列错位」。
 * - `term.write(bytes, cb)` 的回调是「这一块解析完」的唯一可靠信号。并发调用多个
 *   write 时顺序仍由 xterm 内部缓冲保证，但我们拿不到**写空**的时刻，也就无法判断
 *   何时可以安全 `scrollToBottom` / `refresh`。所以这里自己维护串行性。
 * - 合并必须保持字节顺序：`Uint8Array` 拼接，**不做字符串解码**（xterm 的 UTF-8
 *   解码器有状态，跨 chunk 的中文字符由它自己接上）。
 *
 * 非目标：不做重试、不做丢字节的节流。块多就用**更大的合并块**跑得更快，
 * 而不是丢掉中间的字节（丢字节会直接损坏转义序列）。
 */
import type { Terminal as XtermTerminal } from '@xterm/xterm'

/** 合并后单次写入的上限：超过就先 flush，避免一帧内堆出巨大字符串 */
const MAX_FLUSH_BYTES = 512 * 1024

type Scheduler = (callback: () => void) => unknown

const textEncoder = new TextEncoder()

interface WriteQueueOptions {
  /**
   * 帧调度器。默认 `requestAnimationFrame`；测试里注入同步队列以保证确定性。
   * 返回的句柄在 `dispose` 时交给 `cancel`。
   */
  schedule?: Scheduler
  cancel?: (handle: unknown) => void
}

interface TerminalWriteQueue {
  /** 入队一段字节（原样，不解码） */
  push: (bytes: Uint8Array) => void
  /** 入队一段文本（内部按 UTF-8 编码成字节，仍走同一条有序队列） */
  pushText: (text: string) => void
  /** 立即把已入队的内容写出去（不等下一帧），用于「要马上看到」的场景 */
  flushNow: () => void
  /** 还在队列里没写出去的字节数（诊断 / 测试用） */
  pendingBytes: () => number
  /** 卸载：取消已排的帧并丢弃剩余字节（视图已经 dispose，写了也没人看） */
  dispose: () => void
}

function concat(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  if (chunks.length === 1) return chunks[0]
  const merged = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

function defaultSchedule(callback: () => void): unknown {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return globalThis.requestAnimationFrame(function () {
      callback()
    })
  }
  return globalThis.setTimeout(callback, 16)
}

function defaultCancel(handle: unknown): void {
  if (handle === undefined || handle === null) return
  if (typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(handle as number)
    return
  }
  globalThis.clearTimeout(handle as number)
}

/**
 * 建一条写入队列。`terminal` 只用它的 `write(bytes, callback)`，
 * 因此单测里传一个假的「记录调用」对象即可。
 */
function createWriteQueue(
  terminal: Pick<XtermTerminal, 'write'>,
  options: WriteQueueOptions = {}
): TerminalWriteQueue {
  const schedule = options.schedule ?? defaultSchedule
  const cancel = options.cancel ?? defaultCancel

  let pending: Uint8Array[] = []
  let pendingBytes = 0
  let frame: unknown = null
  let writing = false
  let disposed = false

  function takeBatch(): Uint8Array | null {
    if (pendingBytes === 0 || pending.length === 0) return null
    const batch = concat(pending, pendingBytes)
    pending = []
    pendingBytes = 0
    return batch
  }

  function writeNext(): void {
    if (disposed || writing) return
    const batch = takeBatch()
    if (!batch) return
    writing = true
    terminal.write(batch, function () {
      writing = false
      // 写的过程中又进了新块：下一帧继续，不打断当前解析
      if (pendingBytes > 0) requestFrame()
    })
  }

  function requestFrame(): void {
    if (disposed || frame !== null) return
    frame = schedule(function () {
      frame = null
      writeNext()
    })
  }

  function push(bytes: Uint8Array): void {
    if (disposed || bytes.byteLength === 0) return
    pending.push(bytes)
    pendingBytes += bytes.byteLength
    // 一帧内堆太多：立刻写，别把内存和延迟一起推高
    if (pendingBytes >= MAX_FLUSH_BYTES) {
      writeNext()
      return
    }
    requestFrame()
  }

  return {
    push: push,

    pushText: function (text) {
      if (disposed || text.length === 0) return
      push(textEncoder.encode(text))
    },

    flushNow: function () {
      if (disposed) return
      if (frame !== null) {
        cancel(frame)
        frame = null
      }
      writeNext()
    },

    pendingBytes: function () {
      return pendingBytes
    },

    dispose: function () {
      disposed = true
      if (frame !== null) {
        cancel(frame)
        frame = null
      }
      pending = []
      pendingBytes = 0
    }
  }
}

export { createWriteQueue, MAX_FLUSH_BYTES }
export type { TerminalWriteQueue, WriteQueueOptions }
