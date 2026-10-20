/**
 * 地址栏聚焦信号。
 *
 * 「聚焦地址栏」是一条键位命令，而输入框在 `AddressBar` 内部 —— 命令拿不到它的 ref。
 * 这里只用一条进程内（每个窗口一份）的订阅把两者接上，不引入全局状态。
 */
const listeners = new Set<() => void>()

function onAddressFocus(listener: () => void): () => void {
  listeners.add(listener)
  return function () {
    listeners.delete(listener)
  }
}

/** 请求把输入焦点放到地址栏，并全选当前网址（与浏览器一致）。 */
function requestAddressFocus(): void {
  for (const listener of listeners) listener()
}

export { onAddressFocus, requestAddressFocus }
