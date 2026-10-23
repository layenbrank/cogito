import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { findUploadTarget, parseArgs } from './upload-args.ts'

/** 拿本文件当「存在的源文件」用，省得造临时文件 */
const SELF = fileURLToPath(import.meta.url)
const USAGE = '用法: 测试用'

describe('parseArgs（两个上传脚本共用的参数解析）', function () {
  it('--x 值与 --x=值 都认', function () {
    const args = parseArgs(['--source', 'a.exe', '--release=1.3.0'])
    expect(args.get('source')).toBe('a.exe')
    expect(args.get('release')).toBe('1.3.0')
  })

  it('pnpm 原样递过来的 -- 跳过；--help 是布尔旗标', function () {
    const args = parseArgs(['--', '--help'])
    expect(args.has('help')).toBe(true)
  })

  it('裸值、缺值、值本身像旗标都算错', function () {
    expect(function () {
      parseArgs(['a.exe'])
    }).toThrow(/无法识别的参数/)
    expect(function () {
      parseArgs(['--source'])
    }).toThrow(/缺参数值/)
    expect(function () {
      parseArgs(['--source', '--release'])
    }).toThrow(/缺参数值/)
  })
})

describe('findUploadTarget（源文件 + 对象键）', function () {
  it('--release 推出规范的默认对象名', function () {
    const target = findUploadTarget(parseArgs(['--source', SELF, '--release', '1.3.0']), USAGE)
    expect(target).toEqual({ source: SELF, key: '1.3.0/cogito_1.3.0_x64-setup.exe' })
  })

  it('--name 覆盖对象名，--key 直接给整个键', function () {
    const named = parseArgs(['--source', SELF, '--release', '1.3.0', '--name', 'other-setup.exe'])
    expect(findUploadTarget(named, USAGE).key).toBe('1.3.0/other-setup.exe')

    const keyed = parseArgs(['--source', SELF, '--key', '9.9.9/cogito_9.9.9_x64-setup.exe'])
    expect(findUploadTarget(keyed, USAGE).key).toBe('9.9.9/cogito_9.9.9_x64-setup.exe')
  })

  it('读侧白名单外的键直接拒收（传上去也下载不了）', function () {
    const args = parseArgs(['--source', SELF, '--key', 'tools/ffmpeg.zip'])
    expect(function () {
      findUploadTarget(args, USAGE)
    }).toThrow(/白名单/)
  })

  it('缺 --source / 缺版本 / 源文件不存在', function () {
    expect(function () {
      findUploadTarget(parseArgs([]), USAGE)
    }).toThrow(/--source 必填/)
    expect(function () {
      findUploadTarget(parseArgs(['--source', SELF]), USAGE)
    }).toThrow(/--release 或 --key/)
    const missing = parseArgs(['--source', 'nope.exe', '--release', '1.3.0'])
    expect(function () {
      findUploadTarget(missing, USAGE)
    }).toThrow(/源文件不存在/)
  })
})
