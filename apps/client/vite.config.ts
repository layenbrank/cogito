import React from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import { createHash } from 'node:crypto'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
// 获取 本地网络IP地址
import { networkInterfaces } from 'node:os'
import AutoImport from 'unplugin-auto-import/vite'
import { defineConfig, loadEnv, type ConfigEnv, type UserConfig } from 'vite'
import { compression } from 'vite-plugin-compression2'
import { chunks } from './vite.chunk'

const __dirname = dirname(fileURLToPath(import.meta.url))

// const host = process.env.TAURI_DEV_HOST

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

// 使用正则数组表示需要内联的文件类型
const inlineRegexes: readonly RegExp[] = [gifRegex]

// 使用正则数组表示不需要内联的文件类型
const noInlineRegexes: readonly RegExp[] = [
  /icon.*\.(png|jpe?g)$/i, // 图标文件
  /background.*\.(png|jpe?g)$/i // 背景图片
].concat(svgRegex, jsonRegex, videoRegex, audioRegex, fontRegex)

export default defineConfig(function ({ mode }: ConfigEnv): UserConfig {
  const env = loadEnv(mode || 'development', '')
  const interfaces = networkInterfaces()
  const TAURI_DEV_HOST = process.env.TAURI_DEV_HOST
  const PORT = 8200
  let IP = 'localhost'

  for (const inter of Object.keys(interfaces)) {
    const collection = interfaces[inter]
    if (!collection) continue
    for (const single of collection) {
      if (inter !== 'WLAN') continue
      if (single.family !== 'IPv4') continue
      if (single.internal) continue
      IP = single.address
    }
  }
  console.log('env ===>', env)
  console.log('IP ===>', `http://${IP}:${PORT}`)
  return {
    envDir: resolve(fileURLToPath(new URL('.', import.meta.url))),
    plugins: [
      tailwindcss(),
      React({
        // jsxRuntime: 'automatic',
        // include: [/\.[jt]sx$/]
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
      include: ['react', 'react-dom', 'react-router-dom'],
      exclude: ['node_modules']
    },
    build: {
      target: 'esnext',
      emptyOutDir: true,
      minify: 'terser',
      cssCodeSplit: true,
      cssMinify: 'lightningcss',
      sourcemap: mode === 'development' ? true : false,
      // 输出到包内 dist，便于 Turbo outputs 匹配
      outDir: resolve(fileURLToPath(new URL('.', import.meta.url)), 'dist'),
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
        // maxParallelFileOps: 60,
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
    envPrefix: [
      'VITE_',
      'TAURI_PLATFORM',
      'TAURI_ARCH',
      'TAURI_FAMILY',
      'TAURI_PLATFORM_VERSION',
      'TAURI_PLATFORM_TYPE',
      'TAURI_DEBUG'
    ],
    css: {
      modules: {
        // generateScopedName: '[name]-[local]-[hash:base64:6]',
        // generateScopedName: '[name]-[hash:base64:6]',
        // generateScopedName(name, _filename, css) {
        // 	// const fileBaseName = basename(filename, '.module.scss')
        // 	const hash = Buffer.from(css).toString('base64').slice(0, 6)
        // 	// const scoped = `${fileBaseName}-${name}-${hash}`
        // 	const scoped = `${name}-${hash}`
        // 	return scoped
        // },
        generateScopedName(name, filename) {
          // 必须含完整路径：calendar/countdown 等都叫 marker.module.scss，
          // 旧实现只用 css 内容前 6 位 base64，文件都以 @use 开头 → 类名碰撞，样式串扰。
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

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: PORT,
      strictPort: true,
      host: TAURI_DEV_HOST || '0.0.0.0',
      hmr: TAURI_DEV_HOST
        ? {
            protocol: 'ws',
            host: TAURI_DEV_HOST,
            port: 1421
          }
        : undefined,
      watch: {
        // 3. tell Vite to ignore watching `src-tauri`
        ignored: ['**/src-tauri/**']
      }
    }
  }
})
