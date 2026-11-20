/**
 * 右栏自载预览的只读快照：主窗发布，嵌套壳读取。
 *
 * 为什么需要它：右栏 browser webview **不配** capability 的 `remote.urls`
 * （见 `src-tauri/src/browser/mod.rs` 的安全边界），一条 Tauri 命令都调不通；
 * 而镜像 / 磁贴这些领域实体只存在 SQLite 里。于是自载页永远是一面空墙。
 *
 * 两条通道，覆盖两种「打开本应用」的场景：
 *
 * 1. **同源 localStorage**：同一实例、同一 origin（主窗与右栏 tab 共用同一个
 *    WebView2 profile）时直接读。
 * 2. **dev server 中继**（仅 `import.meta.env.DEV`）：开发时常见的是拿**另一个
 *    实例**的面板去打开 `http://localhost:8200` —— 跨 profile、跨 origin，
 *    localStorage 过不去，于是由 vite 端点搬运**主窗 POST 上来的最后一份快照**
 *    （实现见 `apps/client/vite.preview-wall.ts`）。中继自己不读库、不做数据加工：
 *    预览只该复述主窗的正常逻辑产物，否则自调试时看到的差异分不清是预览产物还是
 *    真 bug。没有主窗在跑时是空墙（overview 有兜底提示）。
 *
 * 方向是单向的：主窗发布，嵌套壳只读。嵌套壳里的写操作仍然会失败 ——
 * 这是刻意的（预览不该能改库）。快照只是**缓存**，真相仍在 SQLite。
 */
import { isMainShell } from '@/features/window/shell-mode'
import { useMirrorStore } from '@/stores/mirror'

const SNAPSHOT_KEY = 'cogito:preview:mirror-wall'
const RELAY_PATH = '/__cogito/preview-wall'
/** 中继是拉模式：dev server 没有推送通道，2s 足够让调试时看到改动 */
const RELAY_POLL_MS = 2000

interface MirrorWallSnapshot {
  /** 发布时刻（ms），便于排查「看到的是旧墙」 */
  at: number
  mirrors: Mirror[]
  active: Mirror | null
  magneticTiles: MagneticTile[]
}

let lastPublished = ''
let lastAdopted = ''
/** 嵌套壳是否真的拿到过一份有内容的快照（overview 的兜底提示据此判断） */
let hasAdoptedWall = false

function signatureOf(snapshot: MirrorWallSnapshot): string {
  return JSON.stringify({
    mirrors: snapshot.mirrors,
    active: snapshot.active,
    magneticTiles: snapshot.magneticTiles
  })
}

/** 外部来的 JSON 一律先过这一层：字段不对就当没有，别把脏数据灌进 store */
function normalize(raw: unknown): MirrorWallSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const parsed = raw as Partial<MirrorWallSnapshot>
  if (!Array.isArray(parsed.magneticTiles)) return null
  return {
    at: typeof parsed.at === 'number' ? parsed.at : 0,
    mirrors: Array.isArray(parsed.mirrors) ? parsed.mirrors : [],
    active: parsed.active ?? null,
    magneticTiles: parsed.magneticTiles
  }
}

function buildSnapshot(): MirrorWallSnapshot {
  const state = useMirrorStore.getState()
  return {
    at: Date.now(),
    mirrors: state.mirrors,
    active: state.active.mirror,
    magneticTiles: state.magneticTiles
  }
}

/* ------------------------------ 通道 1：localStorage ------------------------------ */

function readMirrorWall(): MirrorWallSnapshot | null {
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_KEY)
    if (!raw) return null
    return normalize(JSON.parse(raw))
  } catch (error) {
    console.warn('[preview] 读取墙面快照失败', error)
    return null
  }
}

/* ------------------------------ 通道 2：dev server 中继 ------------------------------ */

/** 只有 dev server 的页面能跟它说话；打包版里 `import.meta.env.DEV` 是 false，一条请求都不发 */
function canUseRelay(): boolean {
  return import.meta.env.DEV
}

/** 主窗 → dev server。失败只可能是「这页不是 dev server 里的」，不值得打扰用户 */
async function pushToRelay(snapshot: MirrorWallSnapshot): Promise<void> {
  try {
    await fetch(RELAY_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot)
    })
  } catch (error) {
    // 面板里打开的页面 / 非 dev 环境下没有这个端点：预览墙降级，主窗不受影响
    console.debug('[preview] 推送墙面快照失败', error)
  }
}

/** dev server → 页面。204 = 还没有人发布过 */
async function fetchFromRelay(): Promise<MirrorWallSnapshot | null> {
  try {
    const response = await fetch(RELAY_PATH, { cache: 'no-store' })
    if (response.status !== 200) return null
    return normalize(await response.json())
  } catch (error) {
    // 2s 一次的轮询，失败也只是这一轮没拉到：别把 console 刷成噪音
    console.debug('[preview] 拉取墙面快照失败，本轮按「没有数据」处理', error)
    return null
  }
}

