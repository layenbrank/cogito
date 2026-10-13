/**
 * 把登录令牌同步到 goose 侧车能读到的 JWT 文件（`<appData>/cogito/jwt`）。
 *
 * goose 的自定义 provider 用 `auth.command`（token helper）拿令牌，那是独立进程，
 * 读不到渲染进程的 Web Storage —— 所以登录/刷新时这里同步一份落盘，退出时清掉。
 * 同步失败只留痕，不阻断登录本身。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

function syncCogitoJwt(token: string | null): void {
  const action = token ? CHANNELS.COGITO.TOKEN_WRITE : CHANNELS.COGITO.TOKEN_CLEAR
  const args = token ? { token } : {}
  invoke(action, args).catch(function (error) {
    // 网关侧车鉴权依赖这个文件，失败要留痕（登录不该因为一个旁路文件写失败而失败）
    console.warn('[cogito] 同步 JWT 文件失败:', error)
  })
}

export { syncCogitoJwt }
