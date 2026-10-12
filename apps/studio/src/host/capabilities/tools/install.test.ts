import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type * as FrameworkBinaries from '@/host/framework/binaries'
import type { ToolSpec } from './catalog'

/**
 * 下载链路（`electron.net` + 临时文件 + 解压）在这里被换成假的：真发网络请求的测试
 * 不能进 CI，但它要验的恰恰是「把网上下来的东西变成可用的二进制」这一步 —— 用一个真的
 * 归档（系统 tar 现造）跑完整条管线，比只测拼路径有用得多。
 */
const TMP_ROOT = mkdtempSync(path.join(os.tmpdir(), 'ith-tools-'))

/** 假 net 要读的归档：beforeAll 里造好，工厂函数里直接读盘 */
const served = vi.hoisted(function () {
  return {
    archivePath: '',
    bytes: 0,
    /** 让用例改 HTTP 状态码 / 制造停滞（不推进也不发 end） */
    statusCode: 200,
    stalls: false
  }
})

/** 用例之间重新数一下假 net 被调用了几次 */
const requests = vi.hoisted(function () {
  return { count: 0 }
})

/** 测试自己的工具表（真的那条在 catalog.test.ts 里守） */
const catalog = vi.hoisted(function () {
  return { entries: [] as unknown[] }
})

vi.mock('electron', function () {
  /** 极简事件发射器：只用得上 on/emit，没必要为此引 node:events */
  function makeEmitter() {
    const handlers: Record<string, ((payload: unknown) => void)[]> = {}
    return {
      on: function (event: string, handler: (payload: never) => void) {
        handlers[event] = handlers[event] ?? []
        handlers[event].push(handler as (payload: unknown) => void)
      },
      emit: function (event: string, payload?: unknown) {
        for (const handler of handlers[event] ?? []) {
          handler(payload)
        }
      }
    }
  }

  return {
    net: {
      request: function () {
        requests.count += 1
        const request = Object.assign(makeEmitter(), {
          abort: function () {},
          end: function () {
            // 下一拍再发，让调用方先把监听挂完（与真实 net 的时序一致）
            setTimeout(function () {
              const response = Object.assign(makeEmitter(), {
                statusCode: served.statusCode,
                headers: { 'content-length': String(served.bytes) }
              })
              request.emit('response', response)
              if (served.statusCode !== 200) {
                return
              }
              if (served.stalls) {
                // 只发一帧就静止：调用方该按停滞把它掐掉
                response.emit('data', readFileSync(served.archivePath).subarray(0, 1024))
                return
              }
              response.emit('data', readFileSync(served.archivePath))
              response.emit('end')
            }, 0)
          }
        })
        return request
      }
    }
  }
})

vi.mock('./catalog', function () {
  return {
    findTools: function () {
      return catalog.entries
    },
    findTool: function (key: string) {
      return (
        (catalog.entries as ToolSpec[]).find(function (spec) {
          return spec.key === key
        }) ?? null
      )
    },
    findToolBinaryNames: function (spec: ToolSpec, platform = process.platform) {
      return spec.binaries.map(function (name) {
        return platform === 'win32' ? `${name}.exe` : name
      })
    },
    isToolKey: function (key: string) {
      return (catalog.entries as ToolSpec[]).some(function (spec) {
        return spec.key === key
      })
    }
  }
})

// 只把「落在哪」换到临时目录：这组用例要验的是「落盘/卸载怎么动文件」，不能真往用户家目录写。
// findBinary 用真实现 —— 取用顺序正是要测的东西，换成假的就等于测个寂寞。
vi.mock('../../framework/binaries', async function (importOriginal) {
  const actual = await importOriginal<typeof FrameworkBinaries>()
  return {
    ...actual,
    findUserDataDir: function () {
      return TMP_ROOT
    },
    findRuntimeRoot: function () {
      return path.join(TMP_ROOT, 'sidecar')
    },
    findBundledRoot: function () {
      return path.join(TMP_ROOT, 'bundled')
    }
  }
})

