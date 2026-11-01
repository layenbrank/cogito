/**
 * 让 Node fetch 走系统 / 环境代理。
 *
 * Windows 上 IE/系统代理（如 Clash 127.0.0.1:7890）只会被 WinHTTP/.NET 自动用；
 * Node undici 默认直连，国内访问 `*.workers.dev` 常 ConnectTimeout →「fetch failed」。
 * 上传脚本启动时调一次：有 HTTPS_PROXY 用它，否则读 HKCU 系统代理。
 */
import { execFileSync } from 'node:child_process'

import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici'

let isInstalled = false

/** 从当前用户 IE 代理设置读出 http(s) 代理 URL；未启用则 undefined */
function findWindowsProxyUrl(): string | undefined {
  if (process.platform !== 'win32') return undefined
  try {
    const raw = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "$s = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; " +
          "if (-not $s.ProxyEnable) { exit 0 }; " +
          "Write-Output $s.ProxyServer"
      ],
      { encoding: 'utf8', windowsHide: true }
    ).trim()
    if (!raw) return undefined
    // 可能是 `127.0.0.1:7890` 或 `http=127.0.0.1:7890;https=127.0.0.1:7890`
    const https = /(?:^|;)\s*https\s*=\s*([^;\s]+)/i.exec(raw)
    const http = /(?:^|;)\s*http\s*=\s*([^;\s]+)/i.exec(raw)
    const hostPort = (https?.[1] ?? http?.[1] ?? raw.split(';')[0] ?? '').trim()
    if (!hostPort) return undefined
    if (/^https?:\/\//i.test(hostPort)) return hostPort
    return `http://${hostPort}`
  } catch (error) {
    console.warn('[distribution] 读系统代理失败', error)
    return undefined
  }
}

/** 安装全局代理 dispatcher；幂等。返回实际使用的代理 URL（无则 undefined） */
function installHttpProxy(): string | undefined {
  if (isInstalled) {
    return process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? process.env.ALL_PROXY
  }
  isInstalled = true

  let proxy =
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    process.env.ALL_PROXY?.trim() ||
    undefined

  if (!proxy) {
    proxy = findWindowsProxyUrl()
    if (proxy) {
      process.env.HTTPS_PROXY = proxy
      process.env.HTTP_PROXY = proxy
      console.log(`[distribution] 使用系统代理 ${proxy}`)
    }
  }

  if (proxy) {
    setGlobalDispatcher(new EnvHttpProxyAgent())
  }
  return proxy
}

export { findWindowsProxyUrl, installHttpProxy }
