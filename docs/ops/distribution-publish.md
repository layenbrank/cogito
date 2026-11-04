# Client 分发：密钥、上传与踩坑总结

面向本机把 Tauri 安装包推到 R2（经 `cogito-distribution` Worker）。实现细节仍见
[`apps/distribution/README.md`](../../apps/distribution/README.md)；本文汇总 **密钥怎么来**、
**标准发版步骤**，以及一次完整发版里实际踩到的问题。

公开基址：`https://cogito-distribution.layenbrank.workers.dev`

---

## 1. 问题总结（本次踩坑）

| 现象 | 根因 | 处理 |
| ---- | ---- | ---- |
| `mpu-create: fetch failed` / `ConnectTimeout` | Node/`curl` **不走** Windows IE 系统代理；直连 `*.workers.dev` 超时。PowerShell/.NET 会走代理（如 Clash `127.0.0.1:7890`），所以「浏览器/PS 能开、上传脚本挂」 | 上传脚本启动时自动读 HKCU 系统代理（[`install-http-proxy.ts`](../../apps/distribution/scripts/install-http-proxy.ts)）；或手动设 `HTTPS_PROXY` / `HTTP_PROXY`，并保证本地代理已开 |
| `wrangler secret put` **不打印密钥** | 设计如此：你输入的值上传后**永不回显、读不回来** | 生成后立刻写入本机 `.dev.vars` 或 `%TEMP%\cogito-auth-key.txt`；忘了就重新生成并 `secret put` 覆盖 |
| `secret put` 提示「没有叫 cogito-distribution 的 Worker」并新建空壳 | 线上当时没有已部署的同名 Worker，wrangler 先建空 Worker 再塞 secret | 随后必须 `pnpm command distribution deploy`，把 `worker.ts` + R2 绑定推上去 |
| 单独 `upload --release` 却把 MSI 键写成 `*-setup.exe` | 旧逻辑在有 `--release` 时默认对象名写死 setup.exe | 已改为默认跟**源文件 basename**；MSI 可直接 upload |
| 缺 `*.nsis.zip` 时直接抛错，看不到已有 MSI | `findClientBundleArtifacts` 硬性要求 zip | 增加 inventory + `--dry-run` 先列 zip/exe/msi；缺 zip 时错误里带上已扫到的 MSI |
| Tauri `createUpdaterArtifacts: true` 只出 `-setup.exe.sig`、不出 `.nsis.zip` | Tauri CLI 2.12+ 改为**按 bundle 类型直接签安装器**，不再二次打包 zip；`tauri-plugin-updater` 2.x 能直接装裸 exe（`infer::app::is_exe` → 落盘 `.exe` → `/UPDATE`） | `publish:client` 已同时支持两种载荷并按 mtime 取较新的一份，**不要再手工补 zip** |

**已验证可用的 1.5.0 stable 直链（示例）：**

- `…/1.5.0/cogito_1.5.0_x64_zh-CN.msi`
- `…/1.5.0/cogito_1.5.0_x64_en-US.msi`
- `…/1.5.0/cogito_1.5.0_x64-setup.exe`
- `…/1.5.0/cogito_1.5.0_x64-setup.exe` + `.exe.sig`（CLI 2.12+ 的 updater 载荷；老格式 `.nsis.zip` 仍兼容）
- `…/updater-stable/latest.json`

---

## 2. 密钥分别是什么

不要混三套东西：

| 名称 | 用途 | 怎么拿 | 本机怎么放 |
| ---- | ---- | ------ | ---------- |
| **`AUTH_KEY_SECRET`** | Worker **写**鉴权（头 `X-Custom-Auth-Key`）。`upload` / `publish:client` 用这个 | **自己生成**随机串，再 `wrangler secret put` 到线上 | 环境变量，或 `--auth-key-file`（纯文本 / `.dev.vars`），或 `%TEMP%\cogito-auth-key.txt` |
| **R2 S3 API**（`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` + Account） | 仅 `upload:rclone` 直连桶 | Cloudflare Dashboard → R2 → Manage API Tokens | 环境变量；**publish:client 不需要** |
| **`TAURI_SIGNING_PRIVATE_KEY`** | 给 updater 产物签 `.sig`（构建期） | `tauri signer generate` 的私钥 | 本机构建环境 / CI Secrets；与 Worker 写密钥无关 |

### 2.1 生成并配置 `AUTH_KEY_SECRET`（Windows）

