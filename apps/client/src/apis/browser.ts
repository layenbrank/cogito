/**
 * 浏览器面板的 IPC 封装。
 *
 * 只有**主 webview** 能调：浏览器 tab 加载的是远程 origin，没有配 capability 的
 * `remote.urls`，所以那边的页面调不到任何命令 —— agent 想操作浏览器，必须由
 * 主 webview 代为下发（见 `browser_*` agent 工具）。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

import type { DeviceProfile } from '@/features/browser/device'

interface BrowserTab {
  label: string
  url: string
  /** `document.title`；空串表示尚未读到，UI 回退 host */
  title?: string
  /** 设备模拟档案；`null` = 桌面态。Rust 是真相源，快照会原样带回。 */
  device: DeviceProfile | null
}

/** `forceNew` 默认 true：UI 开页总新建；agent 工具面自己走 bridge 复用逻辑 */
async function POST_BROWSER_TAB(url: string, forceNew = true): Promise<BrowserTab> {
  return invoke<BrowserTab>(CHANNELS.BROWSER.OPEN, { url, forceNew })
}

async function DELETE_BROWSER_TAB(label: string): Promise<void> {
  await invoke(CHANNELS.BROWSER.CLOSE, { label })
}

async function PUT_BROWSER_TAB_ACTIVE(label: string): Promise<void> {
  await invoke(CHANNELS.BROWSER.ACTIVATE, { label })
}

async function PUT_BROWSER_URL(label: string, url: string): Promise<void> {
  await invoke(CHANNELS.BROWSER.NAVIGATE, { label, url })
}

async function GET_BROWSER_URL(label: string): Promise<string> {
  return invoke<string>(CHANNELS.BROWSER.CURRENT_URL, { label })
}

async function POST_BROWSER_RELOAD(label: string): Promise<void> {
  await invoke(CHANNELS.BROWSER.RELOAD, { label })
}

async function POST_BROWSER_HISTORY(label: string, backward: boolean): Promise<void> {
  await invoke(CHANNELS.BROWSER.HISTORY, { label, backward })
}

interface BrowserHistoryState {
  canGoBack: boolean
  canGoForward: boolean
}

async function GET_BROWSER_HISTORY(label: string): Promise<BrowserHistoryState> {
  return invoke<BrowserHistoryState>(CHANNELS.BROWSER.HISTORY_STATE, { label })
}

interface BrowserNavigationEntry {
  url: string
  title: string
}

/** 当前 tab 会话历史（关 tab 即消失） */
async function GET_BROWSER_NAVIGATION(label: string): Promise<BrowserNavigationEntry[]> {
  return invoke<BrowserNavigationEntry[]>(CHANNELS.BROWSER.NAVIGATION_HISTORY, { label })
}

