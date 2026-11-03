/**
 * 浏览器面板的 IPC 封装。
 *
 * 只有**主 webview** 能调：浏览器 tab 加载的是远程 origin，没有配 capability 的
 * `remote.urls`，所以那边的页面调不到任何命令 —— agent 想操作浏览器，必须由
 * 主 webview 代为下发（见 `browser_*` agent 工具）。
 */
import { invoke } from '@tauri-apps/api/core'

import type { DeviceProfile } from './device'

interface BrowserTab {
  label: string
  url: string
  /** `document.title`；空串表示尚未读到，UI 回退 host */
  title?: string
  /** 设备模拟档案；`null` = 桌面态。Rust 是真相源，快照会原样带回。 */
  device: DeviceProfile | null
}

/** `forceNew` 默认 true：UI 开页总新建；agent 工具面自己走 bridge 复用逻辑 */
async function openBrowserTab(url: string, forceNew = true): Promise<BrowserTab> {
  return invoke<BrowserTab>('browser_open', { url, forceNew })
}

async function closeBrowserTab(label: string): Promise<void> {
  await invoke('browser_close', { label })
}

async function activateBrowserTab(label: string): Promise<void> {
  await invoke('browser_activate', { label })
}

async function navigateBrowser(label: string, url: string): Promise<void> {
  await invoke('browser_navigate', { label, url })
}

async function fetchBrowserUrl(label: string): Promise<string> {
  return invoke<string>('browser_current_url', { label })
}

async function reloadBrowser(label: string): Promise<void> {
  await invoke('browser_reload', { label })
}

async function stepBrowserHistory(label: string, backward: boolean): Promise<void> {
  await invoke('browser_history', { label, backward })
}

interface BrowserHistoryState {
  canGoBack: boolean
  canGoForward: boolean
}

async function fetchBrowserHistoryState(label: string): Promise<BrowserHistoryState> {
  return invoke<BrowserHistoryState>('browser_history_state', { label })
}

interface BrowserNavigationEntry {
  url: string
  title: string
}

/** 当前 tab 会话历史（关 tab 即消失） */
async function fetchBrowserNavigationHistory(label: string): Promise<BrowserNavigationEntry[]> {
  return invoke<BrowserNavigationEntry[]>('browser_navigation_history', { label })
}

/** 打开这个 tab 的 DevTools（独立窗口） */
async function openBrowserDevtools(label: string): Promise<void> {
  await invoke('browser_devtools', { label })
}

/** 单项能力探测结果 */
interface ProbeItem {
  ok: boolean
  error?: string
}

/** `Runtime.evaluate` 读回的视口事实 —— 「模拟到底生效没有」的唯一判据 */
interface DeviceReadback {
  innerWidth: number
  innerHeight: number
  dpr: number
  pointerCoarse: boolean
  hoverNone?: boolean
  /** `navigator.userAgentData.mobile`；浏览器不支持 UA-CH 时为 null */
  mobileUaData?: boolean | null
  userAgent?: string
}

interface BrowserProbe {
  evaluate: ProbeItem
  network: ProbeItem
  /** 真实拦截往返：临时 mock 一条请求再从页面里 fetch 回来 */
  intercept: ProbeItem & { echo?: string }
  /** 截图成功时带 base64 长度（完整图太大，不进探针结果） */
  screenshot: ProbeItem & { base64Length?: number }
  /** 设备模拟：Emulation 域可用性 + 实读视口 + 最终采用的缩放通道 */
  emulation: ProbeItem & {
    canEmulate?: boolean
    scaleAccepted?: boolean
    scaleChannel?: 'cdp' | 'zoom' | 'none'
    readback?: DeviceReadback
  }
}

/** `browser_device_set` 的返回：应用后的实际读数（不是我们发的参数） */
interface BrowserDeviceResult {
  tab: string
  device: DeviceProfile | null
  fit?: number
  scaleChannel?: 'cdp' | 'zoom' | 'none'
  readback?: DeviceReadback
}

/** 诊断：确认 CDP 通道（读取 / 网络 / 拦截 / 截图）在本机可用 */
async function probeBrowser(label: string): Promise<BrowserProbe> {
  return invoke<BrowserProbe>('browser_probe', { label })
}

interface BrowserOutlineItem {
  tag: string
  type: string | null
  text: string
  disabled: boolean
  href: string | null
  selector: string
}

interface BrowserReadResult {
  url: string
  title: string
  items?: BrowserOutlineItem[]
  total?: number
  skippedHidden?: number
  text?: string
  truncated?: boolean
}

/** agent 读页面：`outline` 拿可交互元素，`text` 拿正文 */
async function readBrowserPage(
  label: string,
  mode: 'outline' | 'text' = 'outline',
  limit = 60
): Promise<BrowserReadResult> {
  return invoke<BrowserReadResult>('browser_agent_read', { label, mode, limit })
}

/** 截图：返回原始 base64 + mime（data URL 自己拼，少传一份 base64） */
async function screenshotBrowser(
  label: string,
  format?: 'png' | 'jpeg'
): Promise<{ mimeType: string; base64: string }> {
  return invoke<{ mimeType: string; base64: string }>('browser_agent_screenshot', {
    label,
    format: format ?? null
  })
}

/** 浏览器快照：刷新页面后用来把仍然活着的 webview 重新挂回 UI */
interface BrowserSnapshot {
  tabs: BrowserTab[]
  active: string | null
  layout: {
    x: number
    y: number
    width: number
    height: number
    hasBeenLaidOut: boolean
    wantsVisible: boolean
  }
}

