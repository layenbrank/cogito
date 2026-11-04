#!/usr/bin/env node
/**
 * Client 一键发版到 R2：上传 updater 载荷（+ 多语言 .msi），覆盖渠道 latest.json。
 *
 * updater 载荷两种形态都支持，按 mtime 取新的一份（详见 find-client-bundle.ts）：
 * - `{productName}_{version}_{arch}-setup.exe` + `.exe.sig`：Tauri CLI 2.12+ 的默认产物
 *   （按 bundle 类型直接签安装器，不再产出 nsis.zip；tauri-plugin-updater 认得裸 exe）
 * - `{productName}_{version}_{arch}-setup.nsis.zip` + `.zip.sig`：老格式，仍兼容
 *
 * 产物目录：`--dir` > 环境变量 `CARGO_TARGET_DIR` > `apps/client/src-tauri/target/release/bundle`
 * 文件名：按 tauri.conf.json 的 productName + version（或 --release）+ 本机 arch 精确匹配。
 *
 *   pnpm command distribution publish:client --channel stable
 *   pnpm command distribution publish:client --release 1.5.0 --channel stable
 *   pnpm command distribution publish:client --dir <bundle> --channel alpha
 */
import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { findPublicUrl, findUpdaterEndpoint, PUBLIC_BASE } from '../src/public-base.ts'
import {
  findArtifactBaseName,
  findClientBundleInventory,
  formatInventoryLines
} from './find-client-bundle.ts'
import { parseArgs, runMain } from './upload-args.ts'
import { OPTIONAL_TOOL_FILES, checkVariantGuard, parseVariant } from './variant-guard.ts'
import { findAuthKey, putBytesViaWorker, uploadFileViaWorker } from './worker-upload.ts'

const CHANNELS = new Set(['stable', 'alpha', 'beta', 'rc'])

const USAGE = `用法: publish-client [--release <x.y.z>] [--channel stable] [--dir <bundle>] [选项]

按 tauri.conf.json 的 productName / version 与本机平台，在 bundle 目录内精确匹配：
  - {productName}_{version}_{arch}-setup.exe + .exe.sig（updater 载荷，Tauri CLI 2.12+）
  - {productName}_{version}_{arch}-setup.nsis.zip + .zip.sig（老格式，仍兼容）
  - {productName}_{version}_{arch}_{locale}.msi（可选，如 zh-CN / en-US）
两种 updater 载荷都在时取 mtime 更新的那一份，避免把上一版安装包当成新版推出去。
上传到 R2，并覆盖 updater-{channel}/latest.json。

bundle 目录优先级：
  1. --dir
  2. 环境变量 CARGO_TARGET_DIR → <CARGO_TARGET_DIR>/release/bundle（含常见 triple 子目录）
  3. apps/client/src-tauri/target/release/bundle

选项:
  --release <x.y.z>        版本（默认读 tauri.conf.json；可含 -alpha.1 等）
  --channel <名>           stable | alpha | beta | rc（默认 stable）
  --dir <bundle>           显式指定 Tauri bundle 根目录
  --worker <base url>      端点地址（默认 ${PUBLIC_BASE}）
  --auth-key-file <文件>   AUTH_KEY_SECRET；不给则读环境变量
  --notes <文案>           latest.json notes（默认 Client <version> (<channel>)）
  --skip-exe               updater 载荷是 zip 时，不再额外上传 *-setup.exe
  --skip-msi               不上传 *.msi
  --variant <slim|full>    产物档位（默认 slim；full 会校验 pandoc/ffmpeg/ffprobe 齐全）
  --allow-full             精简版产物里混进可选件时仍允许上传（默认拒绝）
  --dry-run                只扫描并打印产物清单（不鉴权、不上传）
  --help                   显示本帮助`

/**
 * 清点产物树里的文件名。
 *
 * 为什么要扫**多个根**：Windows 上 externalBin / resources 直接落在
 * `target/release/`（bundle 的父目录），`bundle/` 下面只有安装包本身。只扫 bundle
 * 会永远看不到侧车与可选件 —— 档位判断和必需件断言都会变成空断言。
 *
 * 父目录只读顶层（depth 0）：`target/release/` 下面还有 deps/ 与 build/，
 * 递归进去要扫几十万项，而 sidecar 就在顶层。
 */
