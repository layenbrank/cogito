import styles from './agent-sender.module.scss'
import { findChipIconSvg } from './chip-icon-svg'
import {
  CHIP_ATTR,
  CHIP_CLOSE_ATTR,
  CHIP_KIND_ATTR,
  CHIP_PATH_ATTR,
  CHIP_VALUE_ATTR,
  findChipPathKey,
  normalizeChipPath
} from './agent-sender-dom'
import type { SenderChip } from './sender-trigger'
import { findFileIcon, findFileIconTone } from '@/features/agent/model/file-icon'

/** 纯 DOM mention（对齐 Cursor）：contenteditable=false + 彩色图标 + 关闭钮 */
function buildChipElement(chip: SenderChip) {
  const host = document.createElement('span')
  host.setAttribute(CHIP_ATTR, 'true')
  host.setAttribute(CHIP_VALUE_ATTR, chip.value)
  host.setAttribute(CHIP_KIND_ATTR, chip.kind)
  const pathKey = findChipPathKey(chip)
  if (pathKey) host.setAttribute(CHIP_PATH_ATTR, pathKey)
  if (chip.meta.relative) host.dataset.relative = normalizeChipPath(chip.meta.relative)
  host.dataset.label = chip.label
  host.dataset.chipId = chip.id
  host.setAttribute('contenteditable', 'false')
  host.className = styles.chip

  const fileName = chip.meta.name || chip.label
  const iconName = chip.kind === 'skill' ? 'mdi:hammer-wrench' : findFileIcon(fileName)
  const tone = findFileIconTone(fileName, chip.kind)

  const iconWrap = document.createElement('span')
  iconWrap.className = styles.chipIcon
  iconWrap.dataset.tone = tone
  iconWrap.setAttribute('aria-hidden', 'true')
  iconWrap.innerHTML = findChipIconSvg(iconName, 12)
  host.appendChild(iconWrap)

  const label = document.createElement('span')
  label.className = styles.chipLabel
  label.textContent = chip.label
  host.appendChild(label)

  const close = document.createElement('button')
  close.type = 'button'
  close.className = styles.chipClose
  close.setAttribute('aria-label', '移除')
  close.setAttribute(CHIP_CLOSE_ATTR, 'true')
  close.textContent = '×'
  host.appendChild(close)

  return host
}

export { buildChipElement }