async function fetchBrowserSnapshot(): Promise<BrowserSnapshot> {
  return invoke<BrowserSnapshot>('browser_snapshot')
}

/** 页面刷新后重新拉回已有的标签页（webview 由 Rust 持有，不会跟着前端消失） */
async function hydrateBrowserTabs(): Promise<BrowserSnapshot> {
  const snapshot = await fetchBrowserSnapshot()
  // 新页面还没量过尺寸、也没有任何面板在显示 —— 先把可见性收掉，
  // 否则刷新后 webview 会悬在界面上方遮住 UI，直到用户自己点回浏览器页签。
  if (snapshot.tabs.length > 0) {
    await writeBrowserVisible(false).catch(function (error: unknown) {
      console.warn('browser: 回灌时收回可见性失败', error)
    })
  }
  return snapshot
}

/** 一条网络请求（同一 requestId 的多个 CDP 事件已合并） */
interface NetworkEntry {
  id: string
  method: string
  url: string
  kind: string | null
  status: number | null
  mime: string | null
  size: number | null
  durationMs: number | null
}

/** 网络列表：只包含开启记录之后发生的请求，最新的在前 */
async function listBrowserNetwork(
  label: string,
  filter?: string,
  limit = 200
): Promise<NetworkEntry[]> {
  return invoke<NetworkEntry[]>('browser_network_list', { label, filter, limit })
}

interface InterceptRule {
  pattern: string
  action: 'block' | 'mock'
  status?: number
  body?: string
  mime?: string
}

/** 设置拦截规则；传空数组 = 关闭。返回生效条数。 */
async function setBrowserInterceptRules(
  label: string,
  rules: InterceptRule[]
): Promise<number> {
  return invoke<number>('browser_intercept_set', { label, rules })
}

/** 当前生效的规则（agent 也会改，UI 进视图时用它对齐） */
async function listBrowserInterceptRules(label: string): Promise<InterceptRule[]> {
  return invoke<InterceptRule[]>('browser_intercept_list', { label })
}

/** 上报内容区 rect（CSS px，相对窗口客户区；Tauri 会按 scale factor 换成物理像素） */
async function writeBrowserRect(
  x: number,
  y: number,
  width: number,
  height: number
): Promise<void> {
  await invoke('browser_layout', { x, y, width, height })
}

/** 前端要弹浮层 / 切走页签时让位 —— 原生子 webview 永远盖在 HTML 之上 */
async function writeBrowserVisible(visible: boolean): Promise<void> {
  await invoke('browser_visible', { visible })
}

/** CDP Overlay 元素拾取（VS Code 同款） */
async function startBrowserPicker(label: string): Promise<void> {
  await invoke('browser_picker_start', { label })
}

async function stopBrowserPicker(label: string): Promise<void> {
  await invoke('browser_picker_stop', { label })
}

/**
 * 设置 / 退出设备模拟。
 *
 * `device = null` 退出；`fit` 是设备盒子相对面板的缩放比（前端算，Rust 只夹取）。
 * 返回的是页面**读回**的视口，不是我们下发的参数 —— 界面角标用真的那份。
 */
async function setBrowserDevice(
  label: string,
  device: DeviceProfile | null,
  fit: number
): Promise<BrowserDeviceResult> {
  return invoke<BrowserDeviceResult>('browser_device_set', { label, device, fit })
}

/** 当前 tab 的设备档案（agent 也可能改过，UI 靠它对齐） */
async function getBrowserDevice(label: string): Promise<DeviceProfile | null> {
  return invoke<DeviceProfile | null>('browser_device_get', { label })
}

interface PickedBrowserRect {
  x: number
  y: number
  width: number
  height: number
}

interface PickedBrowserShot {
  mimeType: string
  base64: string
}

/** `browser://element-picked` 载荷 */
interface PickedBrowserElement {
  label: string
  url: string
  tag: string
  selector: string
  text: string
  outerHtml: string
  rect: PickedBrowserRect
  screenshot?: PickedBrowserShot
}

interface BrowserPickerActiveEvent {
  label: string
  active: boolean
}

export {
  activateBrowserTab,
  closeBrowserTab,
  fetchBrowserHistoryState,
  fetchBrowserNavigationHistory,
  fetchBrowserUrl,
  getBrowserDevice,
  hydrateBrowserTabs,
  listBrowserInterceptRules,
  listBrowserNetwork,
  navigateBrowser,
  openBrowserDevtools,
  openBrowserTab,
  probeBrowser,
  readBrowserPage,
  reloadBrowser,
  screenshotBrowser,
  setBrowserDevice,
  setBrowserInterceptRules,
  startBrowserPicker,
  stepBrowserHistory,
  stopBrowserPicker,
  writeBrowserRect,
  writeBrowserVisible
}
export type {
  BrowserDeviceResult,
  BrowserHistoryState,
  BrowserNavigationEntry,
  BrowserOutlineItem,
  BrowserPickerActiveEvent,
  BrowserProbe,
  BrowserReadResult,
  BrowserSnapshot,
  BrowserTab,
  DeviceReadback,
  InterceptRule,
  NetworkEntry,
  PickedBrowserElement,
  PickedBrowserRect,
  PickedBrowserShot,
  ProbeItem
}