/** 打开这个 tab 的 DevTools（独立窗口） */
async function POST_BROWSER_DEVTOOLS(label: string): Promise<void> {
  await invoke(CHANNELS.BROWSER.DEVTOOLS, { label })
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
async function GET_BROWSER_PROBE(label: string): Promise<BrowserProbe> {
  return invoke<BrowserProbe>(CHANNELS.BROWSER.PROBE, { label })
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
async function GET_BROWSER_PAGE(
  label: string,
  mode: 'outline' | 'text' = 'outline',
  limit = 60,
  maxChars = 8000
): Promise<BrowserReadResult> {
  // `limit` 只管 outline 条目数，`maxChars` 只管 text 正文字符数（Rust 侧默认 8000）
  return invoke<BrowserReadResult>(CHANNELS.BROWSER.AGENT_READ, {
    label,
    mode,
    limit,
    maxChars
  })
}

/** 截图：返回原始 base64 + mime（data URL 自己拼，少传一份 base64） */
interface BrowserShot {
  mimeType: string
  base64: string
  /** 实际出图通道：控件位图 / 校正后的 CDP / 所在屏幕兜底 */
  mode?: 'preview' | 'surface' | 'os'
}

async function POST_BROWSER_SCREENSHOT(
  label: string,
  format?: 'png' | 'jpeg'
): Promise<BrowserShot> {
  return invoke<BrowserShot>(CHANNELS.BROWSER.AGENT_SCREENSHOT, {
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

async function GET_BROWSER_SNAPSHOT(): Promise<BrowserSnapshot> {
  return invoke<BrowserSnapshot>(CHANNELS.BROWSER.SNAPSHOT)
}

/**
 * hydrate / 重建会把 Rust webview 先藏掉；前端 `useBrowserRect` 必须同步清掉
 * `lastVisible`，否则会以为「已可见」而跳过 leavePause → 右栏永久白屏。
 */
const BROWSER_VISIBILITY_RESET = 'cogito:browser-visibility-reset'

/** 页面刷新后重新拉回已有的标签页（webview 由 Rust 持有，不会跟着前端消失） */
async function GET_BROWSER_TABS(): Promise<BrowserSnapshot> {
  const snapshot = await GET_BROWSER_SNAPSHOT()
  // 新页面还没量过尺寸、也没有任何面板在显示 —— 先把可见性收掉，
  // 否则刷新后 webview 会悬在界面上方遮住 UI，直到用户自己点回浏览器页签。
  if (snapshot.tabs.length > 0) {
    await PUT_BROWSER_VISIBLE(false).catch(function (error: unknown) {
      console.warn('browser: 回灌时收回可见性失败', error)
    })
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(BROWSER_VISIBILITY_RESET))
    }
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
async function GET_BROWSER_NETWORK(
  label: string,
  filter?: string,
  limit = 200
): Promise<NetworkEntry[]> {
  return invoke<NetworkEntry[]>(CHANNELS.BROWSER.NETWORK_LIST, { label, filter, limit })
}

/** 一条拦截规则：与 Rust `browser::intercept::Rule` 同形（camelCase） */
interface InterceptRule {
  pattern: string
  action: 'block' | 'mock' | 'edit'
  status?: number
  body?: string
  mime?: string
  /** edit：把请求改发到这个地址 */
  url?: string
  /** edit：覆盖 / 追加请求头 */
  headers?: { name: string; value: string }[]
  /** edit：替换请求体 */
  postData?: string
}

/** `browser_intercept_set` / `browser_intercept_status` 的返回：生效条数 + 实测计数 */
interface InterceptStatus {
  rules: number
  /** 收到 `Fetch.requestPaused` 的次数（0 = 拦截通道没通） */
  paused: number
  /** 命中规则并真的改写 / 掐断的次数 */
  matched: number
}

/** 设置拦截规则；传空数组 = 关闭。返回生效条数 + paused / matched 计数。 */
async function PUT_BROWSER_INTERCEPT(
  label: string,
  rules: InterceptRule[]
): Promise<InterceptStatus> {
  return invoke<InterceptStatus>(CHANNELS.BROWSER.UPDATE_INTERCEPT, { label, rules })
}

/**
 * 当前拦截计数（面板刷新时读）。
 *
 * `paused` 是「`Fetch.requestPaused` 真的来了」的证据，`matched` 是「规则真的命中」的证据：
 * 两个都停在 0 时不要怀疑页面，先看拦截通道本身。
 */
async function GET_BROWSER_INTERCEPT_STATUS(label: string): Promise<InterceptStatus> {
  return invoke<InterceptStatus>(CHANNELS.BROWSER.INTERCEPT_STATUS, { label })
}

/** 当前生效的规则（agent 也会改，UI 进视图时用它对齐） */
async function GET_BROWSER_INTERCEPT_RULES(label: string): Promise<InterceptRule[]> {
  return invoke<InterceptRule[]>(CHANNELS.BROWSER.INTERCEPT_LIST, { label })
}

/** 上报内容区 rect（CSS px，相对窗口客户区；Tauri 会按 scale factor 换成物理像素） */
async function PUT_BROWSER_LAYOUT(
  x: number,
  y: number,
  width: number,
  height: number
): Promise<void> {
  await invoke(CHANNELS.BROWSER.LAYOUT, { x, y, width, height })
}

/** 前端要弹浮层 / 切走页签时让位 —— 原生子 webview 永远盖在 HTML 之上 */
async function PUT_BROWSER_VISIBLE(visible: boolean): Promise<void> {
  await invoke(CHANNELS.BROWSER.VISIBLE, { visible })
}

/** CDP Overlay 元素拾取（VS Code 同款） */
async function POST_BROWSER_PICKER(label: string): Promise<void> {
  await invoke(CHANNELS.BROWSER.PICKER_START, { label })
}

async function DELETE_BROWSER_PICKER(label: string): Promise<void> {
  await invoke(CHANNELS.BROWSER.PICKER_STOP, { label })
}

/**
 * 设置 / 退出设备模拟。
 *
 * `device = null` 退出；`fit` 是设备盒子相对面板的缩放比（前端算，Rust 只夹取）。
 * 返回的是页面**读回**的视口，不是我们下发的参数 —— 界面角标用真的那份。
 */
async function PUT_BROWSER_DEVICE(
  label: string,
  device: DeviceProfile | null,
  fit: number
): Promise<BrowserDeviceResult> {
  return invoke<BrowserDeviceResult>(CHANNELS.BROWSER.UPDATE_DEVICE, { label, device, fit })
}

/** 当前 tab 的设备档案（agent 也可能改过，UI 靠它对齐） */
async function GET_BROWSER_DEVICE(label: string): Promise<DeviceProfile | null> {
  return invoke<DeviceProfile | null>(CHANNELS.BROWSER.FIND_DEVICE, { label })
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
  PUT_BROWSER_TAB_ACTIVE,
  BROWSER_VISIBILITY_RESET,
  DELETE_BROWSER_TAB,
  GET_BROWSER_HISTORY,
  GET_BROWSER_INTERCEPT_STATUS,
  GET_BROWSER_NAVIGATION,
  GET_BROWSER_URL,
  GET_BROWSER_DEVICE,
  GET_BROWSER_TABS,
  GET_BROWSER_INTERCEPT_RULES,
  GET_BROWSER_NETWORK,
  PUT_BROWSER_URL,
  POST_BROWSER_DEVTOOLS,
  POST_BROWSER_TAB,
  GET_BROWSER_PROBE,
  GET_BROWSER_PAGE,
  POST_BROWSER_RELOAD,
  POST_BROWSER_SCREENSHOT,
  PUT_BROWSER_DEVICE,
  PUT_BROWSER_INTERCEPT,
  POST_BROWSER_PICKER,
  POST_BROWSER_HISTORY,
  DELETE_BROWSER_PICKER,
  PUT_BROWSER_LAYOUT,
  PUT_BROWSER_VISIBLE
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
  InterceptStatus,
  NetworkEntry,
  PickedBrowserElement,
  PickedBrowserRect,
  PickedBrowserShot,
  ProbeItem
}
