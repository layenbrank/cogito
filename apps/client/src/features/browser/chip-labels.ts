/**
 * 把浏览器标签页标题注入 composer chip 的显示层。
 *
 * chip 的线格式（`@browser-<uuid>`）只有 uuid：标题是「视图」而不是「数据」，
 * 关掉标签页后也理应退化成 uuid。`@cogito/design` 不能直接依赖 app 的 store，
 * 所以由这里注册一个解析器，design 侧 `ComposerChipText` 渲染时回调。
 */
import { setComposerChipLabelResolver } from '@cogito/design/assistant/composer-chip-text'

import { useBrowserStore } from '@/features/browser/store'

function installBrowserChipLabels() {
  setComposerChipLabelResolver(function (type, id) {
    if (type !== 'browser') return undefined
    const tab = useBrowserStore.getState().tabs.find(function (item) {
      return item.label === id
    })
    const title = tab?.title?.trim() ?? ''
    return title.length > 0 ? title : undefined
  })
}

export { installBrowserChipLabels }
