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
      emptyOutDir: true,
      modulePreload: false,
      outDir: resolve(fileURLToPath(new URL('.', import.meta.url)), 'dist'),
      rolldownOptions: {
        input: {
          popup: 'popup.html',
          worker: 'src/entries/worker.ts'
        },
        output: {
          entryFileNames(chunk) {
            if (chunk.name === 'worker') return 'worker.js'
            return 'assets/[name]-[hash].js'
          },
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]'
        }
      }
    },
    clearScreen: false
  }
})
