# @i-thinking/sidecar

侧车产物的**唯一契约**：三份 JSON 的形状（类型 + 解析器）都在这里，CLI、Studio 宿主、forge 打包钩子共用。

| 文档                                                                         | 谁写                | 谁读                                      |
| ---------------------------------------------------------------------------- | ------------------- | ----------------------------------------- |
| [`tools.lock.json`](../../scripts/commands/features/sidecar/tools.lock.json) | 人（发版改 pin）    | CLI（下载/落盘）、宿主（版本对齐的测试）  |
| [`manifest.json`](../../apps/studio/sidecar/manifest.json)                   | 人                  | 宿主（运行时下载）、CLI（核对 R2 上的包） |
| `staging/<平台>/checksums.json`、`src-tauri/binaries/checksums.json`         | CLI `sidecar stage` | CLI `sidecar verify`、forge 打包钩子      |

## 四条约定

- **`schemaVersion`**：三份都写、同一个号（当前 `2`）。形状一变就一起加，旧文件由解析器**响亮拒绝**，
  而不是被猜着读 —— checksums 以前压根没有这个字段，forge 只能拿文件名正则去猜哪个是按需工具。
- **`platforms`**：凡按平台索引的映射一律叫这个名字，键是 `win32-x64` 这种 `<platform>-<arch>`。
  值是「该平台的那一份下载物」——lock 的 pin 是 `{ version, url, sha256 }`；manifest 的在线包是
  `{ url, sha256 }`（`version` 在工具级：当前平台没发包时，界面仍要如实显示版本）。
- **`sha256`**：哈希字段一律叫这个名字。checksums 不再是「文件名 → 裸哈希」，而是
  「文件名 → `{ tool, version, sha256, onDemand? }`」——落盘目录因此能自证版本，
  不用再手工跑 `opencode.exe --version` 去对 pin。
- **`onDemand`**：写在这条自己所描述的对象上（lock 的工具 / checksums 的文件），不再另立顶层清单。

## 只放形状

读文件、下载、算哈希各归各家（CLI 的 [`infra/`](../../scripts/commands/features/sidecar/infra)、
forge 的 [`hooks/sidecar.ts`](../../apps/studio/forge/hooks/sidecar.ts)）。本包零依赖、不碰 node 内建模块，
所以渲染进程也能 import（IPC 的取值域 `TOOL_KEYS` 就来自这里）。

## 工具键

- `SIDECAR_TOOL_KEYS`：全集，与 CLI 的 `TOOLS` 注册表一一对应（少一个 / 多一个都编译不过）。
- `ONLINE_TOOL_KEYS`：在线包工具 = `tools.lock.json` 里标 `onDemand` 的那批 = `manifest.json` 的 keys；
  三处一致由 [`catalog.test.ts`](../../apps/studio/src/host/capabilities/tools/catalog.test.ts) 守着。

## 用法

```ts
import {
  findLockPin,
  listOnDemandFiles,
  parseStagingChecksums,
  parseToolsLock
} from '@i-thinking/sidecar'

const lock = parseToolsLock(JSON.parse(readFileSync(lockPath, 'utf8')) as unknown, lockPath)
findLockPin(lock, 'pandoc', 'win32-x64')?.version
listOnDemandFiles(
  parseStagingChecksums(JSON.parse(readFileSync(checksumsPath, 'utf8')), checksumsPath)
)
```

```bash
pnpm --filter @i-thinking/sidecar test:unit
```