```powershell
# 1) 生成（PowerShell，无需 openssl）
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$key = [Convert]::ToBase64String($bytes)
$key   # 复制保存，secret put 不会再显示

# 2) 写入线上 Worker（需 wrangler 已登录 / CLOUDFLARE_API_TOKEN）
pnpm command distribution secret
# 粘贴 $key 回车

# 3) 本机立刻留副本（任选）
$env:AUTH_KEY_SECRET = $key
Set-Content -Path "$env:TEMP\cogito-auth-key.txt" -Value $key -NoNewline
# 或 apps/distribution/.dev.vars（已 gitignore）：
# AUTH_KEY_SECRET=...

# 4) 若 secret put 时新建了空 Worker，立刻部署真代码
pnpm command distribution deploy
```

忘记本机副本时：**重新生成 → 再 `secret put` 覆盖 → 更新本机文件**。旧密钥立即失效。

---

## 3. 标准发版步骤（本机）

前置：

1. 已 `pnpm build:client`（或等价 Tauri release），产物在
   `$env:CARGO_TARGET_DIR\release\bundle`（如 `D:\Documents\cache\release\bundle`）或
   `apps/client/src-tauri/target/release/bundle`
2. 需要 updater 载荷：`*-setup.exe` + `*.exe.sig`（Tauri CLI 2.12+）或 `*.nsis.zip` + `*.zip.sig`（老格式），与 productName/version/arch 对齐；两种都在时取 mtime 更新的一份，避免把上一版安装包推成“新版”
3. 本机有 `AUTH_KEY_SECRET`；代理软件开着（国内访问 workers.dev）

```powershell
# 查产物（不鉴权、不上传）
pnpm command distribution publish:client --dry-run

# 一键：zip + exe + 多语言 msi + updater-{channel}/latest.json
pnpm command distribution publish:client `
  --channel stable `
  --auth-key-file .\apps\distribution\.dev.vars

# 或只传某一个 MSI
pnpm command distribution upload `
  --source D:\Documents\cache\release\bundle\msi\cogito_1.5.0_x64_zh-CN.msi `
  --release 1.5.0 `
  --auth-key-file .\apps\distribution\.dev.vars
```

对象键规则：`<semver>/<文件名>`；`upload` 默认文件名 = 源文件 basename（空格变 `.`）。

渠道：`stable` | `alpha` | `beta` | `rc` → 清单键 `updater-{channel}/latest.json`。

---

## 4. 发版后校验

```powershell
# 元数据（公开）
Invoke-RestMethod 'https://cogito-distribution.layenbrank.workers.dev/1.5.0/cogito_1.5.0_x64_zh-CN.msi?meta=1'
Invoke-RestMethod 'https://cogito-distribution.layenbrank.workers.dev/updater-stable/latest.json'

# HEAD 看体积
Invoke-WebRequest -Method HEAD -UseBasicParsing `
  'https://cogito-distribution.layenbrank.workers.dev/1.5.0/cogito_1.5.0_x64_zh-CN.msi'
```

期望：`meta` 有 `size` / `etag`；`latest.json` 的 `version` 与
`platforms.windows-x86_64.url` 指向本次 updater 载荷（`-setup.exe` 或老格式 `.nsis.zip`）。

---

## 5. 故障速查

| 症状 | 先查 |
| ---- | ---- |
| `没找到 AUTH_KEY_SECRET` | `.dev.vars` / 环境变量 / `%TEMP%\cogito-auth-key.txt` / `--auth-key-file` |
| `fetch failed` / ConnectTimeout | 代理是否开着；日志是否有 `[distribution] 使用系统代理 …`；可手动设 `HTTPS_PROXY` |
| `HTTP 403 Forbidden` | 本机密钥与线上 `AUTH_KEY_SECRET` 不一致 → 重新 `secret put` 并同步本机 |
| `updater 产物不齐` | `--dry-run` 看 `updater:` 行选中的是哪种载荷；缺 `.sig` 就补签名（重跑 `tauri build`，或手工 `tauri signer sign`） |
| 读得到 404 | 是否传错版本目录 / 文件名；白名单见 `setup-key.ts`（exe / msi / nsis.zip / updater-*/latest.json） |

更多命令与 API 表：[`apps/distribution/README.md`](../../apps/distribution/README.md)。  
CI 与两类签名（Updater vs Authenticode）：[`ci-cd.md`](./ci-cd.md)。
