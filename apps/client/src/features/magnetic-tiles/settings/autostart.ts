import { invoke } from '@tauri-apps/api/core'
import { CHANNELS } from '@/shared/ipc/channels'

async function findAutostartEnabled() {
  return invoke<boolean>(CHANNELS.AUTOSTART.READ)
}

async function syncAutostart(desired: boolean) {
  return invoke<boolean>(CHANNELS.AUTOSTART.UPDATE, { enabled: desired })
}

export { findAutostartEnabled, syncAutostart }
