import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { basename, dirname, resolve, sep } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import React from '@vitejs/plugin-react-swc'
import AutoImport from 'unplugin-auto-import/vite'
import { defineConfig, loadEnv, type ConfigEnv, type Plugin, type UserConfig } from 'vite'
import { compression } from 'vite-plugin-compression2'

import { chunks } from './vite.chunk.mts'

const cssRegex: Readonly<RegExp> = /\.css$/i
const imageRegex: Readonly<RegExp> = /\.(png|jpe?g|gif|svg|webp|ico)$/i
const fontRegex: Readonly<RegExp> = /\.(woff2?|ttf|eot|otf)$/i
const videoRegex: Readonly<RegExp> = /\.(mp4|webm|ogg)$/i
const audioRegex: Readonly<RegExp> = /\.(mp3|wav|ogg)$/i
const wasmRegex: Readonly<RegExp> = /\.wasm$/i
const jsonRegex: Readonly<RegExp> = /\.json$/i
const svgRegex: Readonly<RegExp> = /\.svg$/i
const gifRegex: Readonly<RegExp> = /\.gif$/i
const workerRegex: Readonly<RegExp> = /\.worker\.js$/i

const inlineRegexes: readonly RegExp[] = [gifRegex]

const noInlineRegexes: readonly RegExp[] = [
  /icon.*\.(png|jpe?g)$/i, // 图标文件
  /background.*\.(png|jpe?g)$/i // 背景图片
].concat(svgRegex, jsonRegex, videoRegex, audioRegex, fontRegex)

/**
 * dev 下 `packages/*` 的改动不会触发 HMR（组件改了「没反应」，改 apps 下的文件却正常）。
 *
 * 原因不是「没监听」：事件能收到（tailwind 会跟着重扫 `@source`，能看到 css 更新），
 * 但这些包既不在 vite root（apps/studio）内，又是 pnpm 软链进 node_modules 的，
 * 于是 watcher 上报的路径与模块图里的 id 不是同一种形式：
 * `moduleGraph.getModulesByFile(file)` 查不到模块 → 不失效转译缓存、也不推 js-update，
 * 界面会一直跑旧组件，**直到重启 dev server**。
 *
 * 所以这里在 handleHotUpdate 里按「上报路径 + realpath」两种形式再查一次模块图，
 * 查到就交回给 vite 走正常的 HMR（React 组件依旧是 Fast Refresh，不会整页重载）。
 * client / extension 两个 app 也有同样的结构，遇到同样症状时照搬这个插件即可。
 */
function WorkSpace(): Plugin {
  const workspacePackages = fileURLToPath(new URL('../../packages/', import.meta.url))
  const linkedMarker = `${sep}node_modules${sep}@cogito${sep}`

  return {
    name: 'studio:workspace-source-hmr',
    apply: 'serve',
    handleHotUpdate: function (ctx) {
      const isWorkspaceSource =
        ctx.file.startsWith(workspacePackages) || ctx.file.includes(linkedMarker)
      if (!isWorkspaceSource) return undefined

      const modules = new Set(ctx.modules)
      const candidates = new Set([ctx.file, toRealPath(ctx.file)])
      for (const candidate of candidates) {
        const found = ctx.server.moduleGraph.getModulesByFile(candidate)
        if (!found) continue
        for (const mod of found) modules.add(mod)
      }

      return modules.size > ctx.modules.length ? Array.from(modules) : undefined
    }
  }
}

/** realpath 失败（文件刚被删除）时退回原路径，不把 HMR 链路搞崩 */
function toRealPath(file: string): string {
  try {
    return realpathSync.native(file)
  } catch (error) {
    console.warn('[studio:workspace-source-hmr] realpath 失败，按原路径处理', file, error)
    return file
  }
}

