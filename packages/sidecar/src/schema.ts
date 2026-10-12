/**
 * 侧车产物的**唯一契约**：`tools.lock.json` / 在线包 `manifest.json` / 落盘 `checksums.json`
 * 三份 JSON 共用一套词汇，三个消费方也共用这一份类型与解析器：
 *
 * | 文档                       | 谁写              | 谁读                                            |
 * | -------------------------- | ----------------- | ----------------------------------------------- |
 * | `tools.lock.json`          | 人（发版改 pin）  | CLI（下载/落盘）、宿主（版本对齐的测试）        |
 * | `sidecar/manifest.json`    | 人                | 宿主（运行时下载）、CLI（核对 R2 上的包）       |
 * | `staging/<平台>/checksums.json` | CLI `sidecar stage` | CLI `sidecar verify`、forge 打包钩子       |
 *
 * 四条约定，改一份就是改三份：
 * - **`schemaVersion`**：三份都写、同一个号。形状一变就一起加，旧文件由解析器**响亮拒绝**
 *   （以前 checksums 压根没有这个字段，forge 只能拿文件名正则去猜哪个是按需工具）。
 * - **`platforms`**：凡按平台索引的映射一律叫这个名字，键是 `win32-x64` 这种 `<platform>-<arch>`；
 *   值统一是「该平台的那一份下载物」——lock 的 pin（`version` + 直链 + `sha256`）、
 *   manifest 的在线包（直链 + `sha256`）。
 * - **`sha256`**：哈希字段一律叫这个名字。checksums 不再是「文件名 → 裸哈希」的映射，
 *   而是「文件名 → 这份文件是谁（`tool` + `version`）+ 校验和」——落盘目录因此能自证版本，
 *   不用再教人手工跑 `opencode.exe --version` 去对 pin。
 * - **`onDemand`**：写在这条自己所描述的对象上（工具 / 落盘文件），不再另立顶层清单。
 *
 * 只放**形状**：读文件、下载、算哈希各归各家（CLI 的 `infra/`、forge 的 `hooks/`），
 * 这样契约包是纯的——渲染进程也能 import（`TOOL_KEYS` 就来自这里）。
 */

/** 三份 JSON 共用的形状版本；任一文档改形状都跟着 +1 */
const SIDECAR_SCHEMA_VERSION = 2

/** 侧车工具键全集：与 CLI 的 `TOOLS` 注册表一一对应（少一个/多一个都编译不过） */
const SIDECAR_TOOL_KEYS = ['corex', 'ffmpeg', 'goose', 'opencode', 'pandoc', 'pdfium'] as const

/**
 * 在线包工具（= lock 里标 `onDemand` 的那批 = manifest 的 `tools` keys）。
 * 也是 IPC 的取值域：`install` / `remove` 只认这几个。
 */
const ONLINE_TOOL_KEYS = ['pandoc', 'ffmpeg', 'opencode'] as const

type SidecarToolKey = (typeof SIDECAR_TOOL_KEYS)[number]
type OnlineToolKey = (typeof ONLINE_TOOL_KEYS)[number]
/** 平台键：`win32-x64`（`${platform}-${arch}`） */
type SidecarPlatformKey = string

/** 一份平台下载物：直链 + 哈希 */
interface SidecarPackage {
  url: string
  sha256: string
}

/** lock 的 pin：一份平台下载物 + 钉住的版本 */
interface SidecarPin extends SidecarPackage {
  version: string
}

/** lock 里一个工具：`onDemand` = 不进安装包，改由运行时在线下载 */
interface LockedTool {
  onDemand?: boolean
  platforms: Record<SidecarPlatformKey, SidecarPin>
}

/** `tools.lock.json`：唯一钉版本的地方（corex / goose / 在线包没发的平台都靠它） */
interface ToolsLock {
  schemaVersion: number
  tools: Record<string, LockedTool>
}

/** manifest 里一个工具：界面文案 + 归档里要留下的文件名 + 各平台在线包 */
interface OnlineTool {
  label: string
  summary: string
  version: string
  binaries: string[]
  platforms: Record<SidecarPlatformKey, SidecarPackage>
}

/** `sidecar/manifest.json`：运行时下载用的在线包清单（宿主构建期内联） */
interface OnlineManifest {
  schemaVersion: number
  tools: Record<string, OnlineTool>
}

/** 落盘的一个文件：谁（`tool` + `version`）+ 校验和 + 是否按需 */
interface StagedFile {
  tool: string
  version: string
  sha256: string
  onDemand?: boolean
}

/** `staging/<平台>/checksums.json`：落盘目录的自证清单（打包与 verify 都按它走） */
interface StagingChecksums {
  schemaVersion: number
  platform: SidecarPlatformKey
  files: Record<string, StagedFile>
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSidecarToolKey(value: string): value is SidecarToolKey {
  return (SIDECAR_TOOL_KEYS as readonly string[]).includes(value)
}

function requireRecord(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`[sidecar-schema] ${where} 应为对象`)
  }
  return value
}

