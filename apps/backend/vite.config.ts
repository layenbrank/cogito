import React from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import AutoImport from 'unplugin-auto-import/vite'
import { defineConfig, loadEnv, type ConfigEnv, type UserConfig } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = 8300

export default defineConfig(function ({ mode }: ConfigEnv): UserConfig {
  loadEnv(mode || 'development', '')
  return {
    envDir: resolve(__dirname),
    plugins: [
      tailwindcss(),
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
      })
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      },
      tsconfigPaths: true
    },
    server: {
      port: PORT,
      strictPort: true,
      host: '0.0.0.0'
    },
    preview: {
      port: PORT,
      strictPort: true
    },
    build: {
      target: 'esnext',
      cssMinify: 'lightningcss'
    }
  }
})
