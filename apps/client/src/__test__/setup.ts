/**
 * vitest 全局 setup：补齐 jsdom 未实现的浏览器 API。
 *
 * jsdom 没有 `window.matchMedia`，而 `features/window/appearance` 的 `isDarkMode` /
 * `hasOsReducedMotion` / `watchAppearance` 会直接调用它 —— 且
 * `constants/magnetic-tile/window` 在**模块顶层**就会取一次外观（`findAppearanceWindowOptions`），
 * 于是任何间接 import 到这条链路的用例都会在加载阶段就崩。
 */

interface MediaQueryListStub {
  matches: boolean
  media: string
  onchange: null
  addEventListener: () => void
  removeEventListener: () => void
  addListener: () => void
  removeListener: () => void
  dispatchEvent: () => boolean
}

function makeMediaQueryList(query: string): MediaQueryListStub {
  return {
    matches: false,
    media: query,
    onchange: null,
    addEventListener: function () {},
    removeEventListener: function () {},
    addListener: function () {},
    removeListener: function () {},
    dispatchEvent: function () {
      return false
    }
  }
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = makeMediaQueryList
}
