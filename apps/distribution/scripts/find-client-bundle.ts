/**
 * 定位 Client Tauri 安装包 / updater 产物目录与文件。
 *
 * 优先级：
 * 1. 显式 `--dir`
 * 2. 环境变量 `CARGO_TARGET_DIR` → `{CARGO_TARGET_DIR}/[triple/]release/bundle`
 * 3. 回退 `apps/client/src-tauri/target/release/bundle`
 *
 * 文件名按 tauri.conf.json 的 productName + version + 本机 arch（x64 / arm64）匹配，
 * 避免同目录里旧 productName 产物（如「i thinking_…」）被误选。
 */
import { existsSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

interface TauriIdentity {
  productName: string
  version: string
  confPath: string
}

interface BundleArtifacts {
  bundleDir: string
  zipPath: string
  sigPath: string
  exePath: string | undefined
  /** WiX 多语言 MSI，如 cogito_1.5.0_x64_zh-CN.msi */
  msiPaths: string[]
  productName: string
  version: string
  arch: string
}

const CLIENT_TAURI_ROOT = join(
  fileURLToPath(new URL('../../client/src-tauri', import.meta.url))
)
const TAURI_CONF_PATH = join(CLIENT_TAURI_ROOT, 'tauri.conf.json')
const FALLBACK_BUNDLE = join(CLIENT_TAURI_ROOT, 'target', 'release', 'bundle')

/** 本机 arch → Tauri NSIS 文件名里的段（不是 windows-x86_64） */
function findArchLabel(nodeArch: string = process.arch): string {
  if (nodeArch === 'arm64') {
    return 'arm64'
  }
  return 'x64'
}

async function findTauriIdentity(confPath: string = TAURI_CONF_PATH): Promise<TauriIdentity> {
  const raw = await readFile(confPath, 'utf8')
  const conf = JSON.parse(raw) as { productName?: unknown; version?: unknown }
  const productName = typeof conf.productName === 'string' ? conf.productName.trim() : ''
  const version = typeof conf.version === 'string' ? conf.version.trim() : ''
  if (!productName) {
    throw new Error(`tauri.conf.json 缺少 productName: ${confPath}`)
  }
  if (!version || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$/.test(version)) {
    throw new Error(`tauri.conf.json version 无效（需 x.y.z）: ${confPath} → ${String(conf.version)}`)
  }
  return { productName, version, confPath }
}

function findArtifactBaseName(productName: string, version: string, arch: string): string {
  return `${productName}_${version}_${arch}-setup`
}

/** MSI 前缀：`cogito_1.5.0_x64_`（后面跟 zh-CN / en-US 等） */
function findMsiPrefix(productName: string, version: string, arch: string): string {
  return `${productName}_${version}_${arch}_`
}

/** 收集本 productName/version/arch 的全部 .msi（忽略旧 productName） */
function findMsiPaths(files: string[], productName: string, version: string, arch: string): string[] {
  const prefix = findMsiPrefix(productName, version, arch).toLowerCase()
  return files
    .filter(function (path) {
      const name = basename(path).toLowerCase()
      return name.startsWith(prefix) && name.endsWith('.msi') && !name.endsWith('.msi.sig')
    })
    .sort(function (left, right) {
      return basename(left).localeCompare(basename(right))
    })
}

/** 在 CARGO_TARGET_DIR 下常见布局里找 release/bundle */
function findCargoTargetBundleCandidates(cargoTargetDir: string): string[] {
  const root = cargoTargetDir.replace(/[\\/]+$/, '')
  return [
    join(root, 'release', 'bundle'),
    join(root, 'x86_64-pc-windows-msvc', 'release', 'bundle'),
    join(root, 'aarch64-pc-windows-msvc', 'release', 'bundle'),
    join(root, 'x86_64-pc-windows-gnu', 'release', 'bundle')
  ]
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * 解析要扫描的 bundle 根目录。
 * `explicitDir` 优先；否则读 `CARGO_TARGET_DIR`；再回退仓库内 target。
 */
async function findBundleDir(explicitDir: string | undefined): Promise<{
  bundleDir: string
  source: 'dir' | 'CARGO_TARGET_DIR' | 'fallback'
}> {
  if (explicitDir) {
    if (!(await isDirectory(explicitDir))) {
      throw new Error(`--dir 不是目录或不存在: ${explicitDir}`)
    }
    return { bundleDir: explicitDir, source: 'dir' }
  }

  const cargoTargetDir = process.env.CARGO_TARGET_DIR?.trim()
  if (cargoTargetDir) {
    for (const candidate of findCargoTargetBundleCandidates(cargoTargetDir)) {
      if (await isDirectory(candidate)) {
        return { bundleDir: candidate, source: 'CARGO_TARGET_DIR' }
      }
    }
    throw new Error(
      `已设置 CARGO_TARGET_DIR=${cargoTargetDir}，但未找到 release/bundle。` +
        `试过: ${findCargoTargetBundleCandidates(cargoTargetDir).join(' | ')}`
    )
  }

  if (!(await isDirectory(FALLBACK_BUNDLE))) {
    throw new Error(
      `未设置 CARGO_TARGET_DIR，且默认 bundle 不存在: ${FALLBACK_BUNDLE}` +
        '（请先 tauri build，或设 CARGO_TARGET_DIR / 传 --dir）'
    )
  }
  return { bundleDir: FALLBACK_BUNDLE, source: 'fallback' }
}

async function walkFiles(root: string): Promise<string[]> {
  const found: string[] = []
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        found.push(full)
      }
    }
  }
  await walk(root)
  return found
}

