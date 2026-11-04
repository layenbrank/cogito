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
 *
 * updater 载荷有两种形态，都要支持：
 * - 老格式 `{base}.nsis.zip` + `.zip.sig`（tauri-bundler 把安装器再打一层 zip）
 * - 新格式 `{base}.exe` + `.exe.sig`（Tauri CLI 2.12+ 按 bundle 类型直接签安装器，
 *   不再产出 nsis.zip；tauri-plugin-updater 2.x 能直接吃裸 exe：
 *   `infer::app::is_exe` → 落盘带 `.exe` 后缀的临时文件 → `/UPDATE` 静默执行）
 *
 * 关键约束：**不许把过期载荷发出去**。同一 bundle 目录里往往混着上一次构建的
 * 旧 zip，只按“文件名命中就用”会把上一版的安装包当成这一版的更新推给用户。
 * 因此两种载荷都在时比 mtime，取更新的那一份。
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

/** updater 载荷形态：老格式 zip / 新格式裸安装器 */
type UpdaterKind = 'nsis.zip' | 'installer'

/** 选中的 updater 载荷（zip 或 installer 二选一） */
interface UpdaterPayload {
  kind: UpdaterKind
  path: string
  sigPath: string
  /** 载荷自身的 mtime（毫秒），用于在同目录新旧两版之间取“更新的一份” */
  mtimeMs: number
}

/** 扫到的产物清单（updater 载荷可缺，供 --dry-run / 报错列举） */
interface BundleInventory {
  bundleDir: string
  source: 'dir' | 'CARGO_TARGET_DIR' | 'fallback'
  productName: string
  version: string
  arch: string
  updateKind: UpdaterKind | undefined
  updatePath: string | undefined
  updateSigPath: string | undefined
  /** 老格式 updater 载荷原始路径（无论是否被选中都列出来，便于排查“为什么没用 zip”） */
  zipPath: string | undefined
  exePath: string | undefined
  /** WiX 多语言 MSI，如 cogito_1.5.0_x64_zh-CN.msi */
  msiPaths: string[]
}

interface BundleArtifacts {
  bundleDir: string
  source: 'dir' | 'CARGO_TARGET_DIR' | 'fallback'
  updateKind: UpdaterKind
  updatePath: string
  updateSigPath: string
  zipPath: string | undefined
  exePath: string | undefined
  /** WiX 多语言 MSI，如 cogito_1.5.0_x64_zh-CN.msi */
  msiPaths: string[]
  productName: string
  version: string
  arch: string
}

const CLIENT_TAURI_ROOT = join(fileURLToPath(new URL('../../client/src-tauri', import.meta.url)))
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

