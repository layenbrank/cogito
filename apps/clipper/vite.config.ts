import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig(function () {
  return {
    base: './',
    plugins: [tailwindcss(), react()],
    resolve: {
      tsconfigPaths: true,
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    build: {
      target: 'esnext',
      // 产物写进打包后的扩展根（`apps/extension/dist`）：manifest 由 extension 持有，
      // 这份只是它引用的 `popup.html`。绝不能清空目录 —— 那边已经有 extension 自己的产物。
      emptyOutDir: false,
      modulePreload: false,
      outDir: resolve(fileURLToPath(new URL('.', import.meta.url)), '../extension/dist'),
      rolldownOptions: {
        input: {
          popup: 'popup.html'
        },
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]'
        }
      }
    },
    clearScreen: false
  }
})
