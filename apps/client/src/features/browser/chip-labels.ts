/**
 * 把浏览器标签页标题注入 composer chip 的显示层。
 *
 * chip 的线格式（`@browser-<uuid>`）只有 uuid：标题是「视图」而不是「数据」，
 * 关掉标签页后也理应退化成 uuid。`@cogito/design` 不能直接依赖 app 的 store，
 * 所以由这里注册一个解析器，design 侧 `ComposerChipText` 渲染时回调。
 */
import { setComposerChipLabelResolver } from '@cogito/design/assistant/composer-chip-text'

import { useBrowserStore } from '@/features/browser/store'

/**
 * 见过的标签页标题（`browser-<uuid>` → 标题）。
 *
 * 标签页关掉后 store 里就没有它了，但**历史消息里的 chip 还在**。
 * 只查 store 的结果是把旧对话里的每个浏览器引用都退化成 uuid —— 那串东西对用户没有意义。
 * 这里把见过的标题记下来，关掉之后仍能显示当时的页面名。
 */
const rememberedTitles = new Map<string, string>()

/** 标签页实在找不到了：给一个人能读的降级文案，而不是 uuid */
const FALLBACK_BROWSER_LABEL = '浏览器标签页'

function installBrowserChipLabels() {
  setComposerChipLabelResolver(function (type, id) {
    if (type !== 'browser') return undefined
    const tab = useBrowserStore.getState().tabs.find(function (item) {
      return item.label === id
    })
    const title = tab?.title?.trim() ?? ''
    if (title.length > 0) {
      rememberedTitles.set(id, title)
      return title
    }
    return rememberedTitles.get(id) ?? FALLBACK_BROWSER_LABEL
  })
}

export { installBrowserChipLabels }
