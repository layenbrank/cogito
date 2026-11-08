/**
 * 程序化聚焦的门槛：只有「用户本来就在这个终端里」或「焦点还没落在任何可编辑
 * 区域」时，才允许 `term.focus()`。
 *
 * 为什么需要：agent 在后台跑一条命令会让对应 tab 变成 active，视图的 active
 * effect 一聚焦就把用户正在 composer 里打的字抢走 —— 输入内容没丢，但光标没了，
 * 后续按键全打进终端。**reveal（掀面板 / 高亮 tab）与 focus 是两件事**：前者可以
 * 自动，后者必须有用户意图。
 *
 * 判定刻意保守：拿不准就不聚焦。少聚焦一次的代价是多点一下；多聚焦一次的代价是
 * 用户正在写的一段话被吃掉。
 */

interface FocusProbe {
  /** 当前 activeElement（默认读 `document.activeElement`） */
  active?: Element | null
  /** 窗口是否在前台（默认读 `document.hasFocus()`） */
  focused?: boolean
}

function isEditableElement(element: Element | null): boolean {
  if (!element || !(element instanceof HTMLElement)) return false
  if (element.isContentEditable) return true
  const tag = element.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  // 另一个 xterm（含它内部的隐藏 textarea / 命令行）
  if (element.closest('.xterm')) return true
  return false
}

function canTakeFocus(container: HTMLElement | null, probe: FocusProbe = {}): boolean {
  if (!container || !container.isConnected) return false
  if (typeof document === 'undefined') return false
  const focused = probe.focused ?? document.hasFocus()
  // 窗口在后台：聚焦没有意义，还会在回到前台时抢走焦点
  if (!focused) return false
  const active = probe.active !== undefined ? probe.active : document.activeElement
  if (!active || active === document.body) return true
  // 焦点已经在这个终端里：再聚焦一次是幂等的
  if (container.contains(active)) return true
  // 用户在别处打字：不许抢
  return !isEditableElement(active)
}

export { canTakeFocus, isEditableElement }
export type { FocusProbe }