const { findUserDataDir } = await import('@/host/framework/binaries')
const { findTool } = await import('./catalog')
const { findStatuses, findToolRoot, findToolVersionDir, installTool, removeTool } =
  await import('./install')

/** 测试用的工具条目：只需要 key/version/binaries/package，其余随便给 */
function buildSpec(fields: {
  key: ToolSpec['key']
  version: string
  url?: string
  sha256: string
  binaries?: string[]
  /** 传 null 就是「这个平台没有在线包」 */
  package?: ToolSpec['package']
}): ToolSpec {
  return {
    key: fields.key,
    label: fields.key,
    summary: '测试用',
    version: fields.version,
    binaries: fields.binaries ?? ['pandoc'],
    platforms: {},
    package:
      fields.package === undefined
        ? { url: fields.url ?? 'https://example.invalid/x.zip', sha256: fields.sha256 }
        : fields.package
  }
}

/** 造一个真的 tar.gz（系统 tar 现打），里面放一个假的 pandoc —— 名字与结构都是真要的 */
function buildArchive(): { archivePath: string; sha256: string } {
  const srcDir = path.join(TMP_ROOT, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(path.join(srcDir, 'pandoc.exe'), 'not really pandoc')

  const archivePath = path.join(TMP_ROOT, 'pandoc-test.tar.gz')
  const tar = spawnSync('tar', ['-czf', archivePath, '-C', srcDir, 'pandoc.exe'], {
    encoding: 'utf8'
  })
  if (tar.status !== 0) {
    throw new Error(`造归档失败: ${tar.stderr}`)
  }

  served.archivePath = archivePath
  served.bytes = readFileSync(archivePath).length
  return {
    archivePath,
    sha256: createHash('sha256').update(readFileSync(archivePath)).digest('hex')
  }
}

const sha256 = /^[0-9a-f]{64}$/

/**
 * 只钉「不由环境决定」的部分：真实机器上可能装着完整版（staging 里有二进制），
 * 状态与路径的取值会被它影响，那种断言在别人机器上就绿变红。
 */
describe('tool install layout', function () {
  it('puts downloaded tools under <userData>/sidecar', function () {
    const spec = buildSpec({ key: 'pandoc', version: '9.9.9', sha256: '0'.repeat(64) })

    expect(findToolRoot()).toBe(path.join(findUserDataDir(), 'sidecar'))
    expect(findToolVersionDir(spec)).toBe(path.join(findToolRoot(), 'pandoc', '9.9.9'))
  })

  it('lists every tool exactly once', function () {
    catalog.entries = [buildSpec({ key: 'pandoc', version: '9.9.9', sha256: '0'.repeat(64) })]

    const statuses = findStatuses()
    expect(statuses).toHaveLength(1)
    // 既没装过、随包那份也不存在（bundled 指向一个不存在的目录）→ missing，且不给路径
    expect(statuses[0]).toMatchObject({ key: 'pandoc', state: 'missing', path: '' })
  })

  it('refuses unknown tools instead of touching the disk', async function () {
    await expect(installTool('nope')).rejects.toMatchObject({
      code: 'TOOL_UNKNOWN',
      message: expect.stringContaining('nope')
    })
    expect(function () {
      removeTool('nope')
    }).toThrow(/nope/)
  })

  it('says unsupported when the platform has no package, not unknown', async function () {
    catalog.entries = [
      buildSpec({ key: 'pandoc', version: '9.9.9', sha256: '0'.repeat(64), package: null })
    ]

    await expect(installTool('pandoc')).rejects.toMatchObject({ code: 'TOOL_UNSUPPORTED' })
    // 本平台没有在线包也要能卸载本地已装的那份
    expect(function () {
      removeTool('pandoc')
    }).not.toThrow()
  })
})

describe('tool install pipeline', function () {
  let archive: { archivePath: string; sha256: string }

  beforeAll(function () {
    archive = buildArchive()
    expect(archive.sha256).toMatch(sha256)
  })

  afterAll(function () {
    rmSync(TMP_ROOT, { recursive: true, force: true })
  })

  afterEach(function () {
    served.statusCode = 200
    served.stalls = false
    vi.useRealTimers()
  })

  function useSpec(overrides: Partial<Parameters<typeof buildSpec>[0]>): ToolSpec {
    const spec = buildSpec({
      key: 'pandoc',
      version: '0.0.1-test',
      sha256: archive.sha256,
      ...overrides
    })
    catalog.entries = [spec]
    return spec
  }

  it('downloads, verifies, extracts and lands the binary', async function () {
    const spec = useSpec({})
    const frames: { phase: string; received: number; total: number }[] = []

    await installTool(spec.key, function (progress) {
      frames.push({ phase: progress.phase, received: progress.received, total: progress.total })
    })

    const binary = path.join(findToolVersionDir(spec), 'pandoc.exe')
    expect(existsSync(binary)).toBe(true)
    expect(readFileSync(binary, 'utf8')).toBe('not really pandoc')

    // 进度：先报下载（带总长），再报一次解压
    expect(frames[0]).toEqual({ phase: 'download', received: served.bytes, total: served.bytes })
    expect(frames.at(-1)?.phase).toBe('extract')

    // 装好后状态是 installed，且没有留下 .tmp 残料
    expect(findStatuses()[0]?.state).toBe('installed')
    expect(existsSync(`${findToolVersionDir(spec)}.tmp`)).toBe(false)

    // 幂等：再装一次不会重下（假 net 只被调用过一次）
    const callsBefore = frames.length
    await installTool(spec.key, function (progress) {
      frames.push({ phase: progress.phase, received: progress.received, total: progress.total })
    })
    expect(frames.length).toBe(callsBefore)
  })

  it('rejects a payload whose hash does not match', async function () {
    const spec = useSpec({
      key: 'ffmpeg',
      version: '0.0.2-test',
      binaries: ['ffmpeg'],
      sha256: 'f'.repeat(64)
    })

    await expect(installTool(spec.key)).rejects.toThrow(/ffmpeg/)
    // 校验不过不许落盘
    expect(existsSync(findToolVersionDir(spec))).toBe(false)
    expect(existsSync(`${findToolVersionDir(spec)}.tmp`)).toBe(false)
  })

  it('reports a bad HTTP status as a download failure', async function () {
    served.statusCode = 404
    const spec = useSpec({ key: 'ffmpeg', version: '0.0.5-test', binaries: ['ffmpeg'] })

    await expect(installTool(spec.key)).rejects.toThrow(/404/)
    expect(existsSync(findToolVersionDir(spec))).toBe(false)
  })

  it('gives up when the response stops sending', async function () {
    vi.useFakeTimers()
    served.stalls = true
    const spec = useSpec({ key: 'pandoc', version: '0.0.6-test' })

    // 先挂上 catch，避免拒绝时被当成未处理异常
    const settled = installTool(spec.key).catch(function (error: unknown) {
      return error
    })
    // 停滞阈值是 60 s：推 120 s 必定触发（顺带把假 net 那个 setTimeout(0) 也推进）
    await vi.advanceTimersByTimeAsync(120_000)

    expect(String(await settled)).toMatch(/停滞/)
    expect(existsSync(findToolVersionDir(spec))).toBe(false)
    expect(existsSync(`${findToolVersionDir(spec)}.tmp`)).toBe(false)
  })

  it('removes what it installed', async function () {
    // 归档里那个文件叫 pandoc.exe：binaries 得跟着归档走，否则就是「解压后找不到可执行文件」
    const spec = useSpec({ key: 'opencode', version: '0.0.3-test' })
    await installTool(spec.key)
    expect(existsSync(path.join(findToolVersionDir(spec), 'pandoc.exe'))).toBe(true)

    removeTool(spec.key)
    expect(existsSync(path.join(findToolRoot(), 'opencode'))).toBe(false)
    expect(findTool(spec.key)?.version).toBe(spec.version)
  })
})
