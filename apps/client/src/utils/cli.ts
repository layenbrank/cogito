import { getCurrentWindow } from '@tauri-apps/api/window'
import { getMatches } from '@tauri-apps/plugin-cli'
import { info } from '@tauri-apps/plugin-log'

async function syncCliMatches() {
  try {
    const matches = await getMatches()
    const minimized = matches.args.minimized?.value === true
    const verbose = matches.args.verbose?.value === true

    if (verbose) {
      try {
        await info('verbose mode enabled via --verbose')
      } catch {
        console.info('[cli] verbose mode enabled')
      }
    }

    if (minimized) {
      const win = getCurrentWindow()
      if (win.label === 'main') await win.hide()
    }
  } catch (error) {
    console.warn('[cli] syncCliMatches failed', error)
  }
}

export { syncCliMatches }