async function findArtifactFiles(
  roots: readonly { dir: string; depth: number }[]
): Promise<string[]> {
  const found = new Set<string>()

  async function walk(dir: string, depth: number, maxDepth: number): Promise<void> {
    if (depth > maxDepth) return
    const entries = await readdir(dir, { withFileTypes: true }).catch(function (error) {
      console.warn(`[publish-client] 跳过无法读取的目录 ${dir}: ${String(error)}`)
      return null
    })
    if (!entries) return
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), depth + 1, maxDepth)
      } else {
        found.add(entry.name)
      }
    }
  }

  for (const root of roots) {
    await walk(root.dir, 0, root.depth)
  }
  return [...found].sort()
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.has('help')) {
    console.log(USAGE)
    return
  }

  const release = args.get('release') ?? args.get('version')
  if (release && !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$/.test(release)) {
    throw new Error(`--release 须形如 x.y.z 或 x.y.z-alpha.1\n\n${USAGE}`)
  }

  const channel = args.get('channel') ?? 'stable'
  if (!CHANNELS.has(channel)) {
    throw new Error(`--channel 只能是 ${[...CHANNELS].join(' | ')}: ${channel}`)
  }

  const skipExe = args.get('skip-exe') === 'true'
  const skipMsi = args.get('skip-msi') === 'true'
  const isDryRun = args.get('dry-run') === 'true'
  const variant = parseVariant(args.get('variant'))
  const allowFull = args.get('allow-full') === 'true'

  const inventory = await findClientBundleInventory({
    explicitDir: args.get('dir'),
    release,
    skipExe,
    skipMsi
  })

  console.log('产物清单:')
  for (const line of formatInventoryLines(inventory)) {
    console.log(`  ${line}`)
  }

  // 发布守卫：默认只放行精简版（完整版必须显式 --allow-full / --variant full），
  // 同时确认必需件（corex-daemon / goose / pdfium …）真的在产物树里。
  const files = await findArtifactFiles([
    // bundle 里是安装包，往下 4 层足够（nsis/ msi/ 之类）
    { dir: inventory.bundleDir, depth: 4 },
    // 构建树父目录只读顶层：sidecar / 资源就在这一层
    { dir: dirname(inventory.bundleDir), depth: 0 }
  ])
  const guard = checkVariantGuard({
    variant,
    files,
    allowFull,
    // --dir 指向搬过来的产物时没有构建树可比对，断言必会误拦，交给调用方关掉
    expectCoreFiles: inventory.source !== 'dir'
  })
  if (!guard.ok) throw new Error(guard.reason)
  const optionalFiles = files.filter(function (name) {
    return (OPTIONAL_TOOL_FILES as readonly string[]).includes(name)
  })
  console.log(
    `打包档位: ${variant}` +
      (optionalFiles.length > 0 ? ` · 含 ${optionalFiles.join(' / ')}` : ' · 无完整版大件')
  )

  if (isDryRun) {
    console.log('')
    console.log('dry-run：未上传')
    return
  }

  if (!inventory.updatePath || !inventory.updateSigPath || !inventory.updateKind) {
    const base = findArtifactBaseName(inventory.productName, inventory.version, inventory.arch)
    throw new Error(
      `updater 产物不齐（需要 ${base}.exe + .exe.sig 或 ${base}.nsis.zip + .zip.sig）。` +
        '请先 tauri build（createUpdaterArtifacts 会签安装器），或手动 zip+signer。'
    )
  }

  const worker = (args.get('worker') ?? PUBLIC_BASE).replace(/\/+$/, '')
  if (!worker.startsWith('http')) {
    throw new Error(`--worker 要是 http(s) 地址: ${worker}`)
  }
  const authKey = findAuthKey(args.get('auth-key-file'))

  const artifacts = {
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

  const version = artifacts.version
  const notes = args.get('notes') ?? `Client ${version} (${channel})`

  const manifestName = basename(artifacts.updatePath).replace(/ /g, '.')
  const manifestKeyForPayload = `${version}/${manifestName}`

  await uploadFileViaWorker({
    worker,
    key: manifestKeyForPayload,
    source: artifacts.updatePath,
    authKey
  })

  // 新格式下 updater 载荷本身就是 setup.exe，不再重复上传；老格式（zip）才补一份 exe。
  const extraExe =
    artifacts.updateKind === 'installer' || skipExe ? undefined : artifacts.exePath
  const exeKey = extraExe
    ? `${version}/${basename(extraExe).replace(/ /g, '.')}`
    : artifacts.updateKind === 'installer'
      ? manifestKeyForPayload
      : undefined
  if (extraExe && exeKey) {
    await uploadFileViaWorker({
      worker,
      key: exeKey,
      source: extraExe,
      authKey
    })
  } else if (!skipExe && !artifacts.exePath) {
    console.warn(
      `未找到 ${artifacts.productName}_${version}_${artifacts.arch}-setup.exe，跳过 NSIS 安装包`
    )
  }

  const msiKeys: string[] = []
  for (const msiPath of artifacts.msiPaths) {
    const msiName = basename(msiPath).replace(/ /g, '.')
    const msiKey = `${version}/${msiName}`
    await uploadFileViaWorker({
      worker,
      key: msiKey,
      source: msiPath,
      authKey
    })
    msiKeys.push(msiKey)
  }
  if (!skipMsi && artifacts.msiPaths.length === 0) {
    console.warn(
      `未找到 ${artifacts.productName}_${version}_${artifacts.arch}_*.msi，跳过 MSI 上传`
    )
  }

  const signature = (await readFile(artifacts.updateSigPath, 'utf8')).trim()
  const pubDate = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  // 平台键只用 `windows-x86_64`：tauri-plugin-updater 查找顺序是
  // `{os}-{arch}-{installer}` → `{os}-{arch}`，发基础键对两种形态、新旧客户端都命中。
  const manifest = {
    version,
    notes,
    pub_date: pubDate,
    platforms: {
      'windows-x86_64': {
        signature,
        url: findPublicUrl(manifestKeyForPayload)
      }
    }
  }

  const latestKey = `updater-${channel}/latest.json`
  const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`
  await putBytesViaWorker({
    worker,
    key: latestKey,
    body: manifestBody,
    contentType: 'application/json; charset=utf-8',
    authKey
  })

  const endpoint = findUpdaterEndpoint(channel)
  console.log('')
  console.log('发版完成')
  console.log(`  updater ${artifacts.updateKind}: ${findPublicUrl(manifestKeyForPayload)}`)
  if (exeKey && exeKey !== manifestKeyForPayload) {
    console.log(`  setup exe:    ${findPublicUrl(exeKey)}`)
  }
  for (const msiKey of msiKeys) {
    console.log(`  setup msi:    ${findPublicUrl(msiKey)}`)
  }
  console.log(`  latest.json:  ${findPublicUrl(latestKey)}`)
  console.log(`  endpoints:    ${endpoint}`)
}

await runMain(main)
