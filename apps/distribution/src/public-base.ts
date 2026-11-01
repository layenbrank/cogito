/**
 * 公开下载 / Tauri updater 基址（Worker 读侧）。
 * 挂自定义域后只改这一处；勿把 R2 S3 API（*.r2.cloudflarestorage.com）写进 endpoints。
 */
const PUBLIC_BASE = 'https://cogito-distribution.layenbrank.workers.dev'

function findPublicUrl(key: string): string {
  const encoded = key
    .split('/')
    .map(function (segment) {
      return encodeURIComponent(segment)
    })
    .join('/')
  return `${PUBLIC_BASE}/${encoded}`
}

function findUpdaterEndpoint(channel: string): string {
  return findPublicUrl(`updater-${channel}/latest.json`)
}

export { PUBLIC_BASE, findPublicUrl, findUpdaterEndpoint }