export default defineConfig(function ({ mode }: ConfigEnv): UserConfig {
  const env = loadEnv(mode || 'development', '')
  // Forge 注入 MAIN_WINDOW_VITE_DEV_SERVER_URL 为 localhost，须与 server.host 一致；
  // 勿绑到 WLAN 网卡 IP，否则 Electron 访问 localhost 会 ERR_CONNECTION_REFUSED。
  const PORT = 9523
  const HOST = '127.0.0.1'

  console.log('env ===>', env)
  console.log('dev server ===>', `http://${HOST}:${PORT}`)

  return {
    envDir: resolve(fileURLToPath(new URL('.', import.meta.url))),
    plugins: [
      tailwindcss(),
      WorkSpace(),
      React({
        devTarget: 'esnext',
        jsxImportSource: 'react',
        tsDecorators: true,
        plugins: []
      }),
      AutoImport({
        dts: 'src/types/auto-imports.d.ts',
        include: [/\.(?:ts|tsx|js|jsx)$/i],
        imports: [
          'react',
          'react-router-dom',
          {
            react: [['default', 'React']]
          }
        ]
      }),
      compression({
        include: /\.(js|mjs|json|css|less|scss|html)$/i,
        threshold: 10240,
        deleteOriginalAssets: false,
        algorithms: ['gzip'],
        logLevel: 'info'
      })
    ],
    resolve: {
      tsconfigPaths: true,
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-router-dom',
        /**
         * dev 模式下 Vite 用 `react/jsx-dev-runtime`，但**已发布的三方产物是生产 JSX 转换**，
         * 它们 import 的是 `react/jsx-runtime`（CJS）。只要这条链上有一个文件没被预构建，
         * 浏览器就会拿到裸 CJS 并报 `does not provide an export named 'jsx'`（整条路由挂掉，
         * 例如 /chat 依赖的 assistant-ui / ai 链路）。显式纳入预构建即可拿到带互操作的副本。
         */
        'react/jsx-runtime',
        /**
         * 懒加载路由（`/chat` 经 React.lazy）的依赖不在启动扫描里，首次进入才会被发现；
         * 在优化器补跑完成前，这些包是**裸文件**下发的，其中 CJS 的会直接抛
         * `does not provide an export named 'default'`。它们是非 ESM 产物，必须显式登记：
         * `classnames` 与 `secure-json-parse` 是 assistant-ui / ai 链路实际发出的两个 CJS。
         * （判据：加载 /chat 后统计所有非预构建的裸 node_modules 请求，逐个验 CJS 特征。）
         */
        'classnames',
        'secure-json-parse',
        // markdown 渲染链路：`hast-util-to-jsx-runtime`(ESM) 直接 import CJS 的 `style-to-js`，
        // 只要它自己没被预构建，浏览器就会拿到 `style-to-js/cjs/index.js` 的裸文件 →
        // `does not provide an export named 'default'`。把引用方一起登记，让 esbuild 连它的
        // CJS 依赖一块打包并补上 default 互操作。
        'hast-util-to-jsx-runtime',
        'style-to-js'
      ],
      /**
       * 被 exclude 的包不再参与启动扫描，它们的第三方依赖要靠这里补回来：
       * 指向源码 glob，让优化器在启动时就顺着包内 import 把依赖收全，
       * 避免进入懒加载路由时才触发 re-optimize + 整页 reload（以及中间那段裸 CJS 窗口）。
       *
       * 只登记**有第三方依赖**的包：`agent` 是纯 TS（`dependencies` 为空、源码只 import 相对路径），
       * 没有要收的依赖，也就没有 glob。
       */
      entries: [
        'index.html',
        '../../packages/design/src/**/*.{ts,tsx}',
        '../../packages/chat/src/**/*.{ts,tsx}'
      ],
      /**
       * 渲染进程直接 import 的**源码包**必须排除预构建，否则每次给包加导出都要重启 dev。
       *
       * 这些包 exports 指向 `src/*.ts`（不是 dist），预构建会把它们的**当前一份**源码冻进
       * `.vite/deps/*.js`：改源码加个导出，vite 侧确实热更了（源码包不在 vite root 内、
       * 又是 pnpm 软链，见上面的 `WorkSpace` 插件说明），但浏览器拿的仍是旧 bundle ——
       * 报 `The requested module '/node_modules/.vite/deps/@cogito_agent_provider.js'
       * does not provide an export named 'X'`，整页被 ErrorBoundary 接住。
       *
       * 判据：凭 `exports` 指向 `src` 的包都排除；指向 `dist` 的（如 `@cogito/hooks`）保持
       * 预构建 —— 那些包本来就靠各自 `build` 出新产物，排除只会让它读同一个 dist 文件。
       */
      exclude: ['@cogito/design', '@cogito/chat', '@cogito/agent']
    },
    build: {
      target: 'esnext',
      emptyOutDir: true,
      minify: 'terser',
      cssCodeSplit: true,
      cssMinify: 'lightningcss',
      sourcemap: mode === 'development' ? true : false,
      // outDir 由 @electron-forge/plugin-vite 设为 .vite/renderer/<name>，勿覆盖为 dist（否则不会打进 asar）
      assetsInlineLimit(filePath) {
        const isInline = inlineRegexes.some((regex) => regex.test(filePath))
        // return content.length < 10 * 1024 // 小于10kb则内联
        if (isInline) return true

        const isNoInline = noInlineRegexes.some((regex) => regex.test(filePath))
        if (isNoInline) return false

        // 默认情况下，不内联
        return false
      },
      rolldownOptions: {
        output: {
          entryFileNames: 'javascript/[name]-[hash].js',
          chunkFileNames: 'javascript/[name]-[hash].js',
          assetFileNames(chunk) {
            if (!chunk.names) return 'assets/[name]-[hash].[ext]'

            for (const name of chunk.names) {
              if (cssRegex.test(name)) return `css/[name]-[hash][extname]`
              if (imageRegex.test(name)) return `images/[name]-[hash][extname]`
              if (fontRegex.test(name)) return `fonts/[name]-[hash][extname]`
              if (videoRegex.test(name)) return `videos/[name]-[hash][extname]`
              if (audioRegex.test(name)) return `audios/[name]-[hash][extname]`
              if (wasmRegex.test(name)) return `wasm/[name]-[hash][extname]`
              if (workerRegex.test(name)) return `workers/[name]-[hash][extname]`
            }

            return 'assets/[name]-[hash][extname]'
          },
          codeSplitting: {
            groups: chunks
          }
        }
      }
    },
    envPrefix: ['VITE_'],
    css: {
      modules: {
        generateScopedName(name, filename) {
          const fileBaseName = basename(filename).replace(/\.module\.(scss|css|sass|less)$/i, '')
          const scope = basename(dirname(filename))
          const hash = createHash('sha256')
            .update(`${filename}\0${name}`)
            .digest('base64url')
            .slice(0, 6)
          return `${scope}-${fileBaseName}-${name}-${hash}`
        },
        localsConvention: 'camelCase',
        scopeBehaviour: 'local',
        hashPrefix: 'prefix'
      },
      preprocessorOptions: {
        scss: {
          additionalData: `
                          @use "@/styles/mixins.scss" as *;
                          `
        }
      }
    },
    clearScreen: false,
    server: {
      port: PORT,
      strictPort: true,
      host: HOST,
      watch: {
        ignored: ['**/dist-electron/**']
      }
    }
  }
})
