import eslint from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig(
  globalIgnores([
    '**/dist/**',
    '**/dist-ssr/**',
    '**/coverage/**',
    '**/node_modules/**',
    '*.config.js',
    '*.config.cjs',
    '*.config.mjs'
  ]),
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  reactHooks.configs.flat['recommended-latest'],
  reactRefresh.configs.recommended,
  reactRefresh.configs.vite,
  {
    name: 'backend/typescript',
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      globals: {
        ...globals.browser
      },
      parserOptions: {
        ecmaVersion: 2025,
        sourceType: 'module',
        projectService: true,
        tsconfigRootDir: ROOT_DIR
      }
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin
    },
    rules: {
      'no-var': 'error',
      eqeqeq: 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports'
        }
      ],
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksVoidReturn: {
            attributes: false
          }
        }
      ],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }]
    }
  },
  {
    name: 'backend/node-tooling',
    files: ['vite.config.*', 'vitest.config.*', 'eslint.config.*', 'shaders.config.*'],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  }
)
