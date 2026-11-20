import tailwindcss from '@tailwindcss/vite'
import React from '@vitejs/plugin-react-swc'
import { readFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv, type ConfigEnv, type UserConfig } from 'vite'
import { chunks } from './vite.chunk.ts'
// import wasm from 'vite-plugin-wasm'

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

export default defineConfig(function ({ mode, command }: ConfigEnv): UserConfig {
  const env = loadEnv(mode || 'development', '')
  const interfaces = networkInterfaces()
  const PORT = 1024
  let HOST = '0.0.0.0'

  for (const inter of Object.keys(interfaces)) {
    const collection = interfaces[inter]
    if (!collection) continue
    for (const single of collection) {
      if (inter !== 'WLAN') continue
      if (single.family !== 'IPv4') continue
      if (single.internal) continue
      HOST = single.address
    }
  }
  console.log('env ===>', env)
  console.log('IP ===>', `http://${HOST}:${PORT}`)

  return {
    base: command === 'serve' ? '/' : './',
    plugins: [
      tailwindcss(),
      React({
        devTarget: 'esnext',
        jsxImportSource: 'react',
        tsDecorators: true,
        plugins: []
      })
    ],
    resolve: {
      tsconfigPaths: true,
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    build: {
      target: 'esnext',
      minify: 'terser',
      emptyOutDir: true,
      cssCodeSplit: true,
      cssTarget: 'chrome128',
      cssMinify: 'lightningcss',
      sourcemap: mode === 'development' ? true : false,
      // 将产物输出到当前包目录的 dist，下游 Turbo outputs 可匹配到
      outDir: resolve(fileURLToPath(new URL('.', import.meta.url)), 'dist'),
      assetsInlineLimit(filePath, _content) {
        const inlineRegexe = inlineRegexes.some((regex) => regex.test(filePath))

        // 检查是否匹配内联规则
        // return content.length < 10 * 1024 // 小于10kb则内联
        if (inlineRegexe) return true

        const noInlineRegexe = noInlineRegexes.some((regex) => regex.test(filePath))

        // 检查是否匹配不内联规则 不内联
        if (noInlineRegexe) return false

        // 默认情况下，不内联
        return false
      },
      rolldownOptions: {
        input: {
          index: 'index.html',
          popup: 'popup.html',
          sidepanel: 'sidepanel.html'
        },
        output: {
          chunkFileNames: 'javascript/[name]-[hash].js',
          entryFileNames: 'javascript/[name]-[hash].js',
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
    css: {
      modules: {
        // 生成的类名格式
        generateScopedName: '[name]-[local]-[hash:base64:6]',
        // 是否驼峰化 CSS 类名
        localsConvention: 'camelCase',
        // 哪些文件需要使用 CSS Modules（默认：/\.module\./）
        scopeBehaviour: 'local',
        // 自定义哈希函数
        hashPrefix: 'prefix'
      }
    },
    clearScreen: false,
    server: {
      port: PORT,
      host: HOST,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp'
      },
      https:
        process.env.EXTENSION_HTTP === '1'
          ? undefined
          : {
              key: readFileSync('key.pem'),
              cert: readFileSync('cert.pem')
            },
      proxy: {
        '/bing': {
          target: 'https://cn.bing.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/bing/, '')
        },
        '/baidu': {
          target: 'https://www.baidu.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/bing/, '')
        },
        '/go': {
          target: 'http://172.16.1.231:9001',
          // target: 'http://172.16.0.8:9001',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/go/, '/go')
        }
      }
    }
  }
})
