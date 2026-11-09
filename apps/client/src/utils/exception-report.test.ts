import { describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(function () {
  return { post: vi.fn() }
})

vi.mock('@/apis/exception', function () {
  return {
    POST_EXCEPTION: async function (body: unknown): Promise<void> {
      await holder.post(body)
    }
  }
})

/** 每个用例拿一份全新模块状态（队列 / 熔断 / 去重表都是模块级单例） */
async function loadReporter() {
  vi.resetModules()
  holder.post.mockReset()
  return import('@/utils/exception-report')
}

describe('exception-report 防回路', function () {
  it('同一句话 5s 内只报一次（window.error 给的是字符串，没有对象身份）', async function () {
    holder.post.mockResolvedValue(undefined)
    const reporter = await loadReporter()

    reporter.reportUnknown(new Error('boom'))
    await vi.waitFor(function () {
      expect(holder.post).toHaveBeenCalledTimes(1)
    })

    reporter.reportUnknown(new Error('boom'))
    await Promise.resolve()
    await Promise.resolve()
    expect(holder.post).toHaveBeenCalledTimes(1)
  })

  it('上报接口自身失败（报文里带 /api/v1/exception）不再上报', async function () {
    holder.post.mockResolvedValue(undefined)
    const reporter = await loadReporter()

    reporter.reportUnknown(
      new Error(
        'FetchError: [POST] "http://127.0.0.1:3000/api/v1/exception": <no response> error sending request'
      )
    )
    await Promise.resolve()
    expect(holder.post).not.toHaveBeenCalled()
  })

  it('可预期失败（工作区目录不存在）不上报', async function () {
    holder.post.mockResolvedValue(undefined)
    const reporter = await loadReporter()
    const { ExpectedError } = await import('@/utils/expected-error')

    reporter.reportCaught('agent.port.run', new ExpectedError('工作区文件夹不存在：D:/gone'))
    await Promise.resolve()
    expect(holder.post).not.toHaveBeenCalled()
  })

  it('连续失败后熔断：期内只入队，不再打请求', async function () {
    vi.useFakeTimers()
    try {
      const reporter = await loadReporter()
      holder.post.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:3000'))

      await reporter.reportException({ message: 'first' })
      // 让重试（1.5s / 5s 退避）跑到触发熔断
      await vi.advanceTimersByTimeAsync(20_000)
      expect(reporter.isCoolingDown()).toBe(true)

      const attempts = holder.post.mock.calls.length
      expect(attempts).toBeGreaterThanOrEqual(1)
      await reporter.reportException({ message: 'during-breaker' })

      expect(holder.post.mock.calls.length).toBe(attempts)
      expect(reporter.pendingReportCount()).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
