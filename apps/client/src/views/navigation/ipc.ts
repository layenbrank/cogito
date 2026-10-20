import { invoke } from '@tauri-apps/api/core'

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

interface ExtensionsResult {
  names: string[]
  supported: boolean
}

interface OpenedPage {
  ok: boolean | null
}

interface LivePage {
  id: string
  ok: boolean | null
}

/**
 * 同一个页面可能被两处同时要求打开（挂载时恢复 + 用户点标签）。
 *
 * Rust 侧已经串行化 + 可接管同名 WebView，这里再按 id 合并一次请求，
 * 避免把「查→建」跑两遍：两次请求都拒绝时它也只会报一次。
 */
const openings = new Map<string, Promise<OpenedPage>>()

function openPage(id: string, url: string) {
  const pending = openings.get(id)
  if (pending) return pending
  const run = invoke<OpenedPage>('navigation:open', { body: { id, url } }).finally(function () {
    openings.delete(id)
  })
  openings.set(id, run)
  return run
}

function readLivePages() {
  return invoke<LivePage[]>('navigation:read-lives')
}

// 摆位、切换、收起必须按调用顺序执行：离开主页时的收起若和尚未返回的 present 并行，
// 后完成的 present 会把已经藏起来的子 WebView 再次盖到磁贴页上。
let pageLane: Promise<unknown> = Promise.resolve()

function enqueuePage<T>(task: () => Promise<T>) {
  const run = pageLane.then(task, task)
  pageLane = run.then(
    function () {
      return undefined
    },
    function () {
      return undefined
    }
  )
  return run
}

/** 内容槽交给某个页面：摆位、显示目标、收起其余，一次完成。 */
function presentPage(id: string, bounds: Bounds) {
  return enqueuePage(function () {
    return invoke('navigation:present', { body: { id, ...bounds } })
  })
}

function placePage(id: string, bounds: Bounds) {
  return enqueuePage(function () {
    return invoke('navigation:place', { body: { id, ...bounds } })
  })
}

/** 地址建议浮层。它是独立子 WebView，盖在网页上面，网页不动。 */
function openPopup(bounds: Bounds) {
  return invoke('navigation:popup', { body: { open: true, ...bounds } })
}

function closePopup() {
  return invoke('navigation:popup', { body: { open: false, x: 0, y: 0, width: 0, height: 0 } })
}

function closePage(id: string) {
  return invoke('navigation:close', { body: { id } })
}

function suspendPages() {
  return enqueuePage(function () {
    return invoke('navigation:suspend')
  })
}

function navigatePage(id: string, url: string) {
  return invoke('navigation:navigate', { body: { id, url } })
}

function historyPage(id: string, direction: 'back' | 'forward') {
  return invoke('navigation:navigate', { body: { id, direction } })
}

function reloadPage(id: string) {
  return invoke('navigation:navigate', { body: { id, direction: 'reload' } })
}

function openDevtools(id: string) {
  return invoke('navigation:devtools', { body: { id } })
}

function readExtensions() {
  return invoke<ExtensionsResult>('navigation:extensions', { body: { action: 'read' } })
}

function importExtension(path: string) {
  return invoke<ExtensionsResult>('navigation:extensions', {
    body: { action: 'import', path }
  })
}

function removeExtension(name: string) {
  return invoke<ExtensionsResult>('navigation:extensions', {
    body: { action: 'remove', name }
  })
}

const SUGGEST_ROW = 32
const SUGGEST_PAD = 12
const SUGGEST_ITEM_GAP = 4
const SUGGEST_BORDER = 1
/** 浮层比列表多出来的一圈，用来装阴影。 */
const SUGGEST_SHADOW = 10

const SUGGEST_FRAME = 'suggest://frame'
const SUGGEST_READY = 'suggest://ready'
const SUGGEST_PICK = 'suggest://pick'
const SUGGEST_DISMISS = 'suggest://dismiss'

interface SuggestRow {
  label: string
  url: string
}

interface SuggestFrame {
  open: boolean
  x: number
  y: number
  width: number
  height: number
  rows: SuggestRow[]
  active: number
}

interface CompleteItem {
  id: string
  q: string
  u: string
  t: string
}

function completeAddress(qry: string) {
  return invoke<{ s: CompleteItem[] }>('navigation:complete', { body: { qry } })
}

export {
  closePopup,
  closePage,
  suspendPages,
  historyPage,
  reloadPage,
  importExtension,
  navigatePage,
  openPopup,
  completeAddress,
  openDevtools,
  openPage,
  placePage,
  presentPage,
  readExtensions,
  readLivePages,
  removeExtension,
  SUGGEST_BORDER,
  SUGGEST_DISMISS,
  SUGGEST_FRAME,
  SUGGEST_ITEM_GAP,
  SUGGEST_PAD,
  SUGGEST_PICK,
  SUGGEST_READY,
  SUGGEST_ROW,
  SUGGEST_SHADOW
}
export type { Bounds, ExtensionsResult, LivePage, OpenedPage, SuggestFrame, SuggestRow }
