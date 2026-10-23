# Studio 渲染进程 Electron 下报错、网页模式正常 — 根因说明

## 现象

- **网页模式**（如 `pnpm --filter @cogito/studio dev:core` 或 client 的 vite）：正常。
- **Electron 模式**（`pnpm dev:studio` → electron-forge start）：报错
  `The requested module '.../highlight.js/lib/core.js' does not provide an export named 'default'`
  以及 lowlight、highlight.js 语言路径等解析问题。

## 根因（与「依赖在项目根」有关）

1. **依赖在 monorepo 根目录**
   - studio 未直接依赖 `react-syntax-highlighter`、`lowlight`、`highlight.js`，它们通过 @cogito/utils 等装在**仓库根** `node_modules`（pnpm 提升/符号链接）。
   - Electron Forge 启动的 **Vite 渲染器** 在解析这些包时，会解析到 **根目录** 下的 `node_modules/...`。

2. **Vite 对「根目录里的文件」的处理方式**
   - 对解析到的路径，Vite 会以 **`/@fs/` + 绝对路径** 直接提供**磁盘上的原始文件**。
   - 若该模块**没有进入 dependency optimization（预构建）**，就不会被转成 ESM，也不会做 CJS 的 default 互操作。

3. **highlight.js/lib/core.js 是 CJS**
   - `highlight.js/lib/core.js` 使用 `module.exports`（CommonJS）。
   - 在浏览器 ESM 里直接加载该文件时，没有 `export default` → 报错 "does not provide an export named 'default'"。

4. **为什么网页模式没问题**
   - **client** 可能根本没走到 Ant Design X / react-syntax-highlighter / lowlight 这条链路，或入口不同，不会去加载 `highlight.js/lib/core`。
   - **studio 纯网页**（`vite` 从 apps/studio 启动）时，**cwd/root** 或**预构建扫描范围**可能和 Electron 不同，`highlight.js` 被纳入预构建，走的是预构建后的 ESM（带 default），而不是 `/@fs/` 下的 CJS 文件。
   - **Electron Forge** 启动 Vite 时，可能 cwd/root 不同，或依赖发现逻辑不同，导致 `highlight.js`（或其子路径）**未**被预构建，最终以 `/@fs/` 直接提供根目录下的 CJS → 报错。

结论：**根因是「monorepo 依赖在项目根 + Vite 对该路径以 /@fs/ 提供原始 CJS 且未走预构建」，而不是单纯“Electron 无法加载根目录依赖”；Electron 能加载，但加载到的是未做 CJS→ESM 的原始文件。**

## 可选方案（从根因出发，不依赖在 alias 里打补丁）

1. **让 studio 的 Vite 明确以 studio 为 root，并让依赖优化包含 highlight.js**
   - 在 `vite.renderer.config.mts` 中设置 `root: path.join(__dirname)`（或 `path.dirname(fileURLToPath(import.meta.url))`），确保 Vite 的 root 是 apps/studio。
   - 视情况设置 `optimizeDeps.include: ['highlight.js']`，让该包参与预构建，由 esbuild 做 CJS→ESM，避免直接提供 lib/core.js。
   - 若仍解析到根目录，可再配合 `server.fs.allow` 允许访问上级目录，便于预构建从正确位置扫描。

2. **让 studio 直接声明相关依赖**
   - 在 `apps/studio/package.json` 的 dependencies 中显式加入 `highlight.js`（及如需要 `lowlight`、`react-syntax-highlighter`）。
   - 这样 pnpm 会在 studio 的依赖树里安装/链接，Vite 从 apps/studio 做依赖发现和预构建时更容易包含这些包，减少「只从根目录 /@fs/ 提供」的情况。

3. **studio 使用 node-linker=hoisted 或 deploy**
   - 在 apps/studio 下用 pnpm 的 `node-linker=hoisted` 或 `pnpm deploy`，让 studio 目录下有**实体** node_modules。
   - 这样 Vite 的 root 和依赖发现都基于 apps/studio，预构建和 /@fs/ 的边界更清晰，便于统一走预构建而不是直接提供根目录 CJS。

4. **仍用 alias 作为临时兜底（不推荐作为唯一手段）**
   - 例如 `'highlight.js/lib/core': 'highlight.js'`，避免直接请求 lib/core.js，改走主入口 ESM。
   - 这只是掩盖「未预构建 + /@fs/ CJS」的表现，未改 root/依赖位置/预构建范围，后续类似问题可能再出现。

## 建议决策顺序

1. 先确认 Electron Forge 启动 Vite 时 **root 和 cwd** 实际是什么（可在 config 里 `console.log` 或打日志）。
2. 在 `vite.renderer.config.mts` 中**只保留** `root`（及必要时 `optimizeDeps.include`、`server.fs.allow`），**不**在 alias 里加 lowlight/highlight.js 等。
3. 若仍报错，再考虑在 studio 的 package.json 显式依赖 highlight.js（及必要时 lowlight），或调整 node-linker/deploy，最后再考虑是否用 alias 兜底。

这样可以从「monorepo 依赖在根 + Vite 未对根目录下该文件做预构建」这一根因出发做决策，而不是依赖一堆 alias。

## 补记：反方向 —— 源码包**被**预构建，新增导出拿不到

上面说的是「该预构建的没预构建」。同一条链上还有一个反方向的坑，症状完全不同：

```
SyntaxError: The requested module '/node_modules/.vite/deps/@cogito_agent_provider.js?v=73b0e299'
does not provide an export named 'PROVIDER_SOURCE_NOTES'
```

（2026-09 实测：给 `@cogito/agent/provider` 加了 `PROVIDER_SOURCE_NOTES`，dev 里整页被
ErrorBoundary 接住。）

**根因**：这套包的 `exports` 指向 `src/*.ts`。一旦它没被 `optimizeDeps.exclude`，
Vite 会把**启动那一刻的那份源码**冻进 `.vite/deps/*.js`；之后改源码，HMR 推的是**源码模块**，
而浏览器里 `import` 到的仍是旧 bundle → 导出名对不上。预构建没跟着失效的原因与
`vite.renderer.config.mts` 里 `WorkSpace` 插件注释是同一个：这些包在 vite root 之外、
又经 pnpm 软链，watcher 上报的路径与模块图里的 id 不是同一种形式。

**判据（`vite.renderer.config.mts` 的 `optimizeDeps`）**：

- `exports` 指向 `src` 的包 → **必须 exclude**（当前：`@cogito/design`、`@cogito/chat`、
  `@cogito/agent`）。它们因此走源码，`packages/*` 的改动是真 HMR；若这类包有第三方依赖，
  再把源码 glob 登记进 `entries`，让优化器在启动时仍能顺着包内 import 收全依赖
  （`agent` 是纯 TS，`dependencies` 为空，所以没有这一项）。
- `exports` 指向 `dist` 的包（如 `@cogito/hooks`）→ **保持预构建**：它们本来就靠各自的
  `build` 出新产物，排除只会让它读同一个 `dist` 文件。

**改完怎么办**：`optimizeDeps` 是启动时读的，旧会话里那份 `deps/*.js` 还在磁盘上 ——
**重启 dev** 让优化器重跑（判据：`apps/studio/node_modules/.vite/deps/_metadata.json` 的
写入时间会更新）。若重启后仍报同样的错，删掉 `apps/studio/node_modules/.vite` 再启。
以后遇到「改了源码新增导出、dev 里报 `does not provide an export named`」，
先看这个包是不是**源码导出却没 exclude**，而不是去翻业务代码。