function requireText(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`[sidecar-schema] ${where} 应为非空字符串`)
  }
  return value
}

function requireSha256(value: unknown, where: string): string {
  const text = requireText(value, where)
  if (!SHA256_PATTERN.test(text)) {
    throw new Error(`[sidecar-schema] ${where} 应为 64 位十六进制 sha256，实际: ${text}`)
  }
  return text
}

/** 直链必须是 https（写死 R2 / GitHub Releases 的固定地址，不允许浮动） */
function requireHttpsUrl(value: unknown, where: string): string {
  const text = requireText(value, where)
  if (!text.startsWith('https://')) {
    throw new Error(`[sidecar-schema] ${where} 应为 https 直链，实际: ${text}`)
  }
  return text
}

function requireSchemaVersion(doc: Record<string, unknown>, where: string): void {
  if (doc.schemaVersion !== SIDECAR_SCHEMA_VERSION) {
    throw new Error(
      `[sidecar-schema] ${where} 的 schemaVersion 应为 ${SIDECAR_SCHEMA_VERSION}，` +
        `实际 ${String(doc.schemaVersion)}（形状见 packages/sidecar/src/schema.ts）`
    )
  }
}

function requirePlatforms(value: unknown, where: string): Record<string, unknown> {
  const platforms = requireRecord(value, where)
  if (Object.keys(platforms).length === 0) {
    throw new Error(`[sidecar-schema] ${where} 至少要声明一个平台`)
  }
  return platforms
}

function parsePackage(raw: unknown, where: string): SidecarPackage {
  const doc = requireRecord(raw, where)
  return {
    url: requireHttpsUrl(doc.url, `${where}.url`),
    sha256: requireSha256(doc.sha256, `${where}.sha256`)
  }
}

function parsePin(raw: unknown, where: string): SidecarPin {
  const doc = requireRecord(raw, where)
  return {
    version: requireText(doc.version, `${where}.version`),
    ...parsePackage(raw, where)
  }
}

/** `tools.lock.json` */
function parseToolsLock(raw: unknown, where = 'tools.lock.json'): ToolsLock {
  const doc = requireRecord(raw, where)
  requireSchemaVersion(doc, where)
  const tools = requireRecord(doc.tools, `${where}.tools`)

  const parsed: Record<string, LockedTool> = {}
  for (const [toolKey, rawTool] of Object.entries(tools)) {
    const tool = requireRecord(rawTool, `${where}.tools.${toolKey}`)
    if (tool.onDemand !== undefined && typeof tool.onDemand !== 'boolean') {
      throw new Error(`[sidecar-schema] ${where}.tools.${toolKey}.onDemand 应为布尔值`)
    }
    const platforms = requirePlatforms(tool.platforms, `${where}.tools.${toolKey}.platforms`)
    const pins: Record<string, SidecarPin> = {}
    for (const [platformKey, rawPin] of Object.entries(platforms)) {
      pins[platformKey] = parsePin(rawPin, `${where}.tools.${toolKey}.platforms.${platformKey}`)
    }
    parsed[toolKey] = tool.onDemand === true ? { onDemand: true, platforms: pins } : { platforms: pins }
  }

  return { schemaVersion: SIDECAR_SCHEMA_VERSION, tools: parsed }
}

/** `sidecar/manifest.json` */
function parseOnlineManifest(raw: unknown, where = 'sidecar/manifest.json'): OnlineManifest {
  const doc = requireRecord(raw, where)
  requireSchemaVersion(doc, where)
  const tools = requireRecord(doc.tools, `${where}.tools`)

  const parsed: Record<string, OnlineTool> = {}
  for (const [toolKey, rawTool] of Object.entries(tools)) {
    const tool = requireRecord(rawTool, `${where}.tools.${toolKey}`)
    const binaries = tool.binaries
    if (!Array.isArray(binaries) || binaries.length === 0) {
      throw new Error(`[sidecar-schema] ${where}.tools.${toolKey}.binaries 应为非空数组`)
    }
    const platforms = requireRecord(tool.platforms, `${where}.tools.${toolKey}.platforms`)
    const packages: Record<string, SidecarPackage> = {}
    for (const [platformKey, rawPackage] of Object.entries(platforms)) {
      packages[platformKey] = parsePackage(
        rawPackage,
        `${where}.tools.${toolKey}.platforms.${platformKey}`
      )
    }
    parsed[toolKey] = {
      label: requireText(tool.label, `${where}.tools.${toolKey}.label`),
      summary: requireText(tool.summary, `${where}.tools.${toolKey}.summary`),
      version: requireText(tool.version, `${where}.tools.${toolKey}.version`),
      binaries: binaries.map(function (name: unknown, index: number) {
        return requireText(name, `${where}.tools.${toolKey}.binaries[${index}]`)
      }),
      platforms: packages
    }
  }

  return { schemaVersion: SIDECAR_SCHEMA_VERSION, tools: parsed }
}

