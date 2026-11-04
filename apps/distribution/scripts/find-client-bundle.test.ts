import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
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
    expect(
      candidates.some(function (path) {
        return path.includes('x86_64-pc-windows-msvc')
      })
    ).toBe(true)
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
    // 只有 zip 带签名 → 选 zip
    expect(artifacts.updateKind).toBe('nsis.zip')
    expect(basenameSafe(artifacts.updatePath)).toBe(`${base}.nsis.zip`)
    expect(basenameSafe(artifacts.updateSigPath)).toBe(`${base}.nsis.zip.sig`)
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

  it('inventory 缺 updater 载荷仍列出 msi；artifacts 报错里带清单', async function () {
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
    expect(inventory.updatePath).toBeUndefined()
    expect(inventory.updateKind).toBeUndefined()
    expect(inventory.zipPath).toBeUndefined()
    expect(inventory.msiPaths.map(basenameSafe)).toEqual([`cogito_8.8.8_${arch}_zh-CN.msi`])
    expect(
      formatInventoryLines(inventory).some(function (line) {
        return line.includes('zh-CN.msi')
      })
    ).toBe(true)

    await expect(findClientBundleArtifacts({ explicitDir: root, confPath })).rejects.toThrow(
      /zh-CN\.msi/
    )
  })
})

/**
 * Tauri CLI 2.12+ 只签安装器（`-setup.exe` + `.sig`），不再产出 `.nsis.zip`；
 * 但目录里往往还躺着上一版留下的 zip。这一组用例锁住「取新的一份」这条约束。
 */
describe('updater 载荷选择（zip vs 安装器）', function () {
  function scaffold(version: string): { root: string; nsis: string; confPath: string; base: string } {
    const root = mkdtempSync(join(tmpdir(), 'cogito-payload-'))
    const nsis = join(root, 'nsis')
    mkdirSync(nsis, { recursive: true })
    const confPath = join(root, 'tauri.conf.json')
    writeFileSync(confPath, JSON.stringify({ productName: 'cogito', version }), 'utf8')
    const base = `cogito_${version}_${findArchLabel()}-setup`
    return { root, nsis, confPath, base }
  }

  it('只有安装器 + .sig 时选安装器（本次构建的真实形态）', async function () {
    const { root, nsis, confPath, base } = scaffold('7.0.0')
    writeFileSync(join(nsis, `${base}.exe`), 'exe')
    writeFileSync(join(nsis, `${base}.exe.sig`), 'exe-sig')

    const inventory = await findClientBundleInventory({ explicitDir: root, confPath })
    expect(inventory.updateKind).toBe('installer')
    expect(basenameSafe(inventory.updatePath ?? '')).toBe(`${base}.exe`)
    expect(basenameSafe(inventory.updateSigPath ?? '')).toBe(`${base}.exe.sig`)

    const artifacts = await findClientBundleArtifacts({ explicitDir: root, confPath })
    expect(artifacts.updateKind).toBe('installer')
  })

  it('zip 比安装器旧时丢弃 zip，改用安装器', async function () {
    const { root, nsis, confPath, base } = scaffold('7.0.1')
    const zip = join(nsis, `${base}.nsis.zip`)
    writeFileSync(zip, 'stale-zip')
    writeFileSync(`${zip}.sig`, 'stale-sig')
    const old = new Date(Date.now() - 3600 * 1000)
    utimesSync(zip, old, old)
    writeFileSync(join(nsis, `${base}.exe`), 'fresh-exe')
    writeFileSync(join(nsis, `${base}.exe.sig`), 'fresh-sig')

    const artifacts = await findClientBundleArtifacts({ explicitDir: root, confPath })
    expect(artifacts.updateKind).toBe('installer')
    expect(basenameSafe(artifacts.updatePath)).toBe(`${base}.exe`)
    // zip 仍在清单里，便于排查，但不会被当成 updater 载荷
    expect(basenameSafe(artifacts.zipPath ?? '')).toBe(`${base}.nsis.zip`)
  })

  it('zip 比安装器新时继续用 zip（老格式仍然有效）', async function () {
    const { root, nsis, confPath, base } = scaffold('7.0.2')
    writeFileSync(join(nsis, `${base}.exe`), 'exe')
    writeFileSync(join(nsis, `${base}.exe.sig`), 'exe-sig')
    const zip = join(nsis, `${base}.nsis.zip`)
    writeFileSync(zip, 'fresh-zip')
    writeFileSync(`${zip}.sig`, 'fresh-sig')
    const old = new Date(Date.now() - 3600 * 1000)
    utimesSync(join(nsis, `${base}.exe`), old, old)

    const artifacts = await findClientBundleArtifacts({ explicitDir: root, confPath })
    expect(artifacts.updateKind).toBe('nsis.zip')
    expect(basenameSafe(artifacts.updateSigPath)).toBe(`${base}.nsis.zip.sig`)
  })

  it('安装器缺 .sig 时不算可用载荷', async function () {
    const { root, nsis, confPath, base } = scaffold('7.0.3')
    writeFileSync(join(nsis, `${base}.exe`), 'unsigned-exe')

    const inventory = await findClientBundleInventory({ explicitDir: root, confPath })
    expect(inventory.updateKind).toBeUndefined()
    await expect(findClientBundleArtifacts({ explicitDir: root, confPath })).rejects.toThrow(
      /updater 产物不齐/
    )
  })
})

function basenameSafe(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}
