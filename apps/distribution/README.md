# distribution：cogito 资源分发端点

Cloudflare Worker（TypeScript）：**发布流水线**把版本化产物推到 R2 桶 `cogito`，**用户与开发环境**
按版本路径取稳定直链。今天分发的是 Store 安装包；目标是同一入口也供给 `ffmpeg` / `corex` / `pandoc` /
`goose` / `pdfium` 这些工具的版本化产物（见下文「现状与目标态」）。

| 项       | 值                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| 位置     | `apps/distribution`（workspace 包 `@cogito/distribution`；与 `apps/service`、`apps/compute` 同为可部署服务） |
| 线上地址 | `https://cogito-distribution.layenbrank.workers.dev`                                                          |
| 入口     | [`src/worker.ts`](./src/worker.ts)                                                                                |
| 绑定     | `DOWNLOADS` → 桶 `cogito`                                                                                     |
| 密钥     | `AUTH_KEY_SECRET`（写操作：PUT / DELETE / multipart）                                                             |
| 工具链   | `wrangler` / `@cloudflare/workers-types` 在**本包** devDependencies（不借仓库根）                                 |

> **改名迁移**：Cloudflare 侧的旧身份 `cogito-downloads` 仍在服务 Partner Center 已登记的包 URL。
> 让新身份生效的顺序：`pnpm command distribution deploy` → 更新 Partner Center 的包 URL（见
> [`store-package-handoff.md`](../../docs/ops/store/store-package-handoff.md)）→ 删除旧 Worker。

## 命令

本包自己的脚本（Cloudflare 侧的常规写法）：

```powershell
pnpm --filter @cogito/distribution run deploy
pnpm --filter @cogito/distribution run dev
pnpm --filter @cogito/distribution run secret
pnpm --filter @cogito/distribution run type-check
pnpm --filter @cogito/distribution run upload -- --source … --release 1.3.0
```

仓库里的统一入口（根 CLI；等价且更短，`pnpm distribution deploy` 也可）：

```powershell
pnpm command distribution deploy
pnpm command distribution dev
pnpm command distribution secret
pnpm command distribution check          # 类型检查（= 本包的 type-check，CI 也跑这步）
pnpm command distribution upload         # 上传安装包（→ 本 worker 的 multipart 端点）
pnpm command distribution upload:rclone  # 上传（→ rclone 直连 R2，走 S3 API）
```

上传脚本是 Node + TypeScript（[`scripts/upload-via-worker.ts`](./scripts/upload-via-worker.ts) /
[`scripts/upload-via-rclone.ts`](./scripts/upload-via-rclone.ts)），跨平台，没有 `.ps1` 了。

## 上传

两条路，对象键都按 `<版本>/<文件名>` 落桶：

|                 | 走哪                                                                                               | 适合                                               |
| --------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `upload`        | 本 worker 的 multipart 端点（默认 8 MiB/片，失败重试 + 自动 `mpu-abort`）                          | 安装包；只要 `AUTH_KEY_SECRET`，不需要 R2 密钥     |
| `upload:rclone` | rclone `copyto` 直连 R2 的 S3 API（`R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`） | 大文件、批量（工具产物）、以及以后读侧放行的其它键 |

```powershell
# 版本 -> 键 1.3.0/cogito_1.3.0_x64-setup.exe
pnpm command distribution upload --source .\dist\cogito_1.3.0_x64-setup.exe --release 1.3.0

# 对着本地 dev server 跑（只写本机 .wrangler/）
pnpm command distribution upload --source … --release 1.3.0 --worker http://127.0.0.1:8787

# 直接指定键 / 换桶（rclone）
pnpm command distribution upload:rclone --source .\pkg.zip --release 1.3.0 --bucket cogito
```

密钥走 `AUTH_KEY_SECRET` 环境变量，或 `--auth-key-file`（只放密钥的文件，也可以直接指 wrangler 的
`.dev.vars`）。路径类参数（`--source` / `--auth-key-file` / `--rclone`）经根 CLI 转发时会补成绝对路径，
按你当前所在的目录解析；`pnpm --filter @cogito/distribution run upload` 直调时则相对 `apps/distribution`。

两个脚本上传前都会用 [`src/setup-key.ts`](./src/setup-key.ts) 校验对象键：**读侧下不了的键直接拒收**
（今天只有 `*-setup.exe`，工具产物放行时改这一处，worker 与两个脚本一起生效）。`--help` 有全部参数。
注意根 CLI 有 `--version` 版本旗标会截走这个参数，所以版本参数的主名是 `--release`（直接调用脚本时 `--version` 也可）。

## 现状与目标态

