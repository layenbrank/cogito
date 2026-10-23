# Studio 打包指南

## 1. 构建工具

- **Electron Forge** + `@electron-forge/plugin-vite`
- Windows 安装程序走社区 NSIS maker（`@felixrieseberg/electron-forge-maker-nsis`，兼容 Forge 7.x）；其内部用 `app-builder-lib` 打 NSIS，**不是**把整个工程切到 electron-builder
- 配置入口：[forge.config.ts](../../../apps/studio/forge.config.ts)（组装 [forge/](../../../apps/studio/forge/) 模块）
  - `forge/constants.ts` — appId / AUMID / 名称 / 版本
  - `forge/env.ts` — 签名 / 可选 makers / 发布 / 更新相关环境变量
  - `forge/packager.ts` — asar、ignore、afterCopy、Windows/macOS 签名
  - `forge/makers.ts` — 默认 NSIS + ZIP；可选 WiX / MSIX / Flatpak
  - `forge/publishers.ts` — GitHub Releases / S3（默认关闭）
  - `forge/plugins.ts` — Vite / Fuses / AutoUnpackNatives
  - `forge/hooks/external-deps.ts` — Vite external（better-sqlite3）及依赖闭包复制
  - `forge/hooks/sidecar.ts` — 侧车复制 + SHA-256 校验（lite/`onDemand`）
  - `nsis/installer-hooks.nsh` — 安装前/卸载前杀 `corex-daemon.exe`

构建产物目录：**仅** `out/studio/`（仓库根目录下）。

| 进程     | 入口                               | 输出                                     |
| -------- | ---------------------------------- | ---------------------------------------- |
| Main     | `src/main.ts`                      | `.vite/build/main.js`（CJS）             |
| Preload  | `src/preload.ts`                   | `.vite/build/preload.js`（CJS，sandbox） |
| Renderer | `src/renderer.tsx`（`index.html`） | Forge `main_window`                      |

`appId` / AUMID：`com.cogito.studio`。

## 2. 常用命令

```bash
pnpm --filter @cogito/studio dev
pnpm command sidecar bootstrap studio            # 全量落盘（档位不在这里决定）
pnpm --filter @cogito/studio package
pnpm --filter @cogito/studio package:full
pnpm --filter @cogito/studio make            # 默认：NSIS Setup.exe + ZIP（lite）
pnpm --filter @cogito/studio make:nsis       # 同 make:win，显式 NSIS
pnpm --filter @cogito/studio make:full
# Windows MSI / MSIX（在默认 NSIS+ZIP 之外额外产出；需本机工具链）
pnpm --filter @cogito/studio make:msi
pnpm --filter @cogito/studio make:msix
# 发版（需开启 publishers 环境变量）
pnpm --filter @cogito/studio publish
```

**默认 Windows 产物路径：**

| 产物 | 路径 |
| ---- | ---- |
| NSIS Setup | `out/studio/make/nsis/x64/*Setup*.exe` |
| `latest.yml`（electron-updater） | `out/studio/make/nsis/x64/latest.yml` |
| 便携 ZIP | `out/studio/make/zip/win32/x64/*.zip` |
| 未打包目录 | `out/studio/cogito-win32-x64/` |
| MSI（可选） | `out/studio/make/wix/x64/*.msi` |

