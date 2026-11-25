/**
 * 应用壳模式：主窗 / 嵌套预览（右栏 browser webview 自载）/ 纯网页。
 *
 * 右栏子 webview **不配** capability `remote.urls`，没有 IPC。
 * 自载本应用时必须降级：不跑主窗 bootstrap、不碰窗口装饰 API。
 *
 * 为什么判定看 **webview** label 而不是 window label：右栏标签页是挂在主窗上的
 * 子 webview（`WebviewBuilder::add_child`），`getCurrentWindow().label` 依然是
 * `main`，只有 `getCurrentWebview().label` 是 `browser-<uuid>`。只看 window label
 * 会把嵌套壳当成主窗 —— 症状就是自载页里整片 `... not allowed by ACL`。
 *
 * 环境划分：嵌套预览只有 **dev** 有（`pnpm --filter @cogito/client dev:isolated`）。
 * 正式包不需要 embedded —— 右栏就是浏览器，不是调试台，见 `EMBEDDED_SUPPORTED`。
 */
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'

const EMBEDDED_QUERY = 'embedded'
const EMBEDDED_VALUE = '1'
const MAIN_WINDOW_LABEL = 'main'
const BROWSER_LABEL_PREFIX = 'browser-'

/**
 * 嵌套预览（右栏自载本应用 / `?embedded=1`）**只在 dev 存在**。
 *
 * 正式包的右栏是浏览器：没人要在里面自载本应用，而一旦自载，子 webview 没有
 * capability，只会换来整片 `... not allowed by ACL`。所以正式包里
 * `isEmbeddedShell()` 恒为 false —— 发布器 / 快照 / 兜底提示 / 「打开本应用」
 * 按钮都不是「判断后跳过」，而是被 `import.meta.env.DEV` 直接剪掉的死代码。
 */
const EMBEDDED_SUPPORTED = import.meta.env.DEV

/** SPA 路由丢掉 `?embedded=1` 后仍记住嵌套壳（禁 sessionStorage，只用内存） */
let isEmbeddedAdopted = false

function readEmbeddedQuery(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return new URLSearchParams(window.location.search).get(EMBEDDED_QUERY) === EMBEDDED_VALUE
  } catch (error) {
    console.warn('[shell-mode] 解析 embedded 查询失败', error)
    return false
  }
}

/** 右栏 browser 子 webview：能力表里没有 `remote.urls`，一条命令都调不通（与 dev/prod 无关） */
function isBrowserChildWebview(): boolean {
  return findWebviewLabelSafe().startsWith(BROWSER_LABEL_PREFIX)
}

/** 当前 webview label；读不到时回落到 window label（老版本 / 极端情况） */
function findWebviewLabelSafe(): string {
  try {
    return getCurrentWebview().label
  } catch (error) {
    console.warn('[shell-mode] 读不到 webview label', error)
  }
  try {
    return getCurrentWindow().label
  } catch (error) {
    console.warn('[shell-mode] 读不到窗口 label', error)
    return ''
  }
}

/** 是否跑在右栏自载 / `?embedded=1` 降级壳里 */
function isEmbeddedShell(): boolean {
  if (!EMBEDDED_SUPPORTED) return false
  if (typeof document !== 'undefined' && document.documentElement.dataset.shell === 'embedded') {
    return true
  }
  if (readEmbeddedQuery() || isEmbeddedAdopted) return true
  return isBrowserChildWebview()
}

/** 真主窗：webview label=main，且非 embedded */
function isMainShell(): boolean {
  if (isEmbeddedShell()) return false
  return findWebviewLabelSafe() === MAIN_WINDOW_LABEL
}

/**
 * 能不能调 Tauri 命令。
 *
 * 右栏 browser 子 webview 与 `?embedded=1` 降级壳**有运行时但没有 capability**，
 * 调什么都回 `... not allowed by ACL`。所以凡是要真调命令的地方都得用它：
 * 判定看**能力**（是不是 browser 子 webview / 嵌套壳），不看产品开关 —— 正式包里
 * 嵌套预览关掉了，但万一有人把本应用地址敲进右栏，也照样不能调命令、不该刷 ACL。
 */
function canUseTauriIpc(): boolean {
  return !isBrowserChildWebview() && !isEmbeddedShell()
}

/**
 * 嵌套壳里 withGlobalTauri 仍会注入 IPC：刷新/无 capability 时 Rust 回包找不到
 * callback，刷屏无意义。只吞这一条，其它 warn 照常。
 */
function softenEmbeddedTauriNoise() {
  if (typeof console === 'undefined' || typeof console.warn !== 'function') return
  const warn = console.warn.bind(console)
  console.warn = function (...args: unknown[]) {
    const head = args[0]
    if (
      typeof head === 'string' &&
      head.includes("[TAURI] Couldn't find callback id")
    ) {
      return
    }
    warn(...args)
  }
}

/**
 * 启动最早调用：把 `?embedded=1` 落到 `data-shell` + 内存标记，
 * 避免客户端路由丢掉 query 后误跑主窗逻辑。
 */
function adoptShellMode() {
  if (!EMBEDDED_SUPPORTED) return
  if (typeof document === 'undefined') return
  let embedded = false
  if (readEmbeddedQuery() || isEmbeddedAdopted) {
    embedded = true
  } else if (isBrowserChildWebview()) {
    embedded = true
  }
  if (!embedded) return
  document.documentElement.dataset.shell = 'embedded'
  isEmbeddedAdopted = true
  softenEmbeddedTauriNoise()
}

/** 右栏「打开本应用」用的自调试地址（带 embedded） */
function findSelfDebugUrl(path = '/agent/chat'): string {
  const url = new URL(path, window.location.origin)
  url.searchParams.set(EMBEDDED_QUERY, EMBEDDED_VALUE)
  return url.href
}

export {
  adoptShellMode,
  canUseTauriIpc,
  findSelfDebugUrl,
  isEmbeddedShell,
  isMainShell
}
