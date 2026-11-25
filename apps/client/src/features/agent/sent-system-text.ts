/**
 * 最近一次**真的发出去**的系统提示（按线程）。
 *
 * 为什么需要它：composer footer 的上下文估算要算「系统占了多少」，而它以前是**自己重新推导**
 * 一份系统提示（`findSystemPrompt(scenario, …)`）。真实发送那一侧用的是 `buildSystemPrompt`
 * 加场景覆盖、模式引导、端口覆盖（dock / 内联有各自的 systemText）。两套推导迟早不一致，
 * 于是估算里「系统」那一格和实际上下文对不上，用户看到的是「明明只有几句话，系统却占了 40%」。
 *
 * 现在由发送方登记一份原文，估算直接用它（没发过才回退到推导值）。
 */

/** 上限：内联 / 子代理这些一次性线程也会登记，别让表无限长大 */
const MAX_ENTRIES = 200

const byThread = new Map<string, string>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/** 登记本轮实际发出的系统提示（`''` 也算：那一轮确实没带系统提示） */
function rememberSentSystemText(threadID: string, systemText: string): void {
  const key = threadID.trim()
  if (!key) return
  if (byThread.get(key) === systemText) return
  byThread.delete(key)
  byThread.set(key, systemText)
  while (byThread.size > MAX_ENTRIES) {
    const oldest = byThread.keys().next().value
    if (oldest === undefined) break
    byThread.delete(oldest)
  }
  notify()
}

function readSentSystemText(threadID: string): string | null {
  return byThread.get(threadID.trim()) ?? null
}

/** 线程关掉 / 解绑时清掉：别让一次性线程的文本被后面复用的 id 读到 */
function forgetSentSystemText(threadID: string): void {
  if (byThread.delete(threadID.trim())) notify()
}

function subscribeSentSystemText(listener: () => void): () => void {
  listeners.add(listener)
  return function () {
    listeners.delete(listener)
  }
}

function clearSentSystemText(): void {
  byThread.clear()
  notify()
}

export {
  clearSentSystemText,
  forgetSentSystemText,
  readSentSystemText,
  rememberSentSystemText,
  subscribeSentSystemText
}