**两档产物：** `package` / `make` / `publish` 默认 **精简版（lite）** —— pandoc / ffmpeg / opencode
不进安装包，由 Studio 运行时在线下载（见 [development.md](./development.md#两档产物精简版--完整版)）；
`*:full` 内置全部侧车。**档位只有这一个决策点**（`apps/studio/scripts/run-forge.ts` 把它作为
`STUDIO_SIDECAR_VARIANT` 传入 `forge/env.ts`，过滤发生在 `forge/hooks/sidecar.ts`，依据是 staging 的
`checksums.json` 里逐文件的 `onDemand`）；落盘那一步一律全量，所以切档不用重跑 bootstrap。

**精简版却打到 500MB+？** 先看日志里那句 `侧车档位 lite：已复制 N 个文件，未随包：…`：没有「未随包」
就说明 forge 认为这些文件该随包（整包自然还是 800MB+）。两种可能：

- `apps/studio/sidecar/staging/<platform>/checksums.json` 是旧版（没有 `schemaVersion: 2` 与逐文件
  `onDemand`）—— 现在会**直接报错失败**（以前是静默按文件名正则猜，猜漏就把整包打进去）；
- `tools.lock.json` 里 pandoc / ffmpeg / opencode 的 `onDemand` 丢了 —— 按需由它决定，补回来。

```bash
pnpm command sidecar stage studio   # 重写 checksums（逐文件标 onDemand），且不落 goose
pnpm --filter @cogito/studio make
```

日志应类似：`侧车档位 lite：已复制 N 个文件，未随包：pandoc.exe, ffmpeg.exe, …`。

### 和 Client（Tauri）安装包的对应关系

| 形态 | Client（Tauri） | Studio（Electron Forge） |
| ---- | --------------- | ------------------------ |
| 默认 Windows 安装程序 | NSIS `.exe` | NSIS Setup.exe（`@felixrieseberg/electron-forge-maker-nsis` + `electron-updater`） |
| MSI | WiX（`targets: all` / release 流水线） | `make:msi` → MakerWix（企业旁路；需 [WiX Toolset v3](https://wixtoolset.org/)） |
| 商店包 | — | `make:msix`（需 Windows SDK / makeappx） |
| 便携 | — | ZIP（默认随 `make` 产出） |

Squirrel（`RELEASES` / `.nupkg` / `electron.autoUpdater`）已从默认路径移除，避免双栈混淆。

#### Client NSIS → Studio NSIS 对齐表

Client：`apps/client/src-tauri/tauri.conf.json`（`bundle.windows.nsis`）+ `nsis/installer-hooks.nsh`。
Studio：`apps/studio/forge/makers.ts` + `nsis/installer-hooks.nsh`（经 maker 的 `getAppBuilderConfig().nsis` 交给 app-builder-lib）。

| Client（NSIS） | Studio NSIS | 对齐？ |
| -------------- | ----------- | ------ |
| `languages: SimpChinese, English` | `installerLanguages: ['zh_CN', 'en_US']`，`displayLanguageSelector: false` | ✅ |
| `installMode: currentUser` | `perMachine: false` + `customInstallMode` 强制当前用户 | ✅ |
| `startMenuFolder: cogito` | `menuCategory` / `shortcutName` | ✅ |
| `installerIcon` | `installerIcon` ← `resources/icon.ico` | ✅ |
| `installerHooks` 杀 `corex-daemon` | `customInit` / `customUnInit` 用 `taskkill`（无 Tauri 插件） | ✅（实现不同） |
| `compression: lzma` | app-builder-lib 默认 | 部分（未单独钉死） |
| 升级签名 / WebView2 等 | Electron 自带运行时，无 WebView2 bootstrap | ❌（平台差异） |

#### Client / Studio → MakerWix（可选 MSI）对齐表

| Client（NSIS / WiX） | Studio MakerWix | 说明 |
| -------------------- | --------------- | ---- |
| `publisher: layen` | `manufacturer: layen`（`APP_PUBLISHER`） | 产品名与发布者 |
| `wix.language: zh-CN, en-US` | `language: 2052` + `cultures: zh-CN;en-US` | Product 语言以简中为主 |
| `nsis.installMode: currentUser` | `defaultInstallMode: perUser` + `beforeCreate` 修补 | 去掉上游 `InstallScope`，靠 `MSIINSTALLPERUSER` 重定向到 `%LOCALAPPDATA%\Programs\cogito\`；产品名无 Machine 后缀 |
| `nsis.startMenuFolder: cogito` | `shortcutFolderName` / `shortcutName` | 开始菜单文件夹 |
| `nsis.installerIcon` | `icon` ← `resources/icon.ico` | 与 Client 同源 |
| AUMID | `appUserModelId` = `com.cogito.studio` | 与 `main.ts` 一致 |
| （升级身份） | **固定** `upgradeCode`（`WIX_UPGRADE_CODE`） | 必须钉死才能覆盖升级 |
| `nsis.installerHooks` | — | MSI **无** NSIS hooks；升级前请先退出 Studio / 停侧车 |
| — | `features.autoUpdate/autoLaunch: false` | 更新走 NSIS + electron-updater |

#### 何时用 NSIS vs MSI（重要）

| 场景 | 用哪个 | 原因 |
| ---- | ------ | ---- |
| 日常下载 / 自动更新 / 给普通用户 | **NSIS** `Setup.exe`（默认 `make`） | 与 Client 一致；`electron-updater` 只认 NSIS feed |
| 企业 SCCM / Intune 等要求 MSI | `make:msi` 旁路 | Forge + `electron-wix-msi` 对大 Electron 包偏脆；需本机 WiX v3 |

**已知 MSI 限制（Forge WiX / electron-wix-msi）：**

- 无 NSIS 的 `installerHooks`（升级前请先退出 Studio / 杀 `corex-daemon`）
- 自动更新仍走 NSIS + `latest.yml`，**不要**把 MSI 当 update 包
- 上游模板默认标题带 `(Machine - MSI)`，且同时写 `InstallScope=perUser` + `MSIINSTALLPERUSER` 会让引擎删掉后者、目录仍指向 `C:\Program Files`（1303）；本仓库用 `beforeCreate`（`patchWixCreatorForPerUser`）去掉 InstallScope / Machine 文案并改用 MediaTemplate
- 曾装过旧「Machine」包的机器可能残留 per-machine 产品，与新的 per-user 包**不会**互相 MajorUpgrade；需管理员卸载旧包后再装
- 错误 **2349**（Copy resumed with different info）常见于 CAB/中断安装/混用旧包；优先清残留后重装，日常请改用 NSIS

#### 安装 WiX Toolset v3（打 MSI 必装）

Forge 的 MakerWix / `electron-wix-msi` 依赖 WiX **v3** 的 `candle.exe` 与 `light.exe`（**不要**装 WiX v4/v5）。

```powershell
choco install wixtoolset --version=3.14.0 -y
# 新开终端后：
candle -?
light -?
```

```powershell
# 精简版 MSI；完整版用 make:msi:full
pnpm --filter @cogito/studio make:msi
# 产物：out/studio/make/wix/x64/*.msi（同一次 make 仍会打 NSIS + ZIP）
```

也可用 runner 开关：`node apps/studio/scripts/run-forge.ts make lite --wix`。

#### `make:msi` 常见失败（已踩坑）

| 现象 | 原因 | 处理 |
| ---- | ---- | ---- |
| `Could not find light.exe or candle.exe` | 未装 WiX v3，或当前进程 PATH 没有其 bin | 见上文；`make:msi` 会经 `run-forge.ts` 尝试注入常见 WiX bin |
| Making nsis / zip / wix 一并 ✖ | Forge 并行 maker，WiX 失败打断整次 `make` | 先修好 WiX；不需要 MSI 时用 `make` / `make:nsis` |
| `[sass] JSONError … package.json … trailing comma` | `package.json` 尾逗号 | 去掉尾逗号后再 `make` |
| 安装 UI 标题仍是 `(Machine - MSI)` | 旧 MSI（未打 `beforeCreate` 补丁） | 用当前仓库重打；卸载旧包后再装 |
| 错误 **1303**（无法访问 `C:\Program Files\cogito`） | 旧包把 perUser 写到 Program Files | 用当前补丁后的 MSI；或改用 NSIS |
| 错误 **2349**（程序包/CAB） | 中断安装、残留、或损坏的 MSI | 见 [troubleshooting.md](./troubleshooting.md)；日常用 NSIS |

**Windows：** 打包配置 `tmpdir: false`，直接在 `out/studio/` 构建。打包前会结束本仓库路径下的 `electron` / `cogito` 进程并清理 `out/studio`。第三方杀毒建议将 `out/studio` 加入排除列表。

NSIS 工具链（`nsis-*.7z`）由 app-builder 下载：`run-forge.ts` 在未设置时默认
`ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`
（见 [pnpm-and-native-mirrors.md](../../ops/pnpm-and-native-mirrors.md)）。直连 GitHub 超时可显式设该变量。

## 3. 全平台 Makers

| 平台    | Maker           | 默认                               | 说明                                  |
| ------- | --------------- | ---------------------------------- | ------------------------------------- |
| Windows | NSIS            | ✅                                 | Setup.exe + `latest.yml`（electron-updater） |
| Windows | ZIP             | ✅                                 | 便携包                                |
| Windows | MSIX            | `STUDIO_MAKE_MSIX=1`               | 需 Windows SDK                        |
| Windows | WiX MSI         | `STUDIO_MAKE_WIX=1` / `make:msi`   | 需 WiX Toolset **v3**（企业旁路）     |
| macOS   | DMG             | ✅                                 | 安装镜像                              |
| macOS   | ZIP             | ✅                                 | 归档 / Sparkle 兼容 feed              |
| macOS   | PKG             | ✅（`STUDIO_MAKE_PKG_OFF=1` 关闭） | 企业安装包                            |
| Linux   | Deb / Rpm / ZIP | ✅                                 | 常见发行版                            |
| Linux   | Flatpak         | `STUDIO_MAKE_FLATPAK=1`            | 需 flatpak-builder                    |

## 4. 代码签名 / 公证

| 变量                                                         | 用途                              |
| ------------------------------------------------------------ | --------------------------------- |
| `WINDOWS_CERTIFICATE_FILE` + `WINDOWS_CERTIFICATE_PASSWORD`  | Authenticode（PFX；亦传给 NSIS maker） |
| `WINDOWS_CERTIFICATE_SUBJECT`                                | 证书存储按主题名（`signtool /n`） |
| `STUDIO_OSX_SIGN=1` 或 `APPLE_IDENTITY`                      | macOS `osxSign`                   |
| `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` | Notarize                          |

## 5. 发布（Publishers）

| 变量                                                         | 用途                                          |
| ------------------------------------------------------------ | --------------------------------------------- |
| `STUDIO_PUBLISH_GITHUB=1` + `GITHUB_TOKEN`                   | GitHub Releases（默认 draft）                 |
| `STUDIO_GITHUB_OWNER` / `STUDIO_GITHUB_REPO`                 | 仓库（默认 `layenbrank/cogito`）          |
| `STUDIO_PUBLISH_S3=1` + `STUDIO_S3_BUCKET`                   | S3 发布（**自动更新 feed 走这里**）           |
| `STUDIO_S3_REGION` / `STUDIO_S3_FOLDER` / `STUDIO_S3_PUBLIC` | S3 可选                                       |
| `STUDIO_S3_UPDATE_BASE`                                      | 客户端 generic feed 前缀（拼 `{base}/win32/x64`） |

`studio-v*` tag 会把 NSIS `Setup.exe` / `latest.yml` / `.blockmap` 传到 CI artifact，并打一份 **draft GitHub Release 给人下载**。那份 Release **不是**完整的 auto-update host：`electron-updater` 要的是 HTTP 目录里并排的 `latest.yml` + 安装包（配 `STUDIO_S3_UPDATE_BASE` / `STUDIO_UPDATE_URL`）。

避开 Tauri Client 的 `v*` tag，Studio 只用 **`studio-v*`**。发版只 bump `apps/studio/package.json` 的 `version`。

## 6. 自动更新（`electron-updater`）

Windows 使用 **generic** provider：`latest.yml` + NSIS Setup.exe。Renderer API 仍为 `itc.updater.check` / `download` / `install` / `toRead`（`toRead().progress` 现可有下载百分比）。

| 变量                    | 用途                                      |
| ----------------------- | ----------------------------------------- |
| `STUDIO_UPDATE_URL`     | feed 目录 URL（含 `latest.yml`）          |
| `STUDIO_S3_UPDATE_BASE` | 未设 URL 时拼 `{base}/win32/x64`          |

`make` 时：

1. Vite 把 feed 编译进 `STUDIO_UPDATE_FEED_URL`
2. NSIS maker（若配置了 feed）写入包内 `resources/app-update.yml`，并在输出目录生成 `latest.yml`

开发态 / 未 packaged / 未配置 → `toRead().enabled === false`。未签名包默认 `verifyUpdateCodeSignature = false`，便于本地/CI 测 feed。

Windows AUMID：`com.cogito.studio`（与 `appId` 一致；已离开旧 `com.squirrel.*`）。

不要用 `electron.autoUpdater`（Squirrel）或 `update-electron-app` 系统弹窗。

## 7. asar / Sidecar / Fuses / CI / 图标

- asar 保留 `.vite` / `package.json` / `drizzle` / `node_modules`（排除 `@cogito/*`）；Vite external 仅 **better-sqlite3** 闭包由 `forge/hooks/external-deps.ts` 复制；**禁止 asar 热更**（Fuses `EnableEmbeddedAsarIntegrityValidation` + `OnlyLoadAppFromAsar`）。
- 图标：与 Client 共用品牌源 `apps/client/src-tauri/icons/`。`pnpm --filter @cogito/studio icons` 同步到 `resources/` 与 `public/`。
- 二进制**不进 Git**：`staging/`、`.cache/sidecar/`、exe/dll 均 gitignore
- 版本真相：`scripts/commands/features/sidecar/tools.lock.json`；corex sidecar **目前仅 win32-x64**
- **corex 始终随包**（lock 里**不标** `onDemand`）
- 开发：`pnpm command sidecar bootstrap studio`
- 冒烟：`pnpm --filter @cogito/studio test:pack` 启动 `out/studio/cogito-win32-x64/cogito.exe`（**不要**跑 Setup.exe）
- Fuses 见 [security.md](./security.md)；CI：[`.github/workflows/studio-desktop.yaml`](../../../.github/workflows/studio-desktop.yaml)