/** `staging/<平台>/checksums.json` */
function parseStagingChecksums(raw: unknown, where = 'checksums.json'): StagingChecksums {
  const doc = requireRecord(raw, where)
  requireSchemaVersion(doc, where)
  const platform = requireText(doc.platform, `${where}.platform`)
  const files = requireRecord(doc.files, `${where}.files`)

  const parsed: Record<string, StagedFile> = {}
  for (const [fileName, rawFile] of Object.entries(files)) {
    const file = requireRecord(rawFile, `${where}.files["${fileName}"]`)
    const tool = requireText(file.tool, `${where}.files["${fileName}"].tool`)
    if (!isSidecarToolKey(tool)) {
      throw new Error(
        `[sidecar-schema] ${where}.files["${fileName}"].tool 不是已知工具: ${tool}` +
          `（可选: ${SIDECAR_TOOL_KEYS.join(' / ')}）`
      )
    }
    if (file.onDemand !== undefined && typeof file.onDemand !== 'boolean') {
      throw new Error(`[sidecar-schema] ${where}.files["${fileName}"].onDemand 应为布尔值`)
    }
    parsed[fileName] =
      file.onDemand === true
        ? {
            tool,
            version: requireText(file.version, `${where}.files["${fileName}"].version`),
            sha256: requireSha256(file.sha256, `${where}.files["${fileName}"].sha256`),
            onDemand: true
          }
        : {
            tool,
            version: requireText(file.version, `${where}.files["${fileName}"].version`),
            sha256: requireSha256(file.sha256, `${where}.files["${fileName}"].sha256`)
          }
  }

  return { schemaVersion: SIDECAR_SCHEMA_VERSION, platform, files: parsed }
}

function findLockedTool(lock: ToolsLock, toolKey: string): LockedTool | null {
  return lock.tools[toolKey] ?? null
}

function findLockPin(
  lock: ToolsLock,
  toolKey: string,
  platformKey: SidecarPlatformKey
): SidecarPin | null {
  return findLockedTool(lock, toolKey)?.platforms[platformKey] ?? null
}

function hasLockPin(lock: ToolsLock, toolKey: string, platformKey: SidecarPlatformKey): boolean {
  return findLockPin(lock, toolKey, platformKey) !== null
}

/** 同 `findLockPin`，但缺了直接抛（发版漏平台这类错误不该静默） */
function requireLockPin(
  lock: ToolsLock,
  toolKey: string,
  platformKey: SidecarPlatformKey
): SidecarPin {
  const pin = findLockPin(lock, toolKey, platformKey)
  if (!pin) {
    throw new Error(`[sidecar-schema] tools.lock.json 里没有 ${toolKey} 的 ${platformKey} pin`)
  }
  return pin
}

/** 这个工具是不是「按需」（不进安装包，运行时在线下载） */
function isOnDemandTool(lock: ToolsLock, toolKey: string): boolean {
  return findLockedTool(lock, toolKey)?.onDemand === true
}

/** lock 里所有按需工具（= manifest 的 keys，`schema.test.ts` 与宿主测试守着） */
function listOnDemandTools(lock: ToolsLock): string[] {
  return Object.keys(lock.tools).filter(function (toolKey) {
    return isOnDemandTool(lock, toolKey)
  })
}

function findOnlineTool(manifest: OnlineManifest, toolKey: string): OnlineTool | null {
  return manifest.tools[toolKey] ?? null
}

/** 当前平台的那份在线包；没发这个平台就是 null（界面如实说明，不给下载按钮） */
function findOnlinePackage(
  manifest: OnlineManifest,
  toolKey: string,
  platformKey: SidecarPlatformKey
): SidecarPackage | null {
  return findOnlineTool(manifest, toolKey)?.platforms[platformKey] ?? null
}

/** 落盘清单里标了按需的文件名（forge 精简版据此把整包排除在外） */
function listOnDemandFiles(checksums: StagingChecksums): string[] {
  return Object.keys(checksums.files).filter(function (fileName) {
    return checksums.files[fileName]?.onDemand === true
  })
}

function findPlatformKey(platform: string = process.platform, arch: string = process.arch): string {
  return `${platform}-${arch}`
}

/** 二进制文件名：Windows 补 `.exe`，其它平台原样 */
function findBinaryName(name: string, platform: string = process.platform): string {
  return platform === 'win32' ? `${name}.exe` : name
}

export {
  findBinaryName,
  findLockPin,
  findLockedTool,
  findOnlinePackage,
  findOnlineTool,
  findPlatformKey,
  hasLockPin,
  isOnDemandTool,
  listOnDemandFiles,
  listOnDemandTools,
  parseOnlineManifest,
  parseStagingChecksums,
  parseToolsLock,
  requireLockPin,
  ONLINE_TOOL_KEYS,
  SIDECAR_SCHEMA_VERSION,
  SIDECAR_TOOL_KEYS
}
export type {
  LockedTool,
  OnlineManifest,
  OnlineTool,
  SidecarPackage,
  SidecarPin,
  SidecarPlatformKey,
  SidecarToolKey,
  OnlineToolKey,
  StagedFile,
  StagingChecksums,
  ToolsLock
}