async function fileMtimeMs(path: string): Promise<number> {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return 0
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

function findSigPath(files: string[], payloadPath: string): string {
  const expected = `${payloadPath}.sig`
  if (existsSync(expected)) {
    return expected
  }
  const byName = findNamedFile(files, `${basename(payloadPath)}.sig`)
  if (!byName) {
    throw new Error(`缺少签名文件: ${expected}`)
  }
  return byName
}

/** 载荷 + 它的 `.sig` 都在才算可用；缺签名直接当没有，避免把未签名包发出去 */
async function loadPayload(
  kind: UpdaterKind,
  payloadPath: string | undefined,
  files: string[]
): Promise<UpdaterPayload | undefined> {
  if (!payloadPath) {
    return undefined
  }
  try {
    const sigPath = findSigPath(files, payloadPath)
    return { kind, path: payloadPath, sigPath, mtimeMs: await fileMtimeMs(payloadPath) }
  } catch {
    return undefined
  }
}

/**
 * 在 zip / 安装器两种载荷里挑真正要发的那一份。
 *
 * 两种都在时比 mtime：**更新的一份胜出**。典型现场是 bundle 目录里躺着上一版的
 * `*.nsis.zip`（Tauri CLI 2.12 之前留下），而本次构建只新写了 `-setup.exe`；
 * 按名字取 zip 会把旧安装包当成新版更新推出去。
 */
async function pickUpdaterPayload(
  files: string[],
  zipPath: string | undefined,
  exePath: string | undefined
): Promise<UpdaterPayload | undefined> {
  const zip = await loadPayload('nsis.zip', zipPath, files)
  const installer = await loadPayload('installer', exePath, files)
  if (zip && installer) {
    return installer.mtimeMs > zip.mtimeMs ? installer : zip
  }
  return zip ?? installer
}

function formatInventoryLines(inventory: BundleInventory): string[] {
  const base = findArtifactBaseName(inventory.productName, inventory.version, inventory.arch)
  return [
    `bundle:  ${inventory.bundleDir}（${inventory.source}）`,
    `match:   ${inventory.productName}_${inventory.version}_${inventory.arch}`,
    `updater: ${
      inventory.updatePath
        ? `${basename(inventory.updatePath)}（${inventory.updateKind}）`
        : `缺 ${base}.exe 或 ${base}.nsis.zip（都需要同名 .sig）`
    }`,
    `sig:     ${inventory.updateSigPath ? basename(inventory.updateSigPath) : '缺'}`,
    `zip:     ${inventory.zipPath ? basename(inventory.zipPath) : `无 ${base}.nsis.zip`}`,
    `exe:     ${inventory.exePath ? basename(inventory.exePath) : `缺 ${base}.exe`}`,
    `msi:     ${
      inventory.msiPaths.length > 0
        ? inventory.msiPaths
            .map(function (path) {
              return basename(path)
            })
            .join(', ')
        : `缺 ${base.replace(/-setup$/, '')}_*.msi`
    }`
  ]
}

/**
 * 只扫不校验：列出 updater 载荷 / exe / msi，缺件也返回（供 --dry-run 与报错列举）。
 */
async function findClientBundleInventory(options: {
  explicitDir?: string
  /** 覆盖 tauri.conf 的 version（用于发预发 / 指定对象键） */
  release?: string
  skipExe?: boolean
  skipMsi?: boolean
  confPath?: string
}): Promise<BundleInventory> {
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
  // exe 既是可选上传件，也可能是唯一可用的 updater 载荷，所以总是解析；
  // --skip-exe 只在 publish 阶段决定“要不要额外再传一份”。
  const exePath = findNamedFile(files, exeName)
  const msiPaths = options.skipMsi
    ? []
    : findMsiPaths(files, identity.productName, version, arch)
  const payload = await pickUpdaterPayload(files, zipPath, exePath)

  return {
    bundleDir,
    source,
    productName: identity.productName,
    version,
    arch,
    updateKind: payload?.kind,
    updatePath: payload?.path,
    updateSigPath: payload?.sigPath,
    zipPath,
    exePath,
    msiPaths
  }
}

/**
 * 按 productName_version_arch 精确匹配产物；version 默认来自 tauri.conf，可被 --release 覆盖。
 * 发版上传要求 updater 载荷 + 其 .sig 齐；缺件时错误里会带上已扫到的 msi/exe。
 */
async function findClientBundleArtifacts(options: {
  explicitDir?: string
  /** 覆盖 tauri.conf 的 version（用于发预发 / 指定对象键） */
  release?: string
  skipExe?: boolean
  skipMsi?: boolean
  confPath?: string
}): Promise<BundleArtifacts> {
  const inventory = await findClientBundleInventory(options)
  if (!inventory.updatePath || !inventory.updateSigPath || !inventory.updateKind) {
    const base = findArtifactBaseName(inventory.productName, inventory.version, inventory.arch)
    throw new Error(
      `updater 产物不齐（需要 ${base}.exe + .exe.sig，或 ${base}.nsis.zip + .zip.sig）。已扫到：\n` +
        formatInventoryLines(inventory)
          .map(function (line) {
            return `  ${line}`
          })
          .join('\n') +
        '\n请先 tauri build（createUpdaterArtifacts 会签安装器），或手动 zip+signer 后再发。'
    )
  }

  return {
    bundleDir: inventory.bundleDir,
    source: inventory.source,
    updateKind: inventory.updateKind,
    updatePath: inventory.updatePath,
    updateSigPath: inventory.updateSigPath,
    zipPath: inventory.zipPath,
    exePath: inventory.exePath,
    msiPaths: inventory.msiPaths,
    productName: inventory.productName,
    version: inventory.version,
    arch: inventory.arch
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
  findClientBundleInventory,
  findClientBundleArtifacts,
  formatInventoryLines
}
export type { TauriIdentity, BundleInventory, BundleArtifacts, UpdaterKind, UpdaterPayload }
