# Monorepo CI/CD 指南

本文说明本仓库的 GitHub Actions 设计：质量门禁、Client 发版、文档站点部署，以及 **Secrets 从哪里来、两类签名分别做什么**。

相关文件：

| 路径                                                       | 说明                 |
| ---------------------------------------------------------- | -------------------- |
| `.github/workflows/*.yaml`                                 | 工作流定义           |
| `apps/<app>/bump.<app>.ts`                                 | 各应用独立版本 bump  |
| [pnpm-and-native-mirrors.md](./pnpm-and-native-mirrors.md) | pnpm / Electron 镜像 |

---

## 1. 先建立概念

### 1.1 Workflow 里的「变量」从哪来

YAML 里常见三种写法，含义不同：

| 写法                  | 来源               | 谁配置               | 会出现在日志里吗   |
| --------------------- | ------------------ | -------------------- | ------------------ |
| `${{ secrets.NAME }}` | 仓库 **Secrets**   | 你在 GitHub 网页配置 | 掩码，不会明文打印 |
| `${{ vars.NAME }}`    | 仓库 **Variables** | 同上（非敏感配置）   | 可能明文           |
| `env:` 下的固定值     | 写死在 YAML        | 改 workflow 文件     | 明文               |

**关键路径（GitHub）：**

`仓库 → Settings → Secrets and variables → Actions`

- **Secrets**：密码、私钥、PFX 等敏感内容
- **Variables**：非敏感开关/URL（本仓库 Client 发版目前几乎全用 Secrets）

Workflow **不会**自动读你本机环境变量。本机 `TAURI_SIGNING_PRIVATE_KEY=...` 只影响本地构建；CI 必须在仓库 Secrets 里再配一份同名（或 workflow 里写的那个名字）。

示例（`client-release.yaml`）：

```yaml
env:
  WINDOWS_CERTIFICATE: ${{ secrets.WINDOWS_CERTIFICATE }}
  WINDOWS_CERTIFICATE_PASSWORD: ${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}
```

含义：从仓库 Secrets 取出值 → 注入成该 step 的环境变量 → 脚本用 `$env:WINDOWS_CERTIFICATE` 读取。  
若 Secret **未配置**，注入结果是空字符串；脚本再决定「跳过」还是「失败」。

### 1.2 两类「签名」不要混

Client 发版涉及两套完全不同的签名：

|                              | Tauri Updater 签名                              | Windows Authenticode                                                            |
| ---------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| **干什么**                   | 给更新包生成 `.sig`，客户端校验「更新来自你们」 | 给 `.exe` / `.msi` 做系统级代码签名                                             |
| **用户感知**                 | 应用内自动更新能否通过校验                      | SmartScreen /「未知发布者」警告多少                                             |
| **Secret**                   | `TAURI_SIGNING_PRIVATE_KEY`（**必填**）         | `WINDOWS_CERTIFICATE`（**可选**）                                               |
| **没配会怎样**               | Workflow **直接失败**                           | 跳过签名，安装包仍可发布，SmartScreen 更容易报警                                |
| **是不是「任意电脑的证书」** | 否：是 `tauri signer` 生成的密钥对              | 否：需正规 **Code Signing** 证书（或云签）；自签/随便导出的本机证书用户端不信任 |

Updater 公钥写在 `tauri.conf.json` 的 updater 配置里；私钥只放 Secrets / 本机环境，**绝不进仓库**。

Authenticode 则是 CA 签发的 Windows 代码签名证书，导出为 `.pfx` 再 Base64 进 Secret。许多现代 CA 只提供硬件 Token / 云 HSM，那种情况不能简单塞 PFX，需要改签名流程（本文按当前 workflow 的「PFX Base64」方式说明）。

### 1.3 发版产物与渠道（Client）

一次成功的 Client Release 大致产出：

- 版本化 GitHub Release（如 `v1.2.0-alpha.4`）：安装包、`.sig`、`latest.json`、`SHA256SUMS.txt`
- 浮动渠道 Release（如 `updater-alpha`）：只挂该渠道最新的 `latest.json`，供应用内 updater 拉取

渠道由 **tag 的 SemVer 后缀** 决定：`stable` / `alpha` / `beta` / `rc`。

---

## 2. 仓库 Secrets 清单

在 **Settings → Secrets and variables → Actions → Secrets** 配置。

### 2.1 Client Release（必填）

| Secret 名                            | 用途                                                   | 未配置时                                                      |
| ------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | Tauri updater 私钥（生成 `.sig` / `latest.json` 签名） | **失败**（有专门校验 step）                                   |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码                                               | 无密码时也要创建该 Secret，值为**空字符串**（不能「不存在」） |

生成密钥（本地一次即可）：

```bash
npm run tauri signer generate -w ~/.tauri/cogito.key
# 公钥写入 tauri.conf.json；私钥内容放入 TAURI_SIGNING_PRIVATE_KEY
```

