/**
 * 把 CDP Overlay 拾取的元素写入 Agent composer：
 * browser chip + 可读描述 + 可选区域截图。
 */
import { defaultDirectiveFormatter, type useAui } from '@assistant-ui/react'

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
  const chip = defaultDirectiveFormatter.serialize({
    type: 'browser',
    label: displayTitle,
    id: picked.label
  })
  const lines = [
    chip,
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