function findNamedFile(files: string[], fileName: string): string | undefined {
  const lower = fileName.toLowerCase()
  return files.find(function (path) {
    return basename(path).toLowerCase() === lower
  })
}

function findSigPath(files: string[], zipPath: string): string {
  const expected = `${zipPath}.sig`
  if (existsSync(expected)) {
    return expected
  }
  const byName = findNamedFile(files, `${basename(zipPath)}.sig`)
  if (!byName) {
    throw new Error(`缺少签名文件: ${expected}`)
  }
  return byName
}

/**
 * 按 productName_version_arch 精确匹配产物；version 默认来自 tauri.conf，可被 --release 覆盖。
 */
async function findClientBundleArtifacts(options: {
  explicitDir?: string
  /** 覆盖 tauri.conf 的 version（用于发预发 / 指定对象键） */
  release?: string
  skipExe?: boolean
  skipMsi?: boolean
  confPath?: string
}): Promise<BundleArtifacts & { source: 'dir' | 'CARGO_TARGET_DIR' | 'fallback' }> {
  const identity = await findTauriIdentity(options.confPath)
  const version = options.release ?? identity.version
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$/.test(version)) {
    throw new Error(`version 无效: ${version}`)
  }
  if (options.release && options.release !== identity.version) {
    console.warn(
      `[publish:client] --release ${options.release} 与 tauri.conf.json version ${identity.version} 不一致，按 --release 匹配文件名`
    )
  }

  const arch = findArchLabel()
  const { bundleDir, source } = await findBundleDir(options.explicitDir)
  const base = findArtifactBaseName(identity.productName, version, arch)
  const zipName = `${base}.nsis.zip`
  const exeName = `${base}.exe`

  const files = await walkFiles(bundleDir)
  const zipPath = findNamedFile(files, zipName)
  if (!zipPath) {
    throw new Error(
      `在 ${bundleDir}（来源: ${source}）未找到 ${zipName}` +
        `（productName=${identity.productName}, version=${version}, arch=${arch}）。` +
        '请先 tauri build（需 createUpdaterArtifacts）。'
    )
  }

  const exePath = options.skipExe ? undefined : findNamedFile(files, exeName)
  const msiPaths = options.skipMsi
    ? []
    : findMsiPaths(files, identity.productName, version, arch)

  return {
    bundleDir,
    source,
    zipPath,
    sigPath: findSigPath(files, zipPath),
    exePath,
    msiPaths,
    productName: identity.productName,
    version,
    arch
  }
}

export {
  CLIENT_TAURI_ROOT,
  TAURI_CONF_PATH,
  FALLBACK_BUNDLE,
  findArchLabel,
  findArtifactBaseName,
  findMsiPrefix,
  findMsiPaths,
  findCargoTargetBundleCandidates,
  findTauriIdentity,
  findBundleDir,
  findClientBundleArtifacts
}
export type { TauriIdentity, BundleArtifacts }