|            | 现状                                                                                                        | 目标态                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 读侧放行   | 只有 `/^\d+\.\d+\.\d+\/[\w.-]+-setup\.exe$/`（[`SETUP_KEY`](./src/worker.ts)）                              | 也要放行工具的版本化产物（`ffmpeg` / `corex` / `pandoc` …）                                                                                                                          |
| 工具从哪下 | 6 个 R2 公共开发域名直连（`pub-*.r2.dev`，一工具一 bucket，见 `tools.lock.json` / `sidecar/manifest.json`） | 收敛到本端点 —— 官方把 `r2.dev` 明确标为 **non-production**（要 WAF / 缓存 / 访问控制必须挂自定义域），见 [公开桶文档](https://developers.cloudflare.com/r2/buckets/public-buckets/) |
| 写侧       | 已可收任意版本路径（`parseObjectKey` 不限）                                                                 | —                                                                                                                                                                                    |

## 端点动作

| 动作                                                                                                                   | 鉴权                          | 说明                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GET` / `HEAD` / `GET ?meta=1`                                                                                         | 公开（按 `SETUP_KEY` 白名单） | 下载 / 元数据（HEAD 给 Store 校验体积用）；带条件头时 `If-None-Match` / `If-Modified-Since` 命中回 **304**，`If-Match` 不匹配回 **412** |
| `PUT` / `DELETE`                                                                                                       | `X-Custom-Auth-Key`           | 单次写 / 删；`PUT` 带 `If-Match` / `If-None-Match` 时按条件写，未满足回 **412**                                                         |
| `POST ?action=mpu-create`<br>`PUT ?action=mpu-uploadpart`<br>`POST ?action=mpu-complete`<br>`DELETE ?action=mpu-abort` | 同上                          | 分片上传（≥ 5 MiB/片，末片除外）；`abort` 清掉失败的残缺分片，[`upload-via-worker.ts`](./scripts/upload-via-worker.ts) 失败时会自动调它 |

带 `Range` 的读回 `206` + `Content-Range`；带 `If-Range` 时自己判（R2 不认这个头），不成立回整份 `200`。

## 本地开发

`pnpm command distribution dev`（= `wrangler dev`）默认跑在**本地模拟 R2**上（空桶，写进去的东西只在本机
`.wrangler/` 里，不进线上）。要对着真实桶跑，给 [`wrangler.jsonc`](./wrangler.jsonc) 的 R2 binding 加
`"remote": true`（见 [remote bindings](https://developers.cloudflare.com/workers/local-development/#remote-bindings)），
并准备 Cloudflare 凭据 + 本地 `.dev.vars`（`AUTH_KEY_SECRET=…`，已 gitignore）。

## 与官方参考实现的关系

读 / 写 / 分片三条主路径与官方 [R2 Workers API 用法](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/)
的参考实现一致；下面几处是示例没覆盖、或我们比示例更严的地方，改的时候别退回去：

1. **`PUT` 条件写失败回 412**：`put({ onlyIf })` 条件未满足时 R2 只回 `null`（示例直接当成成功）。
2. **带 `Range` 的读回 206 + `Content-Range`**：示例固定回 200，客户端会把「局部字节」当成完整 body。
3. **条件读区分 304 与 412**（RFC 7232）：R2 的条件读失败只回一个 **不带 body** 的 `R2Object`，
   示例没有这个分支；`If-None-Match` / `If-Modified-Since` 命中是「没变」→ 304，`If-Match` 不匹配才是 412。
   `HEAD` 走的 `head()` 不吃条件参数，这一层自己比 etag。
4. **`If-Range` 自己判**：[API 参考](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)里唯一
   没被 R2 支持的条件头，直接交给 R2 会把「对象已变 + `Range`」错答成 206 局部字节（RFC 7233 要求回整份）。
5. **分片的客户端错误回 400**：`uploadPart` / `complete` / `abort` 失败（uploadId 不存在、已 abort）回 400 + 原因，而不是冒成 500。
   官方 TS 示例的 `mpu-abort` 还漏了 `await`（不 await 就吞掉失败）。

## 本地检查

```powershell
pnpm command distribution check                    # 两个 TS program 的类型检查（CI 也跑这步）
pnpm --filter @cogito/distribution run lint    # eslint + oxlint（规则与 app 侧一致：禁箭头函数、eqeqeq …）
pnpm --filter @cogito/distribution run test:unit
```

单测覆盖两块纯逻辑：`src/conditional.ts`（条件 304/412、`If-Range`、206 的字节窗口）与
`scripts/upload-args.ts`（两个上传脚本共用的参数解析与对象键校验）。`worker.ts` 只留路由表与 R2 交互。

## 类型

[`tsconfig.json`](./tsconfig.json) 是 solution-style 入口（`files: []` + `references`，仿
[`apps/client`](../client/tsconfig.json)），只做聚合、不直接吃文件，编辑器靠它把 worker / 脚本
两个 program 都识别出来。两个 program 各管各的全局类型：

- [`tsconfig.worker.json`](./tsconfig.worker.json)：worker 吃 Cloudflare 全局类型（`R2Bucket` /
  `R2UploadedPart` 等），收 `env.d.ts` + `src/**/*.ts`；`worker-configuration.d.ts` 是 wrangler 生成的，不要提交。
- [`tsconfig.scripts.json`](./tsconfig.scripts.json)：上传脚本是 Node program（`@types/node`），
  收 `scripts/**` + `eslint.config.ts` + `src/setup-key.ts`。

eslint 同时挂这两个 program（[`eslint.config.ts`](./eslint.config.ts) 的 `parserOptions.project`），
所以两边都会被类型化 lint。

## 上架

包 URL、Partner Center 字段与自检清单见
[`docs/ops/store/store-package-handoff.md`](../../docs/ops/store/store-package-handoff.md)。
