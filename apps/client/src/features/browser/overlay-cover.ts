/**
 * 原生子 webview 之上「有东西盖着」的判定。
 *
 * 右栏页面是**窗口级原生子 webview**，永远画在 HTML 之上（见 `rect.ts` 头注）。
 * 所以 HTML 浮层压在页面上时，必须由前端主动让位：先截一帧 → 截图铺满占位区 →
 * 再 `visible(false)` 把原生层藏起来。判定「到底有没有东西盖着」有两条路：
 *
 * 1. **显式标记** `data-webview="false"`（`@cogito/design/lib/webview-cover`
 *    的唯一契约；DropDown / Popover / Dialog / Select / Combobox 自带，手写浮层自己加）；
 * 2. **hit-test 兜底**：按 3×3 采样点问 `document.elementsFromPoint`「画面最上面那个
 *    HTML 元素是谁」——不是占位区本身、不在占位区里、也不是占位区的祖先，就说明有浮层
 *    盖在页面上。
 *
 * 为什么必须有第 2 条：第 1 条是**手写约定**，漏一处就是「功能看起来没做」。
 * 地址栏建议列表就漏过——它是个手写 `<ul>`，没打标记，于是整块列表被页面盖住，
 * 现象是「只有在没有任何标签页（没有 webview）时才看得到历史记录」。
 *
 * VS Code 是同一套思路（`src/vs/workbench/contrib/browserView/electron-browser/`）：
 * - `overlayManager.ts`：维护菜单 / quick input / hover / 对话框 / 通知 / context-view
 *   的清单，并用 `elementsFromPoint` 做 z 序 hit-test，只在「真正画在上面」时上报；
 * - `webContentsViewHost.ts`：`_shouldShowPage() = visible && !overlayObscured && …`，
 *   让位时铺截图 + 15% 压暗，并每 1s 重拍一帧（截图不会过期）。
 *
 * 也就是说：**任何**画在页面上的 HTML 都该让页面让位，而不是逐处记得打标记。
 */
import { WEBVIEW_COVER_SELECTOR } from '@cogito/design/lib/webview-cover'

type HitTest = (x: number, y: number) => readonly Element[]

interface CoverOptions {
  /** 测试注入用：默认走 `document.elementsFromPoint` */
  hitTest?: HitTest
}

interface RectLike {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/** 采样点内缩：贴边采样容易落在圆角 / 滚动条上，反而漏判 */
const SAMPLE_INSET = 8
/** 小于这个尺寸就只采中心点 */
const SAMPLE_MIN_SIZE = SAMPLE_INSET * 3 + 1

function toRectLike(rect: RectLike): RectLike {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right ?? rect.left + rect.width,
    bottom: rect.bottom ?? rect.top + rect.height,
    width: rect.width,
    height: rect.height
  }
}

function intersects(a: RectLike, b: RectLike): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function styleOf(element: Element): CSSStyleDeclaration {
  const view = element.ownerDocument?.defaultView ?? window
  return view.getComputedStyle(element)
}

/** 透明 / 隐藏 / 点了会穿透的图层不算「盖住」 */
function isPassthrough(element: Element): boolean {
  const style = styleOf(element)
  if (style.display === 'none' || style.visibility === 'hidden') return true
  return style.pointerEvents === 'none'
}

/** 这条链路里真正画在页面上的元素所属的浮层，是否打过硬标记 */
function hasCoverMarker(element: Element): boolean {
  return element.closest(WEBVIEW_COVER_SELECTOR) !== null
}

/**
 * 显式标记的浮层：与占位区相交即让位。
 *
 * 标记比 hit-test 更「早知道」——`pointer-events: none` 的浮层（比如纯提示层）
 * hit-test 看不见，但视觉上确实压着页面。
 */
function findMarkedCover(surface: RectLike): HTMLElement | null {
  if (surface.width < 1 || surface.height < 1) return null
  const layers = document.querySelectorAll<HTMLElement>(WEBVIEW_COVER_SELECTOR)
  for (const layer of layers) {
    if (layer.hidden || layer.getAttribute('aria-hidden') === 'true') continue
    if (isPassthrough(layer)) continue
    const rect = toRectLike(layer.getBoundingClientRect())
    if (rect.width < 1 || rect.height < 1) continue
    if (intersects(rect, surface)) return layer
  }
  return null
}

/** 占位区内的采样点：3×3，内缩 `SAMPLE_INSET` */
function samplePoints(surface: RectLike): Array<{ x: number; y: number }> {
  const left = surface.left + SAMPLE_INSET
  const right = surface.right - SAMPLE_INSET
  const top = surface.top + SAMPLE_INSET
  const bottom = surface.bottom - SAMPLE_INSET
  if (surface.width < SAMPLE_MIN_SIZE || surface.height < SAMPLE_MIN_SIZE) {
    return [{ x: surface.left + surface.width / 2, y: surface.top + surface.height / 2 }]
  }
  const centerX = (left + right) / 2
  const centerY = (top + bottom) / 2
  return [
    { x: left, y: top },
    { x: centerX, y: top },
    { x: right, y: top },
    { x: left, y: centerY },
    { x: centerX, y: centerY },
    { x: right, y: centerY },
    { x: left, y: bottom },
    { x: centerX, y: bottom },
    { x: right, y: bottom }
  ]
}

function defaultHitTest(x: number, y: number): readonly Element[] {
  const doc = document
  if (typeof doc.elementsFromPoint === 'function') {
    return doc.elementsFromPoint(x, y)
  }
  // 老 / 精简环境没有 elementsFromPoint：退化成只拿最上面一个
  if (typeof doc.elementFromPoint === 'function') {
    const element = doc.elementFromPoint(x, y)
    return element ? [element] : []
  }
  return []
}

/**
 * hit-test：只要采样点上（z 序从前到后）出现「既不是占位区、也不在占位区里、
 * 又不是占位区祖先」的元素，就说明那一点被 HTML 盖住了。
 *
 * 走到占位区的祖先就停 —— 说明这点上占位区已经是画面最上层。
 */
function findHitTestCover(
  surface: HTMLElement,
  rect: RectLike,
  hitTest: HitTest
): HTMLElement | null {
  if (rect.width < 1 || rect.height < 1) return null
  for (const point of samplePoints(rect)) {
    const stack = hitTest(point.x, point.y)
    for (const element of stack) {
      // 占位区自己的图层（暂停截图 / 设备角标）
      if (element === surface || surface.contains(element)) continue
      // 已经走到占位区的祖先：这点上没有东西盖着
      if (element.contains(surface)) break
      if (isPassthrough(element)) continue
      return element as HTMLElement
    }
  }
  return null
}

/**
 * 占位区上是否压着 HTML 浮层；返回「压在页面上的那个元素」（用于日志 / 排查）。
 *
 * 顺序：显式标记 → hit-test。标记命中就不再采样，省掉每帧 9 次 hit-test。
 */
function findCoveringOverlay(surface: HTMLElement, options?: CoverOptions): HTMLElement | null {
  const rect = toRectLike(surface.getBoundingClientRect())
  const marked = findMarkedCover(rect)
  if (marked) return marked
  return findHitTestCover(surface, rect, options?.hitTest ?? defaultHitTest)
}

export { findCoveringOverlay, hasCoverMarker, intersects, samplePoints }
export type { CoverOptions, HitTest, RectLike }
