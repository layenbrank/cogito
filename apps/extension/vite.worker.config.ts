import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

/**
 * 后台脚本单独打包并内联依赖，避免把 React 页面包拉进 service worker。
 * 主构建会清空 dist，这一步必须排在它后面，并且不能再清空。
 *
 * 入口只在这里：MV3 一个扩展只能注册一个 `background.service_worker`，
 * 剪藏那半（`@cogito/extension-kit/relay`）与右键菜单由 `entries/worker.ts` 一起装上。
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    emptyOutDir: false,
    outDir: 'dist',
    target: 'esnext',
    minify: 'terser',
    rolldownOptions: {
      input: 'src/entries/worker.ts',
      output: {
        entryFileNames: 'service-worker.js',
        codeSplitting: false,
        format: 'es'
      }
    }
  }
})
