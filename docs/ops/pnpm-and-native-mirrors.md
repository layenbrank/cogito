# pnpm 11 与原生二进制镜像

> 对齐 [pnpm 11.0](https://pnpm.io/zh/blog/releases/11.0)～[11.10](https://pnpm.io/zh/blog/releases/11.10)  
> 排查记录环境：Windows、Node 24、pnpm 11.x、electron（`apps/studio`）

本文说明 monorepo 在 pnpm 11 下的配置职责，以及 Electron postinstall 依赖 `ELECTRON_MIRROR` 的原因与用法。

## 配置职责

| 位置 | 用途 |
|------|------|
| `.npmrc` | **仅** `registry` / 认证（token 勿提交仓库） |
| `pnpm-workspace.yaml` | linker、提升、`allowBuilds`、`registries`、catalog、overrides、Node 镜像等 |
| 环境变量 | Electron / native 二进制镜像（如 `ELECTRON_MIRROR`）；CI 认证可用 `pnpm_config__auth`（11.10+） |

## pnpm 11 已完成的迁移

1. 将原 `.npmrc` 中的 `node-linker`、`shamefully-hoist`、`hoist-pattern`、`public-hoist-pattern`、`strict-peer-dependencies`、`auto-install-peers` 迁入 `pnpm-workspace.yaml`（camelCase）。
2. 删除无效的 `onlyBuiltDependencies` / `.npmrc` 的 `only-built-dependencies[]`，统一使用 `allowBuilds`（并补上 `@prisma/client`）。
3. 增加 `registries.default`（npmmirror）与 `nodeDownloadMirrors.release`。
4. 设置 `confirmModulesPurge: false`，避免布局变更时非交互安装卡住。
5. 精简 `.npmrc`：去掉对 pnpm 11 无效的 electron / sass / chromedriver 等「伪 npm 配置」行；改为注释说明环境变量。
6. 删除根 `package.json` 中 Yarn 风格的 `workspaces.nohoist`（pnpm 不读取；工作区以 `pnpm-workspace.yaml` 为准）。

## 刻意未改动的默认

| 设置 | 说明 |
|------|------|
| `minimumReleaseAge`（默认 1440） | 保留供应链保护；若需立刻装刚发的包再按需调 `0` 或 `minimumReleaseAgeExclude` |
| `blockExoticSubdeps`（默认 true） | 根目录 `overrides` 里的 `xlsx` tarball 仍可用；勿随意关闭 |
| `verifyDepsBeforeRun`（默认 install） | 运行脚本前核对依赖，利于 monorepo |

## 开发者 / CI 必设环境变量

```powershell
# Electron（否则 postinstall 可能卡在 GitHub）
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

# 可选：electron-builder 二进制
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
```

---

## Electron postinstall 卡住

### 现象

执行 `pnpm build:client`（或任意触发全量 `pnpm install` 的命令）时，安装过程长时间卡在：

```
.../node_modules/electron postinstall$ node install.js
```

- 可持续 **30 分钟以上**无输出
- 手动 `Ctrl+C` 后退出码为 `3221225786`

`build:client` 本身使用 **Tauri**，并不直接依赖 Electron；卡住是因为 monorepo 全量安装时仍会构建 `apps/studio` 所需的 `electron` 包。

### 根因

1. `electron` 的 `postinstall` 通过 `@electron/get` 下载平台 zip（Windows 约 138 MB）。
2. 未设镜像时默认走 GitHub，国内网络下易表现为「卡住」。
3. 按 pnpm 11：项目 `.npmrc` **仅**用于注册源/认证；生命周期脚本**不再**注入 `npm_config_*`。因此 `.npmrc` 里的 `electron_mirror` **不生效**。
4. `@electron/get` 读取顺序：`npm_config_electron_mirror` → `ELECTRON_MIRROR` → `package.json` config。必须设置环境变量 **`ELECTRON_MIRROR`**。

### 依赖关系

| 包 / 应用 | 是否依赖 electron |
|-----------|-------------------|
| `apps/client`（Tauri） | 否 |
| `apps/studio`（Electron Forge） | 是 |
| 根 `package.json` devDependencies | 是（`"electron": "catalog:"`） |

### 推荐方案：环境变量 `ELECTRON_MIRROR`

```powershell
# 用户级（永久，新开终端后生效）
[System.Environment]::SetEnvironmentVariable(
  "ELECTRON_MIRROR",
  "https://npmmirror.com/mirrors/electron/",
  "User"
)
```

若在设置用户环境变量之前已打开终端，当前会话可能仍读不到；请新开终端，或：

```powershell
$env:ELECTRON_MIRROR = [Environment]::GetEnvironmentVariable('ELECTRON_MIRROR','User')
```

**已放弃** pnpm patch（`patches/electron@*.patch` 已移除）。本机与 CI 均需配置 `ELECTRON_MIRROR`（当前 GitHub Actions 工作流若未显式设置，请在 runner / secrets 侧补上）。

### 其他可选方案

| 方案 | 说明 |
|------|------|
| filter 安装 | `pnpm install --filter @cogito/client...` 可避开 electron |
| `ELECTRON_SKIP_BINARY_DOWNLOAD=1` | 跳过下载；studio 无法运行 |
| packageExtensions | 向 electron 注入 config；需实测 |
| 包装脚本 | `cross-env ELECTRON_MIRROR=... pnpm install`；直接 `pnpm install` 仍可能卡住 |

**不要**指望降级 pnpm 或恢复 patch 作为默认团队方案。

### 验证

```powershell
# 观察下载地址应为 npmmirror，而非 github.com/electron/...
$env:DEBUG = "@electron/get:index"
pnpm rebuild electron
```

- **有问题：** postinstall 30 分钟无响应
- **修复后：** 通常数秒到数十秒（视缓存而定）

## 参考

- [pnpm 11.0 发布说明](https://pnpm.io/zh/blog/releases/11.0)
- [pnpm 11.10（CI `_auth`）](https://pnpm.io/zh/blog/releases/11.10)
- [pnpm 设置文档](https://pnpm.io/zh/settings)
- [npmmirror Electron 镜像](https://npmmirror.com/mirrors/electron/)
- [@electron/get artifact-utils](https://github.com/electron/get/blob/main/src/artifact-utils.ts)
