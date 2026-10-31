/**
 * WebView / 浏览器原生「页内查找」识别。
 *
 * 实际拦截落在 `keyboard/dispatcher.ts`：有应用内命令时 `preventDefault` 并派发；
 * 无人接管时仍对查找键 `preventDefault`，避免弹出 Chromium / WebView2 find bar。
 * Windows 另有 Rust 侧 `AreBrowserAcceleratorKeysEnabled=false`。
 */

function isFindShortcut(event: KeyboardEvent): boolean {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  const mod = event.ctrlKey || event.metaKey

  // Ctrl/Cmd+F（主查找）
  if (mod && !event.altKey && key === 'f') return true

  // F3 / Ctrl/Cmd+G：Chromium find-next，也会拉起原生查找条
  if (key === 'F3') return true
  if (mod && !event.altKey && key === 'g') return true

  return false
}

export { isFindShortcut }