/* ------------------------------ 发布 / 采用 ------------------------------ */

/**
 * 主窗常驻：把墙面状态同步出去（只在数据真变了的时候写 / 发）。
 * 返回取消订阅函数。
 */
function startPublishingMirrorWall(): () => void {
  // 正式包不需要预览：嵌套壳都不存在，快照没有消费者 —— 一次都不写
  if (!import.meta.env.DEV) return function noop() {}
  // 只有真主窗发布。同一份包也会在 overlay 窗里跑（`url: "/overlay"`），而 overlay
  // 从不 `toInitialize()` 镜像 store —— 它发出来的是一面**空墙**，会覆盖 localStorage
  // 与 dev 中继，于是嵌套壳永远看不到磁贴。非主窗直接不装这个发布器。
  if (!isMainShell()) return function noop() {}

  let isWarned = false

  function publish(): void {
    const snapshot = buildSnapshot()
    // 启动瞬间 store 还没 `toInitialize()`：这时候发出去的是空墙，别发。
    // store 数据到位时订阅会再调一次 publish。
    if (snapshot.mirrors.length === 0 && snapshot.magneticTiles.length === 0) return
    const signature = signatureOf(snapshot)
    if (signature === lastPublished) return
    lastPublished = signature

    try {
      window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot))
    } catch (error) {
      // 隐私模式 / 配额满：预览墙降级成空墙，不影响主窗
      if (!isWarned) {
        isWarned = true
        console.warn('[preview] 写入墙面快照失败', error)
      }
    }

    if (canUseRelay()) void pushToRelay(snapshot)
  }

  publish()
  return useMirrorStore.subscribe(publish)
}

/** 嵌套壳：把快照灌进 store（active 一起灌，墙才能定住是哪个镜像） */
function adoptMirrorWall(snapshot: MirrorWallSnapshot | null): boolean {
  if (!snapshot) return false
  const signature = signatureOf(snapshot)
  // 中继是 2s 轮询：没变就别改 store，否则整墙每 2s 重渲染一次
  if (signature === lastAdopted) return false
  lastAdopted = signature
  if (snapshot.mirrors.length > 0 || snapshot.magneticTiles.length > 0) hasAdoptedWall = true

  const store = useMirrorStore.getState()
  store.toUpdateMirrors(snapshot.mirrors)
  if (snapshot.active) {
    store.toCommitMirrorPayload({ mirror: snapshot.active, magneticTiles: snapshot.magneticTiles })
  } else {
    store.toUpdateMagneticTiles(snapshot.magneticTiles)
  }
  return true
}

/**
 * 嵌套壳：先灌一次快照，再跟后续变更。
 *
 * - `storage` 事件只在**同源的其它 document** 里触发 —— 主窗写、嵌套壳读，正好是它；
 * - 中继走轮询：开发时拿别的实例的面板打开 dev server 地址，这条通道才通。
 */
function adoptMirrorWallSnapshot(): () => void {
  // 正式包不认嵌套壳（见 shell-mode 的 EMBEDDED_SUPPORTED），这里本来就不会被调用；
  // 真被调到也什么都不做，别去碰 localStorage / 中继
  if (!import.meta.env.DEV) return function noop() {}

  adoptMirrorWall(readMirrorWall())

  let stopped = false

  function pullFromRelay(): void {
    void fetchFromRelay().then(function (snapshot) {
      if (stopped) return
      if (snapshot) adoptMirrorWall(snapshot)
    })
  }

  let pollTimer: number | undefined
  if (canUseRelay()) {
    pullFromRelay()
    pollTimer = window.setInterval(pullFromRelay, RELAY_POLL_MS)
  }

  function onStorage(event: StorageEvent): void {
    if (event.key !== null && event.key !== SNAPSHOT_KEY) return
    adoptMirrorWall(readMirrorWall())
  }

  window.addEventListener('storage', onStorage)
  return function () {
    stopped = true
    if (pollTimer !== undefined) window.clearInterval(pollTimer)
    window.removeEventListener('storage', onStorage)
  }
}

/** 嵌套壳是否已经拿到墙面（灌过 / 中继拉到 / localStorage 本来就有） */
function hasMirrorWallSnapshot(): boolean {
  if (!import.meta.env.DEV) return false
  return hasAdoptedWall || readMirrorWall() !== null
}

export {
  adoptMirrorWallSnapshot,
  hasMirrorWallSnapshot,
  readMirrorWall,
  RELAY_PATH,
  SNAPSHOT_KEY,
  startPublishingMirrorWall
}
export type { MirrorWallSnapshot }