### 2.2 Client Release（可选 · Authenticode）

| Secret 名                      | 用途                                                   | 未配置时                    |
| ------------------------------ | ------------------------------------------------------ | --------------------------- |
| `WINDOWS_CERTIFICATE`          | 代码签名 **PFX 文件的 Base64**（整文件编码，不是路径） | 跳过 Authenticode，继续发版 |
| `WINDOWS_CERTIFICATE_PASSWORD` | PFX 密码                                               | 无密码可留空或不配          |

Workflow 行为摘要：

1. 读 `secrets.WINDOWS_CERTIFICATE`
2. 空 → 打印跳过日志，`codesign.enabled=false`
3. 非空 → Base64 解码为 `.pfx` → 导入 runner 证书库 → 写入 `tauri.conf.json` 的 `certificateThumbprint` → `tauri build` 签名

将已有 PFX 转为 Base64（示例）：

```powershell
# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\codesign.pfx")) | Set-Clipboard
```

```bash
# macOS / Linux
base64 -i ./codesign.pfx | pbcopy   # 或重定向到文件再粘贴进 Secret
```

**不要**把开发机上任意「个人证书」塞进去指望消除 SmartScreen；需要的是面向发布的 Code Signing 证书。

### 2.3 其他工作流

| Secret / Token | 工作流           | 说明                                |
| -------------- | ---------------- | ----------------------------------- |
| `GITHUB_TOKEN` | 各发布工作流     | Actions 自动提供                    |
| `QODANA_TOKEN` | qodana（若启用） | JetBrains Qodana                    |
| `NPM_TOKEN`    | （按需自行接入） | 私有 npm 源；当前默认 workflow 未接 |

---

## 3. 工作流一览

| 工作流文件                    | 名称                   | 触发                                      | 作用                                                 |
| ----------------------------- | ---------------------- | ----------------------------------------- | ---------------------------------------------------- |
| `continuous-integration.yaml` | Continuous Integration | PR → `master`/`develop`；push → `develop` | lint / 类型检查 / 测试 / 构建（Client 仅 Vite）      |
| `client-release.yaml`         | Client Release         | tag `v*`；或手动 `workflow_dispatch`      | Tauri Windows 安装包 + GitHub Release + updater 清单 |
| `studio-desktop.yaml`         | Studio Desktop         | 手动；或 push 变更 `apps/studio/**`       | Electron 多平台安装包 artifact                       |

`v*` tag 会触发 Client Release。

运行时约定：Node 24 + pnpm（根 `package.json` 的 `packageManager`）。Actions 使用支持 Node 24 的版本（如 `checkout@v6`、`setup-node@v6`）。不要依赖 `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION`。

---

## 4. 各工作流说明

### 4.1 Continuous Integration

文件：`.github/workflows/continuous-integration.yaml`

主要步骤：

1. `pnpm install --frozen-lockfile`
2. `pnpm lint`
3. 类型检查（extension / client）
4. 单元测试（`pnpm turbo run unit`，失败不阻断）
5. `pnpm turbo run build --filter=!@cogito/client`
6. `pnpm --filter @cogito/client run build:core`（仅 Web，避免 Ubuntu 上跑 Tauri）
7. 上传 `dist` 等为 artifact

**注意：** PR CI **不构建** Tauri 桌面包；桌面安装包只在 `client-release`（`windows-latest`）产出。

### 4.2 Client Release

文件：`.github/workflows/client-release.yaml`  
Runner：`windows-latest`

#### 能力摘要

- **版本门禁**：tag 去掉 `v` 后必须等于 `tauri.conf.json`、`Cargo.toml`、`apps/client/package.json` 的 version
- **渠道**：由 SemVer 后缀映射到 `stable` | `alpha` | `beta` | `rc`
- **Updater 端点**：构建前写入对应 `updater-{channel}` 的 `latest.json` URL
- **Sidecar 验锁**：校验仓库内 `binaries/SHA256SUMS`（CI **只验不生成**）
- **`workflow_dispatch`**：按输入的 tag checkout，不构建默认分支 HEAD
- 浮动渠道 `updater-{channel}`：每次发版覆盖同 Release 上的 `latest.json`（仓库需关闭 **Immutable releases**，否则无法覆盖资产）

#### 渠道对照

| Tag 示例         | 渠道   | GitHub Release          | 客户端检查的清单                          |
| ---------------- | ------ | ----------------------- | ----------------------------------------- |
| `v1.2.0`         | stable | 正式版（`make_latest`） | `.../download/updater-stable/latest.json` |
| `v1.2.0-alpha.1` | alpha  | prerelease              | `.../download/updater-alpha/latest.json`  |
| `v1.2.0-beta.1`  | beta   | prerelease              | `.../download/updater-beta/latest.json`   |
| `v1.2.0-rc.1`    | rc     | prerelease              | `.../download/updater-rc/latest.json`     |

