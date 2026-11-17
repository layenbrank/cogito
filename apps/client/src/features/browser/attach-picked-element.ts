/**
 * 把 CDP Overlay 拾取的元素写入 Agent composer：
 * browser chip + 可读描述 + 可选区域截图。
 *
 * **不再用 `defaultDirectiveFormatter`**：它输出 `:browser[标题]{name=browser-<uuid>}`，
 * 而 composer 早已改成 `@` 线格式，旧 directive 在输入区与气泡里都只会当普通文本显示 ——
 * 用户看到的就是一长串自己的 uuid。chip 仍要指向那个 webview label（工具 `tab` 参数用它），
 * 所以写 `@browser-<uuid>`，显示文案由 `chip-labels` 的标题解析器给。
 */
import type { useAui } from '@assistant-ui/react'

import { attachImageData } from '@/features/agent/attachment'
import type { PickedBrowserElement } from '@/features/browser/api'
import { formatTabTitle } from '@/features/browser/address'
import { useBrowserStore } from '@/features/browser/store'

type ComposerAui = ReturnType<typeof useAui>

function buildPickedBlock(picked: PickedBrowserElement): string {
  const tab = useBrowserStore.getState().tabs.find(function (item) {
    return item.label === picked.label
  })
  const displayTitle = formatTabTitle(picked.url || tab?.url || '', tab?.title)
  // chip 后面跟一句人能读的页面名：chip 本身在标签页关掉后只剩通用文案
  const chip = `@${picked.label}`
  const lines = [
    `${chip} ${displayTitle}`,
    `选中元素 <${picked.tag}>`,
    `selector: ${picked.selector}`
  ]
  if (picked.text) lines.push(`text: ${picked.text}`)
  if (picked.url) lines.push(`url: ${picked.url}`)
  if (picked.outerHtml) {
    lines.push('```html')
    lines.push(picked.outerHtml)
    lines.push('```')
  }
  return lines.join('\n')
}

async function attachPickedElement(
  aui: ComposerAui,
  picked: PickedBrowserElement
): Promise<void> {
  const block = buildPickedBlock(picked)
  const previous = aui.composer.getState().text
  aui.composer.setText(previous.trim() ? `${previous.trimEnd()}\n\n${block}` : block)

  if (picked.screenshot?.base64) {
    const mime = picked.screenshot.mimeType || 'image/jpeg'
    const ext = mime.includes('png') ? 'png' : 'jpg'
    const name = `元素-${picked.tag || 'node'}.${ext}`
    await attachImageData(aui, `data:${mime};base64,${picked.screenshot.base64}`, name)
  }
}

export { attachPickedElement, buildPickedBlock }
