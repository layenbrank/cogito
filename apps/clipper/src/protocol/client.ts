import { CLIP_HOST, CLIP_PORT_ISOLATED, CLIP_PORT_RELEASE, CLIP_PORTS } from './constants.ts'
import { parseHealth } from './payload.ts'

import type { ClientHealth, ClipDelivery, ClipPayload } from './payload.ts'

function orderPorts(preferred: number | null): number[] {
  if (preferred === CLIP_PORT_ISOLATED) return [CLIP_PORT_ISOLATED, CLIP_PORT_RELEASE]
  return [...CLIP_PORTS]
}

function clipEndpoint(port: number): string {
  return `http://${CLIP_HOST}:${port}/clip`
}

function healthEndpoint(port: number): string {
  return `http://${CLIP_HOST}:${port}/health`
}

async function probeClient(ports: readonly number[]): Promise<ClientHealth | null> {
  for (const port of ports) {
    try {
      const response = await fetch(healthEndpoint(port), { method: 'GET' })
      if (!response.ok) continue
      const body: unknown = await response.json()
      return parseHealth(port, body)
    } catch (error) {
      console.warn('[clip] 健康检查失败', port, error)
    }
  }
  return null
}

async function deliverClip(payload: ClipPayload, ports: readonly number[]): Promise<ClipDelivery> {
  let lastError = 'client unreachable'
  for (const port of ports) {
    try {
      const response = await fetch(clipEndpoint(port), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const body = await response.text()
      if (!response.ok) {
        lastError = body || `HTTP ${response.status}`
        continue
      }
      return {
        ok: true,
        status: response.status,
        body,
        title: payload.title,
        url: payload.url,
        port
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      console.error('[clip] 投递失败', port, error)
    }
  }
  return { ok: false, error: lastError }
}

export { clipEndpoint, deliverClip, healthEndpoint, orderPorts, probeClient }