仓库内 `tauri.conf.json` 默认多为 `updater-stable`；CI 会按本次渠道改写。

#### 手动触发（推荐在 tag 受保护、不能重打时使用）

1. Actions → **Client Release** → **Run workflow**
2. Branch 选含最新 workflow 的分支（通常 `master`）
3. `tag` 填已有 tag，例如 `v1.2.0-alpha.4`
4. 可选：`draft`（先审再公开）、`skip_channel_update`（不更新浮动清单）

这样用的是 **所选分支上的 YAML**，构建的是 **tag 指向的代码**。

### 4.4 Studio Desktop

文件：`.github/workflows/studio-desktop.yaml`

- Matrix：Windows / macOS / Ubuntu
- 产出 Electron 安装包 artifact（非 GitHub Release 发版流）

### 5. 版本 bump 与发版操作

各应用版本独立，配置在 `apps/<project>/bump.<project>.ts`：

| 命令                  | 配置                                                       |
| --------------------- | ---------------------------------------------------------- |
| `pnpm bump:client`    | `apps/client/bump.client.ts`（含 tauri.conf / Cargo.toml） |
| `pnpm bump:studio`    | `apps/studio/bump.studio.ts`                               |
| `pnpm bump:extension` | `apps/extension/bump.extension.ts`                         |
| `pnpm bump:devtools`  | `apps/devtools/bump.devtools.ts`                           |

### 5.1 发布 Client（正式版）

```bash
pnpm bump:client 1.2.0
git add apps/client/package.json apps/client/src-tauri/tauri.conf.json apps/client/src-tauri/Cargo.toml
git commit -m "chore(release): 1.2.0"
git tag v1.2.0
git push <remote> HEAD
git push <remote> v1.2.0
```

将 `<remote>` 换成你的远程名（本仓库常见为 `github`，不一定是 `origin`）。

### 5.2 发布 Client（预发版）

```bash
pnpm bump:client 1.2.0-beta.1
# 同样 commit，然后：
git tag v1.2.0-beta.1
git push <remote> HEAD
git push <remote> v1.2.0-beta.1
```

### 5.3 草稿发版

Actions → Client Release → Run workflow → 填 tag → 勾选 `draft`。  
资产先挂在 draft Release；确认后再在 GitHub 上 Publish（或依赖后续自动化）。

### 5.4 更换 sidecar

在 `apps/client` 执行 `pnpm prepare:bin`（需 `CARGO_TARGET_DIR`），脚本会重写 `src-tauri/binaries/SHA256SUMS`。  
将二进制与清单一并 commit。CI 只校验、不生成。

### 5.5 本地构建 Client（Windows）

```bash
pnpm build:client
# 或
pnpm --filter @cogito/client build
```

`scripts/build.ts` 会注入空的 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；私钥仍从本机环境变量读取。

---

## 6. Docker（补充）

### 通用前端镜像（Nginx）

```bash
docker build -t web-ext -f docker/Dockerfile --build-arg APP_DIR=apps/extension .
docker run -p 8080:80 web-ext
```

---

## 7. 常见问题

### Secrets / 签名

- **Updater 签名失败**：检查是否配置了 `TAURI_SIGNING_PRIVATE_KEY`；无密码时 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 是否存在且为空。
- **Release 里 Authenticode 显示 false**：正常，表示未配或跳过了 `WINDOWS_CERTIFICATE`。
- **以为配了本机证书就会在 CI 生效**：不会。必须写入仓库 Secrets，且名字与 `${{ secrets.XXX }}` 一致。

### Tag / Release

- **仓库已关闭 Immutable releases**：版本 Release 与浮动 `updater-*` 可正常创建/覆盖资产。若重新开启 Immutable，浮动清单覆盖会失败，需改架构（见上文渠道说明）或改回「删建 Release」权宜方案。
- **重跑同一 tag**：可先删掉该 tag 对应的 GitHub Release（保留 git tag），再 `workflow_dispatch` 重跑。
- **远程名不是 origin**：用 `git remote -v` 确认（例如 `github`）。

### 构建

- **pnpm / Electron postinstall 卡住**：见 [pnpm-and-native-mirrors.md](./pnpm-and-native-mirrors.md)。
- **pnpm workspace 构建失败**：确认 `pnpm-lock.yaml` 与 `turbo.json` 同步。
- **Sidecar 缺失**：确认 `apps/client/src-tauri/binaries/` 中已跟踪真实 `corex-serve`（非占位）及匹配的 `SHA256SUMS`。

---

## 8. 后续可选增强

- extension / devtools 独立发布工作流
- `changesets` 自动版本管理
- `turbo` 远程缓存 / CI 中持久化 `.turbo`
- Playwright E2E
- macOS / Linux Client 安装包（能力视 IPC 而定）
- Authenticode 云签 / HSM（当 CA 不再提供可导出 PFX 时）
