/**
 * embedding 开关的决策与会话状态：**端点不可达时开关不生效**。
 *
 * 锁的三条不变式：
 * 1. 没填端点 → 直接拒绝，不写 enabled=true；
 * 2. 默认必须先探测，探测失败只留下一条失败记录（enabled 仍是 false）；
 * 3. 只有探测成功（拿到维度）才允许 enabled=true。
 *
 * 这三条对应「点上 embedding 就卡死、整机跟着崩」的根因：
 * 旧版开关只写 localStorage，端点填错时下一次 ingest 立刻全量 embedding。
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  embeddingProbeFailurePatch,
  embeddingProbeSuccessPatch,
  patchEmbeddingConfig,
  planEmbeddingToggle,
  readEmbeddingConfig
} from '@/views/knowledge/lib/embedding-config.ts'

const STORAGE_KEY = 'knowledge.embedding.config'

beforeEach(function () {
  localStorage.clear()
})

describe('planEmbeddingToggle', function () {
  it('关闭开关：不探测直接落 enabled=false', function () {
    expect(
      planEmbeddingToggle({ checked: false, endpoint: 'http://x/v1', probeBeforeEnable: true })
    ).toEqual({ kind: 'disable' })
  })

  it('端点为空白：拒绝启用，并给出人话提示', function () {
    const plan = planEmbeddingToggle({ checked: true, endpoint: '   ', probeBeforeEnable: true })
    expect(plan.kind).toBe('reject')
    if (plan.kind === 'reject') {
      expect(plan.message).toContain('端点')
    }
  })

  it('默认（probeBeforeEnable=true）必须先探测', function () {
    expect(
      planEmbeddingToggle({ checked: true, endpoint: 'http://x/v1', probeBeforeEnable: true })
    ).toEqual({ kind: 'probe' })
  })

  it('只有显式关掉 probeBeforeEnable 才允许直接启用', function () {
    expect(
      planEmbeddingToggle({ checked: true, endpoint: 'http://x/v1', probeBeforeEnable: false })
    ).toEqual({ kind: 'enable' })
  })
})

describe('探测结果落盘', function () {
  it('失败补丁永远 enabled=false，并记一条可读错误', function () {
    const patch = embeddingProbeFailurePatch(new Error('embedding 请求超时（6000ms）'), 1_700_000_000_000)
    expect(patch.enabled).toBe(false)
    expect(patch.lastProbe).toMatchObject({ ok: false, error: 'embedding 请求超时（6000ms）' })
  })

  it('失败补丁对非 Error 值也不抛，转成字符串', function () {
    const patch = embeddingProbeFailurePatch('FetchError: <no response>', 1)
    expect(patch.enabled).toBe(false)
    expect(patch.lastProbe?.error).toContain('no response')
  })

  it('成功补丁才置 enabled=true 并带维度', function () {
    const patch = embeddingProbeSuccessPatch(1536, 42)
    expect(patch).toMatchObject({ enabled: true, lastProbe: { at: 42, ok: true, dim: 1536 } })
  })

  it('探测失败写回后读出来仍是未启用（真机点的就是这条路径）', function () {
    patchEmbeddingConfig({ endpoint: 'http://127.0.0.1:9/v1', enabled: true })
    patchEmbeddingConfig(embeddingProbeFailurePatch(new Error('HTTP 500'), Date.now()))

    const config = readEmbeddingConfig()
    expect(config.enabled).toBe(false)
    expect(config.lastProbe?.ok).toBe(false)
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { enabled?: boolean }
    expect(stored.enabled).toBe(false)
  })
})
