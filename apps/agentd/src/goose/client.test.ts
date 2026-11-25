/**
 * 子进程错误兜底：spawn 失败 / 管道断开不能变成未捕获异常。
 *
 * 这里不 mock `node:child_process`：直接用一个不存在的二进制，走真实的 spawn error 路径，
 * 这样才覆盖到「Node 对未监听的 'error' 直接抛」这个行为。
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { spawnGooseAcp } from './client'

describe('goose client 子进程错误', function () {
  it('二进制不存在时只回调一次 exit，且不抛未捕获异常', async function () {
    const exits: Array<{ code: number | null; reason?: string }> = []
    const client = spawnGooseAcp({
      binary: join(tmpdir(), `agentd-missing-goose-${process.pid}-${Date.now()}`),
      env: process.env,
      onExit: function (code, reason) {
        exits.push({ code, ...(reason ? { reason } : {}) })
      }
    })

    await new Promise(function (resolve) {
      setTimeout(resolve, 200)
    })

    expect(exits).toHaveLength(1)
    expect(exits[0]?.reason ?? '').toMatch(/启动|运行失败|ENOENT|EACCES/i)
    await expect(client.initialize()).rejects.toThrow(/goose acp/)
    client.close()
  })
})
