import { invoke } from '@tauri-apps/api/core'
import { CHANNELS } from '@/shared/ipc/channels'

async function GET_AUTOSTART() {
  return invoke<boolean>(CHANNELS.AUTOSTART.READ)
}

async function PUT_AUTOSTART(desired: boolean) {
  return invoke<boolean>(CHANNELS.AUTOSTART.UPDATE, { enabled: desired })
}

export { GET_AUTOSTART, PUT_AUTOSTART }
