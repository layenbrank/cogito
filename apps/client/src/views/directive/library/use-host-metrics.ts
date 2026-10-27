/**
 * 宿主状态采样：固定间隔轮询 `system:os`（经 Tauri 调 corex `scan.os`）。
 * 只暴露 API 真实字段：memory/swap used·total、CPU 规格；不做占用率伪造。
 */

import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'

import type { ChartPoint, NamedCount } from '@cogito/design/components/charts'

import { CHANNELS } from '@/shared/ipc/channels'

/** 侧栏宿主状态刷新间隔 */
const POLL_MS = 2_000
const SAMPLE_LIMIT = 36
const BYTES_PER_MB = 1024 * 1024

interface HostCpu {
  brand: string
  frequency: number
  cores: number
  arch: string
}

interface HostMemory {
  total: number
  used: number
}

interface HostOs {
  CPU: HostCpu
  memory: HostMemory
  swap: HostMemory
}

interface HostSnapshot {
  sampledAt: number
  memoryUsed: number
  memoryTotal: number
  swapUsed: number
  swapTotal: number
  cpu: HostCpu
}

interface HostMetrics {
  /** 最新一次成功采样；失败时保留上一帧 */
  snapshot: HostSnapshot | null
  /** 内存已用（MB）真实趋势，供折线 */
  memoryUsedTrend: ChartPoint[]
  /** 当前内存 已用 / 可用（MB），供状态条图 */
  memoryBars: NamedCount[]
  isReady: boolean
  error: string | null
  pollMs: number
}

const EMPTY: HostMetrics = {
  snapshot: null,
  memoryUsedTrend: [],
  memoryBars: [],
  isReady: false,
  error: null,
  pollMs: POLL_MS
}

function isTauriRuntime() {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  )
}

function pad2(value: number) {
  return value < 10 ? `0${value}` : String(value)
}

function clockLabel(ms: number) {
  const date = new Date(ms)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

function bytesToMb(bytes: number) {
  if (bytes <= 0) return 0
  return Math.round((bytes / BYTES_PER_MB) * 10) / 10
}

function formatBytes(bytes: number) {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]}`
}

function formatFrequency(mhz: number) {
  if (mhz <= 0) return '—'
  if (mhz >= 1000) {
    return `${(mhz / 1000).toFixed(2)} GHz`
  }
  return `${mhz} MHz`
}

function pushPoint(points: ChartPoint[], label: string, value: number): ChartPoint[] {
  const next = points.concat([{ label, value }])
  if (next.length <= SAMPLE_LIMIT) return next
  return next.slice(next.length - SAMPLE_LIMIT)
}

function buildBars(used: number, total: number): NamedCount[] {
  if (total <= 0) return []
  const usedMb = bytesToMb(used)
  const freeMb = bytesToMb(Math.max(0, total - used))
  return [
    { name: '已用', value: usedMb },
    { name: '可用', value: freeMb }
  ]
}

function useHostMetrics(): HostMetrics {
  const [state, updateState] = useState<HostMetrics>(EMPTY)

  useEffect(function () {
    if (!isTauriRuntime()) {
      updateState({
        ...EMPTY,
        isReady: true,
        error: '非 Tauri 环境'
      })
      return
    }

    let cancelled = false
    let memoryUsedTrend: ChartPoint[] = []

    async function sample() {
      try {
        const os = await invoke<HostOs>(CHANNELS.SYSTEM.OS)
        if (cancelled) return

        const at = Date.now()
        const snapshot: HostSnapshot = {
          sampledAt: at,
          memoryUsed: os.memory.used,
          memoryTotal: os.memory.total,
          swapUsed: os.swap.used,
          swapTotal: os.swap.total,
          cpu: {
            brand: os.CPU.brand?.trim() || '—',
            frequency: os.CPU.frequency,
            cores: os.CPU.cores,
            arch: os.CPU.arch?.trim() || '—'
          }
        }

        memoryUsedTrend = pushPoint(
          memoryUsedTrend,
          clockLabel(at),
          bytesToMb(snapshot.memoryUsed)
        )

        updateState({
          snapshot,
          memoryUsedTrend,
          memoryBars: buildBars(snapshot.memoryUsed, snapshot.memoryTotal),
          isReady: true,
          error: null,
          pollMs: POLL_MS
        })
      } catch (error) {
        if (cancelled) return
        const message = error instanceof Error ? error.message : String(error)
        updateState(function (previous) {
          return {
            ...previous,
            isReady: true,
            error: message || 'system:os 不可用',
            pollMs: POLL_MS
          }
        })
      }
    }

    void sample()
    const timer = window.setInterval(function () {
      void sample()
    }, POLL_MS)

    return function () {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  return state
}

export { POLL_MS, formatBytes, formatFrequency, useHostMetrics }
export type { HostMetrics, HostSnapshot }
