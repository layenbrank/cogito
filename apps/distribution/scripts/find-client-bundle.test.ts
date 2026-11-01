import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  findArchLabel,
  findArtifactBaseName,
  findBundleDir,
  findCargoTargetBundleCandidates,
  findClientBundleArtifacts,
  findClientBundleInventory,
  findMsiPaths,
  findMsiPrefix,
  findTauriIdentity,
  formatInventoryLines
} from './find-client-bundle.ts'

const ORIGINAL_CARGO_TARGET_DIR = process.env.CARGO_TARGET_DIR

afterEach(function () {
  if (ORIGINAL_CARGO_TARGET_DIR === undefined) {
    delete process.env.CARGO_TARGET_DIR
  } else {
    process.env.CARGO_TARGET_DIR = ORIGINAL_CARGO_TARGET_DIR
  }
})

describe('findArchLabel / findArtifactBaseName', function () {
  it('把 Node arch 映射成 Tauri NSIS 段', function () {
    expect(findArchLabel('x64')).toBe('x64')
    expect(findArchLabel('arm64')).toBe('arm64')
    expect(findArchLabel('ia32')).toBe('x64')
  })

  it('拼出与 Tauri 一致的基名', function () {
    expect(findArtifactBaseName('cogito', '1.5.0', 'x64')).toBe('cogito_1.5.0_x64-setup')
    expect(findMsiPrefix('cogito', '1.5.0', 'x64')).toBe('cogito_1.5.0_x64_')
  })
})

describe('findMsiPaths', function () {
  it('只收本 productName/version/arch 的 msi，忽略旧名与 .sig', function () {
    const arch = 'x64'
    const files = [
      join('bundle', 'msi', `cogito_1.5.0_${arch}_zh-CN.msi`),
      join('bundle', 'msi', `cogito_1.5.0_${arch}_en-US.msi`),
      join('bundle', 'msi', `cogito_1.5.0_${arch}_zh-CN.msi.sig`),
      join('bundle', 'msi', `i thinking_1.5.0_${arch}_zh-CN.msi`),
      join('bundle', 'msi', `cogito_1.4.0_${arch}_zh-CN.msi`)
    ]
    const found = findMsiPaths(files, 'cogito', '1.5.0', arch)
    expect(found.map(basenameSafe)).toEqual([
      `cogito_1.5.0_${arch}_en-US.msi`,
      `cogito_1.5.0_${arch}_zh-CN.msi`
    ])
  })
})

describe('findCargoTargetBundleCandidates', function () {
  it('含 host release/bundle 与常见 windows triple', function () {
    const candidates = findCargoTargetBundleCandidates('D:\\Documents\\cache')
    expect(candidates[0]?.replace(/\\/g, '/')).toMatch(/cache\/release\/bundle$/)
    expect(candidates.some(function (path) {
      return path.includes('x86_64-pc-windows-msvc')
    })).toBe(true)
  })
})

describe('findTauriIdentity', function () {
  it('读真实 client tauri.conf.json', async function () {
    const identity = await findTauriIdentity()
    expect(identity.productName).toBe('cogito')
    expect(identity.version).toMatch(/^\d+\.\d+\.\d+/)
  })
})

describe('findBundleDir + findClientBundleArtifacts', function () {
  it('优先 CARGO_TARGET_DIR 下的 release/bundle', async function () {
    const root = mkdtempSync(join(tmpdir(), 'cogito-bundle-'))
    const bundle = join(root, 'release', 'bundle', 'nsis')
    mkdirSync(bundle, { recursive: true })
    process.env.CARGO_TARGET_DIR = root

    const found = await findBundleDir(undefined)
    expect(found.source).toBe('CARGO_TARGET_DIR')
    expect(found.bundleDir.replace(/\\/g, '/')).toMatch(/release\/bundle$/)
  })

  it('--dir 覆盖 CARGO_TARGET_DIR，并按 productName_version_arch 精确匹配', async function () {
    const root = mkdtempSync(join(tmpdir(), 'cogito-dir-'))
    const nsis = join(root, 'nsis')
    mkdirSync(nsis, { recursive: true })
    const confPath = join(root, 'tauri.conf.json')
    writeFileSync(
      confPath,
      JSON.stringify({ productName: 'cogito', version: '9.9.9' }, null, 2),
      'utf8'
    )

    const arch = findArchLabel()
    const base = `cogito_9.9.9_${arch}-setup`
    const msiDir = join(root, 'msi')
    mkdirSync(msiDir, { recursive: true })
    writeFileSync(join(nsis, `${base}.nsis.zip`), 'zip')
    writeFileSync(join(nsis, `${base}.nsis.zip.sig`), 'sig')
    writeFileSync(join(nsis, `${base}.exe`), 'exe')
    writeFileSync(join(msiDir, `cogito_9.9.9_${arch}_zh-CN.msi`), 'msi-zh')
    writeFileSync(join(msiDir, `cogito_9.9.9_${arch}_en-US.msi`), 'msi-en')
    // 旧 productName，不应被选中
    writeFileSync(join(nsis, `i thinking_9.9.9_${arch}-setup.nsis.zip`), 'old')
    writeFileSync(join(nsis, `i thinking_9.9.9_${arch}-setup.nsis.zip.sig`), 'old-sig')
    writeFileSync(join(msiDir, `i thinking_9.9.9_${arch}_zh-CN.msi`), 'old-msi')

    process.env.CARGO_TARGET_DIR = 'D:\\should-not-use'
    const artifacts = await findClientBundleArtifacts({
      explicitDir: root,
      confPath,
      skipExe: false
    })
    expect(artifacts.source).toBe('dir')
    expect(artifacts.version).toBe('9.9.9')
    expect(basenameSafe(artifacts.zipPath)).toBe(`${base}.nsis.zip`)
    expect(basenameSafe(artifacts.exePath ?? '')).toBe(`${base}.exe`)
    expect(artifacts.msiPaths.map(basenameSafe)).toEqual([
      `cogito_9.9.9_${arch}_en-US.msi`,
      `cogito_9.9.9_${arch}_zh-CN.msi`
    ])
  })

  it('CARGO_TARGET_DIR 存在但无 bundle 时抛错', async function () {
    const root = mkdtempSync(join(tmpdir(), 'cogito-empty-'))
    process.env.CARGO_TARGET_DIR = root
    await expect(findBundleDir(undefined)).rejects.toThrow(/未找到 release\/bundle/)
  })

  it('inventory 缺 zip 仍列出 msi；artifacts 报错里带清单', async function () {
    const root = mkdtempSync(join(tmpdir(), 'cogito-msi-only-'))
    const msiDir = join(root, 'msi')
    mkdirSync(msiDir, { recursive: true })
    const confPath = join(root, 'tauri.conf.json')
    writeFileSync(
      confPath,
      JSON.stringify({ productName: 'cogito', version: '8.8.8' }, null, 2),
      'utf8'
    )
    const arch = findArchLabel()
    writeFileSync(join(msiDir, `cogito_8.8.8_${arch}_zh-CN.msi`), 'msi')

    const inventory = await findClientBundleInventory({
      explicitDir: root,
      confPath
    })
    expect(inventory.zipPath).toBeUndefined()
    expect(inventory.msiPaths.map(basenameSafe)).toEqual([`cogito_8.8.8_${arch}_zh-CN.msi`])
    expect(formatInventoryLines(inventory).some(function (line) {
      return line.includes('zh-CN.msi')
    })).toBe(true)

    await expect(
      findClientBundleArtifacts({ explicitDir: root, confPath })
    ).rejects.toThrow(/zh-CN\.msi/)
  })
})

function basenameSafe(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}
